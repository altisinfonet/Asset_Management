import { http, HttpResponse, type HttpHandler } from 'msw';
import { checkIfMatch, etagOf, problem, problemBody, requireSession } from './http';
import {
  assignmentView,
  closeAssignment,
  custodyResponse,
  duplicate,
  fail,
  idempotent,
  inUse,
  noLabel,
  notFound,
  openAssignment,
  pushEvent,
  refuseAssetAction,
  statusName,
  statusOfType,
  type Target,
} from './m2-handlers';
import type { MockAsset, MockAssignment, MockPerson, RegistryData } from './registry-fixtures';
import {
  expandAsset,
  nowIso,
  paginate,
  readBody,
  validation,
  type Body,
} from './registry-handlers';
import { mutateRegistry, registry } from './registry-state';
import { scopedLocationErrors } from './scope';
import { checkInt, checkText, checkUuids, isUuid, rejectUnknown } from './w2-common';
import { mutateW3, newW3Id, w3, w3Id, type MockMember, type MockPool } from './w3-state';

/**
 * Mock handlers of the loaner endpoints of docs/engineering/openapi.yaml (tag Loaners, ED-20 / ED-21):
 * pools and their members (single and bulk), the single loan, the quick check-out and the quick return
 * by scanning (per-device results), loans (list, one, extend, overdue), the dashboard and the custody
 * settings. A loan is a registry assignment that knows its pool, so a regular check-in or a person's
 * page see it too. The first request seeds two pools and four loans, one overdue and one due today.
 */
const DAY = 86_400_000;
const todayUtc = () => new Date().toISOString().slice(0, 10);
const dayFrom = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const dayFromToday = (days: number) => dayFrom(todayUtc(), days);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

const MANAGER_ID = '0190a6b2-0000-7000-8000-000000000007';
const KINDS = ['employee', 'student', 'contractor', 'external'] as const;

// ---- lending (the seed and the loan endpoints share it) -----------------------------------------

function lend(
  data: RegistryData,
  asset: MockAsset,
  person: MockPerson,
  pool: MockPool,
  dueDate: string,
  actorId: string,
  note: string | null,
) {
  const deployed = statusOfType('deployed');
  const target: Target = { type: 'person', id: person.id, name: person.display_name };
  const from = data.statusLabels.find((s) => s.id === asset.status_id)?.name ?? '';
  const assignment = openAssignment(
    data,
    asset,
    target,
    { expected_return: dueDate, ...(note ? { note } : {}) },
    actorId,
  );
  assignment.loaner_pool_id = pool.id;
  asset.current_assignment = { ...asset.current_assignment!, loaner_pool_id: pool.id };
  if (deployed) asset.status_id = deployed.id;
  asset.updated_at = nowIso();
  asset._v += 1;
  pushEvent(
    data,
    asset,
    'checked_out',
    `Loaned to ${person.display_name}`,
    actorId,
    { assignmentId: assignment.id },
    {
      assignment_id: assignment.id,
      target_type: 'person',
      target_id: person.id,
      target_name: person.display_name,
      expected_return: dueDate,
      status: { from, to: deployed?.name ?? from },
    },
  );
  return assignment;
}

// ---- seed ---------------------------------------------------------------------------------------

function ensureSeed() {
  if (w3().loansSeeded) return;
  mutateRegistry((data) => {
    const readyOf = (categoryName: string) => {
      const category = data.categories.find((c) => c.name === categoryName);
      return data.assets
        .filter(
          (a) =>
            !a.archived_at &&
            a.category_id === category?.id &&
            !a.current_assignment &&
            data.statusLabels.find((s) => s.id === a.status_id)?.state_type === 'deployable',
        )
        .sort((a, b) => a.asset_tag.localeCompare(b.asset_tag));
    };
    const borrowers = data.people.filter((p) => p.status === 'active' && !p.user_id);
    const stamp = nowIso();
    const pool = (n: number, fields: Partial<MockPool> & Pick<MockPool, 'name'>): MockPool => ({
      id: w3Id('pool', n),
      created_at: stamp,
      updated_at: stamp,
      archived_at: null,
      description: null,
      home_location_id: null,
      default_loan_days: null,
      email_borrowers_without_login: null,
      max_loan_days: null,
      max_loans_per_person: null,
      eligible_person_kinds: null,
      owner_user_id: null,
      is_active: true,
      _v: 1,
      ...fields,
    });
    const students = pool(1, {
      name: 'Student Chromebook loaners',
      description: 'Spare Chromebooks for students whose device is being repaired.',
      default_loan_days: 7,
      max_loan_days: 28,
      max_loans_per_person: 1,
    });
    const staff = pool(2, {
      name: 'Staff laptop loaners',
      description: 'Laptops for staff on a trip or waiting for a replacement.',
      default_loan_days: 14,
      max_loan_days: 60,
      max_loans_per_person: 2,
    });
    const chromebooks = readyOf('Chromebook').slice(0, 8);
    const laptops = readyOf('Laptop').slice(0, 3);
    const members: MockMember[] = [
      ...chromebooks.map((a) => ({ loaner_pool_id: students.id, asset_id: a.id, added_at: stamp })),
      ...laptops.map((a) => ({ loaner_pool_id: staff.id, asset_id: a.id, added_at: stamp })),
    ];
    const loans: Array<[MockAsset | undefined, MockPool, number, number]> = [
      [chromebooks[0], students, 0, 4],
      [chromebooks[1], students, 1, -5],
      [chromebooks[2], students, 2, 0],
      [laptops[0], staff, 3, 10],
    ];
    for (const [asset, owner, who, due] of loans) {
      const borrower = borrowers[who];
      if (asset && borrower)
        lend(data, asset, borrower, owner, dayFromToday(due), MANAGER_ID, null);
    }
    mutateW3((state) => {
      state.pools.push(students, staff);
      state.members.push(...members);
      state.loansSeeded = true;
    });
  });
}

// ---- views ----------------------------------------------------------------------------------------

const assetOf = (id: string) => registry().assets.find((a) => a.id === id);
const poolOf = (id: string) => w3().pools.find((p) => p.id === id && !p.archived_at);
const memberOf = (assetId: string) => w3().members.find((m) => m.asset_id === assetId);

const isDeployable = (asset: MockAsset) =>
  registry().statusLabels.find((s) => s.id === asset.status_id)?.state_type === 'deployable';

function poolAssets(pool: MockPool): MockAsset[] {
  return w3()
    .members.filter((m) => m.loaner_pool_id === pool.id)
    .map((m) => assetOf(m.asset_id))
    .filter((a): a is MockAsset => !!a && !a.archived_at);
}

function poolStats(pool: MockPool) {
  const assets = poolAssets(pool);
  const out = assets.filter((a) => a.current_assignment);
  const today = todayUtc();
  const soon = dayFromToday(w3().custodySettings.loan_reminder_days);
  const due = (a: MockAsset) => a.current_assignment!.expected_return ?? '9999-12-31';
  return {
    member_count: assets.length,
    available_count: assets.filter((a) => !a.current_assignment && isDeployable(a)).length,
    checked_out_count: out.length,
    overdue_count: out.filter((a) => due(a) < today).length,
    due_today_count: out.filter((a) => due(a) === today).length,
    due_soon_count: out.filter((a) => due(a) > today && due(a) <= soon).length,
  };
}

/** The loan length a request without a date gets (ED-24): pool, else organisation, else 7; cut to the maximum. */
function effectiveDays(pool: MockPool): number {
  const days = pool.default_loan_days ?? w3().custodySettings.default_expected_return_days ?? 7;
  return pool.max_loan_days ? Math.min(days, pool.max_loan_days) : days;
}

function poolView(pool: MockPool) {
  const { _v: _ignored, ...pub } = pool;
  const { due_soon_count: _soon, ...counts } = poolStats(pool);
  return { ...pub, effective_default_loan_days: effectiveDays(pool), ...counts };
}

function onePool(pool: MockPool, status = 200) {
  return HttpResponse.json(poolView(pool), {
    status,
    headers: {
      ETag: etagOf(pool._v),
      ...(status === 201 ? { Location: `/v1/loaner-pools/${pool.id}` } : {}),
    },
  });
}

function memberView(member: MockMember) {
  const asset = assetOf(member.asset_id)!;
  return {
    asset_id: member.asset_id,
    loaner_pool_id: member.loaner_pool_id,
    added_at: member.added_at,
    available: !asset.current_assignment && !asset.archived_at && isDeployable(asset),
    asset: expandAsset(asset, []),
  };
}

type LoanState = 'on_loan' | 'due_today' | 'overdue' | 'returned';

function loanState(a: MockAssignment): LoanState {
  if (a.checked_in_at) return 'returned';
  const today = todayUtc();
  if (!a.expected_return || a.expected_return > today) return 'on_loan';
  return a.expected_return === today ? 'due_today' : 'overdue';
}

function loanView(a: MockAssignment) {
  const asset = assetOf(a.asset_id!);
  const person = a.person_id ? registry().people.find((p) => p.id === a.person_id) : undefined;
  const state = loanState(a);
  return {
    id: a.id,
    asset_id: a.asset_id,
    asset_tag: asset?.asset_tag ?? '',
    asset_name: asset?.name ?? null,
    loaner_pool_id: a.loaner_pool_id,
    pool_name: w3().pools.find((p) => p.id === a.loaner_pool_id)?.name ?? '',
    person_id: a.person_id ?? null,
    person_name: person?.display_name ?? null,
    person_email: person?.email ?? null,
    person_ref: person?.employee_ref ?? null,
    checked_out_at: a.checked_out_at,
    expected_return: a.expected_return ?? todayUtc(),
    returned_at: a.checked_in_at ?? null,
    state,
    days_overdue: state === 'overdue' ? daysBetween(a.expected_return!, todayUtc()) : 0,
    note: a.note ?? null,
  };
}

const loansOfPools = () =>
  registry().assignments.filter(
    (a) => a.asset_id && a.loaner_pool_id && assetOf(a.asset_id) && poolOf(a.loaner_pool_id),
  );

// ---- validation -------------------------------------------------------------------------------------

const POOL_KEYS = [
  'name',
  'description',
  'home_location_id',
  'default_loan_days',
  'max_loan_days',
  'max_loans_per_person',
  'eligible_person_kinds',
  'owner_user_id',
  'is_active',
  'email_borrowers_without_login',
] as const;

function validatePool(body: Body, creating: boolean, existing?: MockPool) {
  const errors = [
    ...rejectUnknown(body, POOL_KEYS),
    ...checkText(body, 'name', { min: 1, max: 200, required: creating }),
    ...checkText(body, 'description', { max: 2000, nullable: true }),
    ...checkUuids(
      body,
      ['home_location_id', 'owner_user_id'],
      ['home_location_id', 'owner_user_id'],
    ),
    ...(body.default_loan_days === null ? [] : checkInt(body, 'default_loan_days', { min: 1 })),
    ...(body.max_loan_days === null ? [] : checkInt(body, 'max_loan_days', { min: 1 })),
    ...(body.max_loans_per_person === null
      ? []
      : checkInt(body, 'max_loans_per_person', { min: 1 })),
  ];
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
    errors.push({
      pointer: '/is_active',
      message: 'Invalid input: expected boolean',
      code: 'invalid_type',
    });
  }
  if (
    body.email_borrowers_without_login !== undefined &&
    body.email_borrowers_without_login !== null &&
    typeof body.email_borrowers_without_login !== 'boolean'
  ) {
    errors.push({
      pointer: '/email_borrowers_without_login',
      message: 'Invalid input: expected boolean',
      code: 'invalid_type',
    });
  }
  const kinds = body.eligible_person_kinds;
  if (
    kinds !== undefined &&
    kinds !== null &&
    (!Array.isArray(kinds) ||
      kinds.length < 1 ||
      new Set(kinds).size !== kinds.length ||
      kinds.some((k) => !KINDS.includes(k as never)))
  ) {
    errors.push({
      pointer: '/eligible_person_kinds',
      message: 'Choose at least one kind of person, each once',
      code: 'invalid_value',
    });
  }
  if (typeof body.home_location_id === 'string' && isUuid(body.home_location_id)) {
    if (!registry().locations.some((l) => l.id === body.home_location_id && !l.archived_at)) {
      errors.push({
        pointer: '/home_location_id',
        message: 'No such location.',
        code: 'not-found',
      });
    }
  }
  if (typeof body.owner_user_id === 'string' && isUuid(body.owner_user_id)) {
    if (!registry().users.some((u) => u.id === body.owner_user_id)) {
      errors.push({ pointer: '/owner_user_id', message: 'No such user.', code: 'not-found' });
    }
  }
  const days =
    body.default_loan_days === undefined
      ? (existing?.default_loan_days ?? null)
      : (body.default_loan_days as number | null);
  const max =
    body.max_loan_days === undefined ? (existing?.max_loan_days ?? null) : body.max_loan_days;
  if (typeof max === 'number' && typeof days === 'number' && Number.isInteger(days) && max < days) {
    errors.push({
      pointer: '/max_loan_days',
      message: 'must be at least the default loan length',
      code: 'invalid',
    });
  }
  return errors;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ---- members ----------------------------------------------------------------------------------------

type Outcome = { status: number; body?: unknown };

function addMember(pool: MockPool, assetId: string): Outcome {
  const asset = assetOf(assetId);
  if (!asset || asset.archived_at) {
    return {
      status: 422,
      body: problemBody(422, 'validation', 'Validation failed', {
        errors: [{ pointer: '/asset_id', message: 'No such asset.', code: 'not-found' }],
      }),
    };
  }
  const existing = memberOf(asset.id);
  if (existing?.loaner_pool_id === pool.id) return { status: 200, body: memberView(existing) };
  if (existing) {
    const other = w3().pools.find((p) => p.id === existing.loaner_pool_id);
    return {
      status: 409,
      body: problemBody(409, 'conflict', 'Conflict', {
        detail: `The asset already belongs to the pool "${other?.name ?? 'another pool'}".`,
      }),
    };
  }
  const member: MockMember = { loaner_pool_id: pool.id, asset_id: asset.id, added_at: nowIso() };
  mutateW3((data) => data.members.push(member));
  return { status: 201, body: memberView(member) };
}

function removeMember(pool: MockPool, assetId: string): Outcome {
  const member = w3().members.find((m) => m.loaner_pool_id === pool.id && m.asset_id === assetId);
  if (!member) {
    return {
      status: 404,
      body: problemBody(404, 'not-found', 'Not found', { detail: 'Pool member not found.' }),
    };
  }
  const onLoan = registry().assignments.some(
    (a) => a.asset_id === assetId && a.loaner_pool_id === pool.id && !a.checked_in_at,
  );
  if (onLoan) {
    return {
      status: 409,
      body: problemBody(409, 'conflict', 'Conflict', {
        detail: 'The asset is on loan from this pool and cannot be removed (open_loans: 1).',
        usage: { open_loans: 1 },
      }),
    };
  }
  mutateW3((data) => {
    data.members = data.members.filter((m) => m !== member);
  });
  return { status: 204 };
}

// ---- codes: what a scan resolves to --------------------------------------------------------------------

type Resolved = { asset: MockAsset } | { status: number; error: ReturnType<typeof problemBody> };

function resolveCode(raw: string): Resolved {
  const text = raw.trim();
  const candidates = [text];
  if (/^(https?:\/\/|\/)/i.test(text)) {
    const last = text.split(/[?#]/)[0]!.split('/').filter(Boolean).pop();
    if (last) candidates.push(last);
  }
  const assets = registry().assets.filter((a) => !a.archived_at);
  for (const code of candidates) {
    const found =
      assets.find((a) => a.label_code === code) ??
      assets.find((a) => a.asset_tag.toLowerCase() === code.toLowerCase());
    if (found) return { asset: found };
    const bySerial = assets.filter((a) => a.serial?.toLowerCase() === code.toLowerCase());
    if (bySerial.length > 1) {
      return {
        status: 409,
        error: problemBody(409, 'conflict', 'Conflict', {
          detail: 'Several assets share this serial number. Use the asset tag instead.',
        }),
      };
    }
    if (bySerial[0]) return { asset: bySerial[0] };
  }
  return {
    status: 404,
    error: problemBody(404, 'not-found', 'Not found', { detail: 'No asset matches this code.' }),
  };
}

const notInPool = (index: number) => ({
  status: 422,
  error: problemBody(422, 'validation', 'Validation failed', {
    errors: [
      {
        pointer: `/codes/${index}`,
        message: 'The device is not in this loaner pool.',
        code: 'not-in-pool',
      },
    ],
  }),
});

// ---- borrowers --------------------------------------------------------------------------------------

/** The person a loan goes to, or the problem that stops the whole request. */
function borrowerOf(pool: MockPool, body: Body): { person: MockPerson } | { response: Response } {
  const data = registry();
  let person: MockPerson | undefined;
  let pointer = '/person_id';
  if (typeof body.person_id === 'string') {
    person = data.people.find((p) => p.id === body.person_id && !p.archived_at);
    if (!person) {
      return {
        response: validation([
          { pointer: '/person_id', message: 'No such person.', code: 'not-found' },
        ]),
      };
    }
  } else {
    pointer = '/borrower';
    const text = String(body.borrower).trim().toLowerCase();
    const matches = data.people.filter(
      (p) =>
        !p.archived_at &&
        (p.email?.toLowerCase() === text || p.employee_ref?.toLowerCase() === text),
    );
    if (matches.length > 1) {
      return {
        response: fail('conflict', {
          detail: 'The text matches more than one person. Use the person id.',
        }),
      };
    }
    person = matches[0];
    if (!person) {
      return {
        response: validation([
          {
            pointer: '/borrower',
            message: 'Nobody matches this email or number.',
            code: 'not-found',
          },
        ]),
      };
    }
  }
  if (person.status !== 'active') {
    return {
      response: validation([
        { pointer, message: 'inactive people cannot receive assets', code: 'inactive' },
      ]),
    };
  }
  if (pool.eligible_person_kinds && !pool.eligible_person_kinds.includes(person.kind as never)) {
    return {
      response: validation([
        {
          pointer,
          message: `${person.kind} people cannot borrow from this pool`,
          code: 'not-eligible',
        },
      ]),
    };
  }
  return { person };
}

/** The due date of a request, or the validation problem. */
function dueOf(pool: MockPool, body: Body): { due: string } | { response: Response } {
  const due = (body.expected_return as string | undefined) ?? dayFromToday(effectiveDays(pool));
  const latest = pool.max_loan_days ? dayFromToday(pool.max_loan_days) : null;
  if (due < todayUtc() || (latest && due > latest)) {
    return {
      response: validation([
        {
          pointer: '/expected_return',
          message: latest
            ? `must be between today and ${latest} (the pool allows ${pool.max_loan_days} days)`
            : 'must not be in the past',
          code: 'invalid',
        },
      ]),
    };
  }
  return { due };
}

function limitProblem(pool: MockPool, person: MockPerson) {
  if (!pool.max_loans_per_person) return null;
  const holding = registry().assignments.filter(
    (a) => a.person_id === person.id && a.loaner_pool_id === pool.id && !a.checked_in_at,
  ).length;
  return holding >= pool.max_loans_per_person
    ? problemBody(409, 'loan-limit-reached', 'Loan limit reached', {
        detail: `${person.display_name} already has ${holding} open loan${holding === 1 ? '' : 's'} from this pool, the most it allows.`,
      })
    : null;
}

// ---- pools ------------------------------------------------------------------------------------------

const poolHandlers: HttpHandler[] = [
  http.get('/v1/loaner-pools', ({ request }) => {
    const guard = requireSession(request, { permission: 'loaner:read' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    return paginate(
      request,
      w3().pools,
      {
        sorts: { name: (p) => p.name, created_at: (p) => p.created_at },
        defaultSort: 'name',
        haystack: (p) => [p.name, p.description],
        filter: (p, params) => {
          const active = params.get('is_active');
          const home = params.get('home_location_id');
          return (
            (active === null || p.is_active === (active === 'true')) &&
            (!home || p.home_location_id === home)
          );
        },
      },
      poolView,
    );
  }),

  http.post('/v1/loaner-pools', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:manage' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = validatePool(body, true);
    if (errors.length === 0) {
      // M2-LOC-03: a scoped principal gives every new pool a home location inside its scope
      errors.push(
        ...scopedLocationErrors(
          guard.user.locationScope,
          body.home_location_id,
          '/home_location_id',
          true,
          'A home location inside your scope is required.',
        ),
      );
    }
    if (errors.length > 0) return validation(errors);
    const name = String(body.name).trim();
    if (w3().pools.some((p) => !p.archived_at && sameName(p.name, name))) {
      return duplicate('A loaner pool named', '/name', name);
    }
    const stamp = nowIso();
    const pool: MockPool = {
      id: newW3Id('pool'),
      created_at: stamp,
      updated_at: stamp,
      archived_at: null,
      name,
      description: (body.description as string | null | undefined)?.trim() || null,
      home_location_id: (body.home_location_id as string | null | undefined) ?? null,
      default_loan_days: (body.default_loan_days as number | null | undefined) ?? null,
      email_borrowers_without_login:
        (body.email_borrowers_without_login as boolean | null | undefined) ?? null,
      max_loan_days: (body.max_loan_days as number | null | undefined) ?? null,
      max_loans_per_person: (body.max_loans_per_person as number | null | undefined) ?? null,
      eligible_person_kinds:
        (body.eligible_person_kinds as MockPool['eligible_person_kinds']) ?? null,
      owner_user_id: (body.owner_user_id as string | null | undefined) ?? null,
      is_active: (body.is_active as boolean | undefined) ?? true,
      _v: 1,
    };
    mutateW3((data) => data.pools.push(pool));
    return onePool(pool, 201);
  }),

  http.get('/v1/loaner-pools/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'loaner:read' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const pool = poolOf(String(params.id));
    return pool ? onePool(pool) : notFound('Loaner pool');
  }),

  http.patch('/v1/loaner-pools/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:manage' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const pool = poolOf(String(params.id));
    if (!pool) return notFound('Loaner pool');
    const stale = checkIfMatch(request, pool._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = validatePool(body, false, pool);
    if (errors.length > 0) return validation(errors);
    if (
      typeof body.name === 'string' &&
      w3().pools.some(
        (p) => p.id !== pool.id && !p.archived_at && sameName(p.name, body.name as string),
      )
    ) {
      return duplicate('A loaner pool named', '/name', body.name.trim());
    }
    mutateW3(() => {
      if (typeof body.name === 'string') pool.name = body.name.trim();
      if ('description' in body)
        pool.description = (body.description as string | null)?.trim() || null;
      if ('home_location_id' in body)
        pool.home_location_id = body.home_location_id as string | null;
      if ('default_loan_days' in body)
        pool.default_loan_days = body.default_loan_days as number | null;
      if ('email_borrowers_without_login' in body)
        pool.email_borrowers_without_login = body.email_borrowers_without_login as boolean | null;
      if ('max_loan_days' in body) pool.max_loan_days = body.max_loan_days as number | null;
      if ('max_loans_per_person' in body)
        pool.max_loans_per_person = body.max_loans_per_person as number | null;
      if ('eligible_person_kinds' in body) {
        pool.eligible_person_kinds =
          body.eligible_person_kinds as MockPool['eligible_person_kinds'];
      }
      if ('owner_user_id' in body) pool.owner_user_id = body.owner_user_id as string | null;
      if (typeof body.is_active === 'boolean') pool.is_active = body.is_active;
      pool.updated_at = nowIso();
      pool._v += 1;
    });
    return onePool(pool);
  }),

  http.delete('/v1/loaner-pools/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:manage' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const pool = poolOf(String(params.id));
    if (!pool) return notFound('Loaner pool');
    const stale = checkIfMatch(request, pool._v);
    if (stale) return stale;
    const open = registry().assignments.filter(
      (a) => a.loaner_pool_id === pool.id && !a.checked_in_at,
    ).length;
    if (open > 0) return inUse('The loaner pool', { open_loans: open });
    mutateW3((data) => {
      pool.archived_at = nowIso();
      pool._v += 1;
      data.members = data.members.filter((m) => m.loaner_pool_id !== pool.id);
    });
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/v1/loaner-pools/:id/members', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'loaner:read' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const pool = poolOf(String(params.id));
    if (!pool) return notFound('Loaner pool');
    const rows = w3()
      .members.filter((m) => m.loaner_pool_id === pool.id && assetOf(m.asset_id))
      .map((m) => ({ id: m.asset_id, _v: 1, archived_at: null, member: m }));
    return paginate(
      request,
      rows,
      {
        sorts: { tag: (r) => assetOf(r.id)?.asset_tag },
        defaultSort: 'tag',
        filter: (r, query) => {
          const available = query.get('available');
          return available === null || memberView(r.member).available === (available === 'true');
        },
      },
      (row) => memberView(row.member),
    );
  }),

  http.post('/v1/loaner-pools/:id/members', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:manage' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const pool = poolOf(String(params.id));
    if (!pool) return notFound('Loaner pool');
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = [...rejectUnknown(body, ['asset_id']), ...checkUuids(body, ['asset_id'])];
    if (body.asset_id === undefined) {
      errors.push({
        pointer: '/asset_id',
        message: 'Invalid input: expected string',
        code: 'invalid_type',
      });
    }
    if (errors.length > 0) return validation(errors);
    const outcome = addMember(pool, String(body.asset_id));
    return HttpResponse.json(outcome.body as object, { status: outcome.status });
  }),

  http.delete('/v1/loaner-pools/:id/members/:assetId', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:manage' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const pool = poolOf(String(params.id));
    if (!pool) return notFound('Loaner pool');
    const outcome = removeMember(pool, String(params.assetId));
    return outcome.status === 204
      ? new HttpResponse(null, { status: 204 })
      : HttpResponse.json(outcome.body as object, { status: outcome.status });
  }),

  ...(['add', 'remove'] as const).map((verb) =>
    http.post(`/v1/loaner-pools/:id/members/bulk-${verb}`, async ({ request, params }) => {
      const guard = requireSession(request, { mutation: true, permission: 'loaner:manage' });
      if (!guard.ok) return guard.response;
      ensureSeed();
      const pool = poolOf(String(params.id));
      if (!pool) return notFound('Loaner pool');
      const body = await readBody(request);
      const ids = body?.ids;
      if (
        !body ||
        !Array.isArray(ids) ||
        ids.length < 1 ||
        ids.length > 100 ||
        !ids.every(isUuid)
      ) {
        return validation([
          { pointer: '/ids', message: 'Send 1 to 100 asset ids.', code: 'invalid' },
        ]);
      }
      const results = (ids as string[]).map((id, index) => {
        const outcome = verb === 'add' ? addMember(pool, id) : removeMember(pool, id);
        const ok = outcome.status < 300;
        return {
          index,
          status: outcome.status,
          ...(ok && outcome.body ? { data: outcome.body } : {}),
          ...(!ok ? { error: outcome.body } : {}),
        };
      });
      const succeeded = results.filter((r) => r.status < 300).length;
      return HttpResponse.json({
        results,
        summary: { total: results.length, succeeded, failed: results.length - succeeded },
      });
    }),
  ),
];

// ---- loans: single, quick, return ---------------------------------------------------------------------

/** What the check-out of one device to one person gives: a result item or the problem. */
function lendOne(
  pool: MockPool,
  person: MockPerson,
  asset: MockAsset,
  due: string,
  note: string | null,
  actorId: string,
): { status: number; data?: unknown; error?: unknown } {
  const refusal = refuseAssetAction('checkout', asset);
  if (refusal) {
    const status = 409;
    return {
      status,
      error: problemBody(status, refusal.code, 'Conflict', { detail: refusal.detail }),
    };
  }
  const limit = limitProblem(pool, person);
  if (limit) return { status: 409, error: limit };
  const result = mutateRegistry((reg) => {
    const live = reg.assets.find((a) => a.id === asset.id)!;
    const assignment = lend(reg, live, person, pool, due, actorId, note);
    return { live, assignment };
  });
  return {
    status: 201,
    data: {
      asset: expandAsset(result.live, []),
      assignment: assignmentView(result.assignment, false),
    },
  };
}

const loanHandlers: HttpHandler[] = [
  http.post('/v1/loaner-pools/:id/checkout', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:checkout' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const body = await readBody(request);
    return idempotent(request, guard.user.id, body, () => {
      if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
      const errors = [
        ...rejectUnknown(body, ['person_id', 'asset_id', 'expected_return', 'note']),
        ...checkUuids(body, ['person_id', 'asset_id']),
        ...checkText(body, 'note', { max: 2000 }),
      ];
      if (body.person_id === undefined) {
        errors.push({
          pointer: '/person_id',
          message: 'Invalid input: expected string',
          code: 'invalid_type',
        });
      }
      if (
        body.expected_return !== undefined &&
        !/^\d{4}-\d{2}-\d{2}$/.test(String(body.expected_return))
      ) {
        errors.push({
          pointer: '/expected_return',
          message: 'Invalid date (YYYY-MM-DD)',
          code: 'invalid_format',
        });
      }
      if (errors.length > 0) return validation(errors);
      const pool = poolOf(String(params.id));
      if (!pool) return notFound('Loaner pool');
      if (!pool.is_active) {
        return problem(409, 'loaner-pool-inactive', 'The loaner pool is switched off');
      }
      const who = borrowerOf(pool, body);
      if ('response' in who) return who.response;
      const when = dueOf(pool, body);
      if ('response' in when) return when.response;
      if (!statusOfType('deployed')) return noLabel('deployed');

      const members = poolAssets(pool).sort((a, b) => a.asset_tag.localeCompare(b.asset_tag));
      let asset: MockAsset | undefined;
      if (typeof body.asset_id === 'string') {
        asset = members.find((a) => a.id === body.asset_id);
        if (!asset) {
          return validation([
            { pointer: '/asset_id', message: 'The asset is not in this pool.', code: 'not-found' },
          ]);
        }
      } else {
        // ED-24: the device idle the longest (earliest return of its last custody period; never lent
        // first), ties by the lowest asset tag (`members` is in tag order and the sort is stable).
        const lastReturn = (a: MockAsset): string => {
          const returns = registry()
            .assignments.filter((s) => s.asset_id === a.id && s.checked_in_at)
            .map((s) => String(s.checked_in_at));
          return returns.sort().at(-1) ?? '';
        };
        asset = members
          .filter((a) => !a.current_assignment && isDeployable(a))
          .sort((x, y) => lastReturn(x).localeCompare(lastReturn(y)))[0];
        if (!asset) {
          return problem(409, 'no-loaner-available', 'No loaner available', {
            detail: 'Every device of this pool is out or cannot be lent right now.',
          });
        }
      }
      const done = lendOne(
        pool,
        who.person,
        asset,
        when.due,
        (body.note as string | undefined)?.trim() || null,
        guard.user.id,
      );
      if (done.status !== 201)
        return HttpResponse.json(done.error as object, { status: done.status });
      const data = done.data as { asset: Record<string, unknown>; assignment: { id: string } };
      const live = assetOf(asset.id)!;
      return custodyResponse(
        live,
        { assignment: data.assignment },
        201,
        `/v1/assets/${live.id}/assignments`,
      );
    });
  }),

  http.post('/v1/loaner-pools/:id/quick-checkout', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:checkout' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const body = await readBody(request);
    return idempotent(request, guard.user.id, body, () => {
      if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
      const errors = [
        ...rejectUnknown(body, ['person_id', 'borrower', 'codes', 'expected_return', 'note']),
        ...checkUuids(body, ['person_id']),
        ...checkText(body, 'borrower', { min: 1, max: 254 }),
        ...checkText(body, 'note', { max: 2000 }),
      ];
      if ((body.person_id === undefined) === (body.borrower === undefined)) {
        errors.push({
          pointer: '/',
          message: 'Send exactly one of person_id and borrower',
          code: 'invalid',
        });
      }
      const codes = body.codes;
      if (
        !Array.isArray(codes) ||
        codes.length < 1 ||
        codes.length > 50 ||
        !codes.every((c) => typeof c === 'string' && c.trim() && c.length <= 200)
      ) {
        errors.push({ pointer: '/codes', message: 'Send 1 to 50 codes.', code: 'invalid' });
      }
      if (
        body.expected_return !== undefined &&
        !/^\d{4}-\d{2}-\d{2}$/.test(String(body.expected_return))
      ) {
        errors.push({
          pointer: '/expected_return',
          message: 'Invalid date (YYYY-MM-DD)',
          code: 'invalid_format',
        });
      }
      if (errors.length > 0) return validation(errors);
      const pool = poolOf(String(params.id));
      if (!pool) return notFound('Loaner pool');
      if (!pool.is_active) {
        return problem(409, 'loaner-pool-inactive', 'The loaner pool is switched off');
      }
      const who = borrowerOf(pool, body);
      if ('response' in who) return who.response;
      const when = dueOf(pool, body);
      if ('response' in when) return when.response;
      if (!statusOfType('deployed')) return noLabel('deployed');

      const note = (body.note as string | undefined)?.trim() || null;
      const results = (codes as string[]).map((code, index) => {
        const resolved = resolveCode(code);
        if ('error' in resolved)
          return { index, code, status: resolved.status, error: resolved.error };
        const member = memberOf(resolved.asset.id);
        if (member?.loaner_pool_id !== pool.id) {
          const missing = notInPool(index);
          return { index, code, status: missing.status, error: missing.error };
        }
        const done = lendOne(pool, who.person, resolved.asset, when.due, note, guard.user.id);
        return { index, code, ...done };
      });
      const succeeded = results.filter((r) => r.status === 201).length;
      const { id, display_name, kind, email, employee_ref } = who.person;
      return HttpResponse.json({
        person: {
          id,
          display_name,
          kind,
          email: email ?? null,
          employee_ref: employee_ref ?? null,
        },
        loaner_pool_id: pool.id,
        expected_return: when.due,
        results,
        summary: { total: results.length, succeeded, failed: results.length - succeeded },
      });
    });
  }),

  http.post('/v1/loans/return', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:checkout' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const body = await readBody(request);
    return idempotent(request, guard.user.id, body, () => {
      if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
      const errors = [
        ...rejectUnknown(body, [
          'codes',
          'loaner_pool_id',
          'checkin_location_id',
          'status_id',
          'condition',
          'note',
        ]),
        ...checkUuids(
          body,
          ['loaner_pool_id', 'checkin_location_id', 'status_id'],
          ['checkin_location_id', 'status_id'],
        ),
        ...checkText(body, 'note', { max: 2000 }),
      ];
      const codes = body.codes;
      if (
        !Array.isArray(codes) ||
        codes.length < 1 ||
        codes.length > 100 ||
        !codes.every((c) => typeof c === 'string' && c.trim() && c.length <= 200)
      ) {
        errors.push({ pointer: '/codes', message: 'Send 1 to 100 codes.', code: 'invalid' });
      }
      if (
        body.condition !== undefined &&
        !['good', 'fair', 'poor', 'damaged'].includes(String(body.condition))
      ) {
        errors.push({ pointer: '/condition', message: 'Invalid option', code: 'invalid_value' });
      }
      if (errors.length > 0) return validation(errors);
      const only =
        typeof body.loaner_pool_id === 'string' ? poolOf(body.loaner_pool_id) : undefined;
      if (typeof body.loaner_pool_id === 'string' && !only) return notFound('Loaner pool');

      const results = (codes as string[]).map((code, index) => {
        const resolved = resolveCode(code);
        if ('error' in resolved)
          return { index, code, status: resolved.status, error: resolved.error };
        const member = memberOf(resolved.asset.id);
        const pool = member ? poolOf(member.loaner_pool_id) : undefined;
        if (!pool || (only && pool.id !== only.id)) {
          const missing = notInPool(index);
          return { index, code, status: missing.status, error: missing.error };
        }
        const asset = resolved.asset;
        const open = registry().assignments.find(
          (a) => a.asset_id === asset.id && !a.checked_in_at,
        );
        if (!asset.current_assignment || !open) {
          return {
            index,
            code,
            status: 409,
            error: problemBody(409, 'asset-not-checked-out', 'Asset is not checked out', {
              detail: 'The asset is not checked out.',
            }),
          };
        }
        const status =
          (typeof body.status_id === 'string'
            ? registry().statusLabels.find((s) => s.id === body.status_id)
            : undefined) ?? statusOfType('deployable', true);
        const location =
          'checkin_location_id' in body
            ? (body.checkin_location_id as string | null)
            : pool.home_location_id;
        const note = (body.note as string | undefined)?.trim() || null;
        const result = mutateRegistry((reg) => {
          const live = reg.assets.find((a) => a.id === asset.id)!;
          const assignment = reg.assignments.find((a) => a.id === open.id)!;
          const holder = live.current_assignment!;
          closeAssignment(assignment, guard.user.id, {
            locationId: location,
            note,
            attachmentIds: [],
            condition: (body.condition as string | undefined) ?? null,
          });
          const fromStatus = statusName(live.status_id);
          live.current_assignment = null;
          if (status) live.status_id = status.id;
          if (location) live.location_id = location;
          live.updated_at = nowIso();
          live._v += 1;
          pushEvent(
            reg,
            live,
            'checked_in',
            `Checked in from ${holder.target_name ?? holder.target_type}`,
            guard.user.id,
            { assignmentId: assignment.id },
            {
              assignment_id: assignment.id,
              target_type: holder.target_type,
              target_id: holder.target_id,
              target_name: holder.target_name ?? null,
              status: { from: fromStatus, to: status?.name ?? fromStatus },
              ...(note ? { note } : {}),
            },
          );
          return { live, assignment };
        });
        return {
          index,
          code,
          status: 200,
          data: {
            asset: expandAsset(result.live, []),
            assignment: assignmentView(result.assignment, false),
          },
        };
      });
      const succeeded = results.filter((r) => r.status === 200).length;
      return HttpResponse.json({
        results,
        summary: { total: results.length, succeeded, failed: results.length - succeeded },
      });
    });
  }),
];

// ---- loans: read, extend, overdue; dashboard; settings -----------------------------------------------

const readHandlers: HttpHandler[] = [
  http.get('/v1/loans', ({ request }) => {
    const guard = requireSession(request, { permission: 'loaner:read' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const query = new URL(request.url).searchParams;
    const wanted = (query.get('state') ?? 'on_loan,due_today,overdue').split(',').filter(Boolean);
    const within = query.get('due_within_days');
    const rows = loansOfPools().map((a) => ({ id: a.id, _v: 1, archived_at: null, a }));
    return paginate(
      request,
      rows,
      {
        sorts: {
          expected_return: (r) => r.a.expected_return,
          checked_out_at: (r) => r.a.checked_out_at,
        },
        defaultSort: 'expected_return',
        haystack: (r) => {
          const view = loanView(r.a);
          return [view.asset_tag, view.asset_name, view.person_name];
        },
        filter: (r, params) =>
          wanted.includes(loanState(r.a)) &&
          (!params.get('loaner_pool_id') || r.a.loaner_pool_id === params.get('loaner_pool_id')) &&
          (!params.get('person_id') || r.a.person_id === params.get('person_id')) &&
          (!params.get('asset_id') || r.a.asset_id === params.get('asset_id')) &&
          (within === null ||
            (!r.a.checked_in_at &&
              (r.a.expected_return ?? '9999') <= dayFromToday(Number(within)))),
      },
      ({ a }) => loanView(a),
    );
  }),

  http.get('/v1/loans/overdue', ({ request }) => {
    const guard = requireSession(request, { permission: 'loaner:read' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const today = todayUtc();
    const rows = registry()
      .assignments.filter(
        (a) =>
          a.asset_id &&
          !a.checked_in_at &&
          !!a.expected_return &&
          a.expected_return < today &&
          assetOf(a.asset_id),
      )
      .map((a) => ({
        id: a.id,
        _v: 1,
        archived_at: null,
        a,
        days: daysBetween(a.expected_return!, today),
      }));
    return paginate(
      request,
      rows,
      {
        sorts: { expected_return: (r) => r.a.expected_return, days_overdue: (r) => r.days },
        defaultSort: 'expected_return',
        filter: (r, params) =>
          (!params.get('loaner_pool_id') || r.a.loaner_pool_id === params.get('loaner_pool_id')) &&
          (!params.get('person_id') || r.a.person_id === params.get('person_id')),
      },
      ({ a, days }) => {
        const asset = assetOf(a.asset_id!)!;
        return {
          assignment_id: a.id,
          asset_id: a.asset_id,
          asset_tag: asset.asset_tag,
          asset_name: asset.name ?? null,
          person_id: a.person_id ?? null,
          location_id: a.location_id ?? null,
          target_asset_id: a.target_asset_id ?? null,
          holder_name: asset.current_assignment?.target_name ?? null,
          loaner_pool_id: a.loaner_pool_id ?? null,
          pool_name: w3().pools.find((p) => p.id === a.loaner_pool_id)?.name ?? null,
          expected_return: a.expected_return,
          days_overdue: Math.max(1, days),
        };
      },
    );
  }),

  http.get('/v1/loans/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'loaner:read' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const loan = loansOfPools().find((a) => a.id === params.id);
    return loan ? HttpResponse.json(loanView(loan)) : notFound('Loan');
  }),

  http.post('/v1/loans/:id/extend', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:checkout' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const loan = loansOfPools().find((a) => a.id === params.id);
    if (!loan) return notFound('Loan');
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = [
      ...rejectUnknown(body, ['expected_return', 'note']),
      ...checkText(body, 'note', { max: 500 }),
    ];
    if (
      typeof body.expected_return !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.expected_return)
    ) {
      errors.push({
        pointer: '/expected_return',
        message: 'Invalid date (YYYY-MM-DD)',
        code: 'invalid_format',
      });
    }
    if (errors.length > 0) return validation(errors);
    if (loan.checked_in_at) return fail('conflict', { detail: 'The loan is closed.' });
    const next = body.expected_return as string;
    const pool = poolOf(loan.loaner_pool_id!)!;
    const start = loan.checked_out_at.slice(0, 10);
    const refuse = (code: string, message: string) =>
      validation([{ pointer: '/expected_return', message, code }]);
    if (next <= (loan.expected_return ?? ''))
      return refuse('not-an-extension', 'must be later than the current due date');
    if (next < todayUtc()) return refuse('in-the-past', 'must not be in the past');
    if (pool.max_loan_days && next > dayFrom(start, pool.max_loan_days)) {
      return refuse(
        'exceeds-max-loan',
        `the pool allows ${pool.max_loan_days} days from the start of the loan`,
      );
    }
    const before = loan.expected_return;
    mutateRegistry((reg) => {
      const live = reg.assignments.find((a) => a.id === loan.id)!;
      live.expected_return = next;
      live._v += 1;
      const asset = reg.assets.find((a) => a.id === live.asset_id)!;
      if (asset.current_assignment)
        asset.current_assignment = { ...asset.current_assignment, expected_return: next };
      asset._v += 1;
      pushEvent(
        reg,
        asset,
        'updated',
        `Loan extended to ${next}`,
        guard.user.id,
        { assignmentId: live.id },
        {
          loan_extended: {
            from: before,
            to: next,
            note: (body.note as string | undefined) ?? null,
          },
        },
      );
    });
    return HttpResponse.json(loanView(loan));
  }),

  http.get('/v1/loaners/dashboard', ({ request }) => {
    const guard = requireSession(request, { permission: 'loaner:read' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const pools = w3().pools.filter((p) => !p.archived_at);
    const rows = pools.map((p) => ({
      id: p.id,
      name: p.name,
      is_active: p.is_active,
      ...poolStats(p),
    }));
    const sum = (key: keyof ReturnType<typeof poolStats>) => rows.reduce((n, r) => n + r[key], 0);
    const recent = loansOfPools()
      .flatMap((a) => {
        const view = loanView(a);
        const base = {
          assignment_id: a.id,
          asset_id: view.asset_id,
          asset_tag: view.asset_tag,
          asset_name: view.asset_name,
          person_id: view.person_id,
          person_name: view.person_name,
          loaner_pool_id: view.loaner_pool_id,
          pool_name: view.pool_name,
          expected_return: view.expected_return,
        };
        return [
          { ...base, at: a.checked_out_at, kind: 'checked_out' as const },
          ...(a.checked_in_at
            ? [{ ...base, at: a.checked_in_at, kind: 'checked_in' as const }]
            : []),
        ];
      })
      .sort((x, y) => y.at.localeCompare(x.at))
      .slice(0, 20);
    return HttpResponse.json({
      as_of: todayUtc(),
      totals: {
        pools: rows.length,
        members: sum('member_count'),
        available: sum('available_count'),
        checked_out: sum('checked_out_count'),
        overdue: sum('overdue_count'),
        due_today: sum('due_today_count'),
        due_soon: sum('due_soon_count'),
      },
      pools: rows,
      recent,
    });
  }),

  http.get('/v1/settings/custody', ({ request }) => {
    const guard = requireSession(request, { permission: 'catalog:read' });
    if (!guard.ok) return guard.response;
    const { _v, ...settings } = w3().custodySettings;
    return HttpResponse.json(settings, { headers: { ETag: etagOf(_v) } });
  }),

  http.put('/v1/settings/custody', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'catalog:manage' });
    if (!guard.ok) return guard.response;
    const current = w3().custodySettings;
    const stale = checkIfMatch(request, current._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = [
      ...rejectUnknown(body, ['default_expected_return_days', 'loan_reminder_days']),
      ...(body.default_expected_return_days === null
        ? []
        : checkInt(body, 'default_expected_return_days', { min: 1, max: 366 })),
      ...checkInt(body, 'loan_reminder_days', { min: 0, max: 30 }),
    ];
    if (errors.length > 0) return validation(errors);
    mutateW3((data) => {
      data.custodySettings = {
        default_expected_return_days:
          (body.default_expected_return_days as number | null | undefined) ?? null,
        loan_reminder_days: (body.loan_reminder_days as number | undefined) ?? 2,
        _v: current._v + 1,
      };
    });
    const { _v, ...settings } = w3().custodySettings;
    return HttpResponse.json(settings, { headers: { ETag: etagOf(_v) } });
  }),
];

export const loanerHandlers: HttpHandler[] = [...poolHandlers, ...loanHandlers, ...readHandlers];
