import { http, HttpResponse, type HttpHandler } from 'msw';
import { checkIfMatch, etagOf, problem, requireSession } from './http';
import {
  assignmentView,
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
  statusOfType,
  type Target,
} from './m2-handlers';
import type { MockAsset, MockPerson, RegistryData } from './registry-fixtures';
import {
  expandAsset,
  nowIso,
  paginate,
  readBody,
  validation,
  type Body,
} from './registry-handlers';
import { mutateRegistry, registry } from './registry-state';
import { checkInt, checkText, checkUuids, isUuid, rejectUnknown } from './w2-common';
import { mutateW3, newW3Id, w3, w3Id, type MockMember, type MockPool } from './w3-state';

/**
 * Mock handlers of the loaner endpoints of docs/engineering/openapi.yaml (tag Loaners): pools and
 * their members, the quick loan, overdue loans, recent activity and the organisation's loan
 * defaults. The loans are registry assignments (a loaner loan is an ordinary check-out that knows
 * its pool), so returns go through the asset check-in handler and the screens that show who holds
 * what stay consistent. The first request seeds two pools and four loans, one of them overdue and
 * one due today.
 */
const DAY = 86_400_000;
const todayUtc = () => new Date().toISOString().slice(0, 10);
const dayFromToday = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

const OWNER_ID = '0190a6b2-0000-7000-8000-000000000001';
const MANAGER_ID = '0190a6b2-0000-7000-8000-000000000007';

// ---- lending (the seed and the quick-loan endpoint share it) ------------------------------------

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
      default_loan_days: 7,
      max_loan_days: null,
      max_loans_per_person: null,
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
      ...chromebooks.map((a) => ({
        loaner_pool_id: students.id,
        asset_id: a.id,
        added_at: stamp,
      })),
      ...laptops.map((a) => ({ loaner_pool_id: staff.id, asset_id: a.id, added_at: stamp })),
    ];
    for (const asset of [...chromebooks, ...laptops]) {
      asset.loaner_pool_id = chromebooks.includes(asset) ? students.id : staff.id;
    }
    const loans: Array<[MockAsset | undefined, MockPool, number, number]> = [
      [chromebooks[0], students, 0, 4],
      [chromebooks[1], students, 1, -5],
      [chromebooks[2], students, 2, 0],
      [laptops[0], staff, 3, 10],
    ];
    for (const [asset, owner, who, due] of loans) {
      const borrower = borrowers[who];
      if (asset && borrower) {
        lend(data, asset, borrower, owner, dayFromToday(due), MANAGER_ID, null);
      }
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

function poolView(pool: MockPool) {
  const { _v: _ignored, ...pub } = pool;
  const assets = w3()
    .members.filter((m) => m.loaner_pool_id === pool.id)
    .map((m) => assetOf(m.asset_id))
    .filter((a): a is MockAsset => !!a && !a.archived_at);
  const out = assets.filter((a) => a.current_assignment);
  const today = todayUtc();
  return {
    ...pub,
    member_count: assets.length,
    checked_out_count: out.length,
    overdue_count: out.filter((a) => (a.current_assignment!.expected_return ?? '9') < today).length,
    due_today_count: out.filter((a) => a.current_assignment!.expected_return === today).length,
  };
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
    available: !asset.current_assignment,
    asset: expandAsset(asset, []),
  };
}

// ---- validation -------------------------------------------------------------------------------------

const POOL_KEYS = [
  'name',
  'description',
  'home_location_id',
  'default_loan_days',
  'max_loan_days',
  'max_loans_per_person',
  'is_active',
] as const;

function validatePool(body: Body, creating: boolean, existing?: MockPool) {
  const errors = [
    ...rejectUnknown(body, POOL_KEYS),
    ...checkText(body, 'name', { min: 1, max: 200, required: creating }),
    ...checkText(body, 'description', { max: 2000, nullable: true }),
    ...checkUuids(body, ['home_location_id'], ['home_location_id']),
    ...checkInt(body, 'default_loan_days', { min: 1 }),
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
  if (typeof body.home_location_id === 'string' && isUuid(body.home_location_id)) {
    if (!registry().locations.some((l) => l.id === body.home_location_id && !l.archived_at)) {
      errors.push({
        pointer: '/home_location_id',
        message: 'No such location.',
        code: 'not-found',
      });
    }
  }
  const days = (body.default_loan_days as number | undefined) ?? existing?.default_loan_days ?? 7;
  const max =
    body.max_loan_days === undefined ? (existing?.max_loan_days ?? null) : body.max_loan_days;
  if (typeof max === 'number' && Number.isInteger(days) && max < days) {
    errors.push({
      pointer: '/max_loan_days',
      message: 'must be at least the default loan length',
      code: 'invalid',
    });
  }
  return errors;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ---- handlers ---------------------------------------------------------------------------------------

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
          return active === null || p.is_active === (active === 'true');
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
      default_loan_days: (body.default_loan_days as number | undefined) ?? 7,
      max_loan_days: (body.max_loan_days as number | null | undefined) ?? null,
      max_loans_per_person: (body.max_loans_per_person as number | null | undefined) ?? null,
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
    const pool = w3().pools.find((p) => p.id === params.id);
    return pool ? onePool(pool) : notFound('Loaner pool');
  }),

  http.patch('/v1/loaner-pools/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:manage' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const pool = w3().pools.find((p) => p.id === params.id);
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
      if (typeof body.default_loan_days === 'number')
        pool.default_loan_days = body.default_loan_days;
      if ('max_loan_days' in body) pool.max_loan_days = body.max_loan_days as number | null;
      if ('max_loans_per_person' in body) {
        pool.max_loans_per_person = body.max_loans_per_person as number | null;
      }
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
    const pool = w3().pools.find((p) => p.id === params.id);
    if (!pool) return notFound('Loaner pool');
    const stale = checkIfMatch(request, pool._v);
    if (stale) return stale;
    const out = poolView(pool).checked_out_count;
    if (out > 0) return inUse('The loaner pool', { open_assignments: out });
    mutateW3((data) => {
      pool.archived_at = nowIso();
      pool._v += 1;
      for (const member of data.members.filter((m) => m.loaner_pool_id === pool.id)) {
        const asset = assetOf(member.asset_id);
        if (asset) asset.loaner_pool_id = null;
      }
      data.members = data.members.filter((m) => m.loaner_pool_id !== pool.id);
    });
    mutateRegistry(() => undefined);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/v1/loaner-pools/:id/members', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'loaner:read' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const pool = w3().pools.find((p) => p.id === params.id);
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
          if (available === null) return true;
          return !assetOf(r.id)?.current_assignment === (available === 'true');
        },
      },
      (row) => memberView(row.member),
    );
  }),

  http.post('/v1/loaner-pools/:id/members', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:manage' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const pool = w3().pools.find((p) => p.id === params.id && !p.archived_at);
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
    const asset = assetOf(String(body.asset_id));
    if (!asset || asset.archived_at) {
      return validation([{ pointer: '/asset_id', message: 'No such asset.', code: 'not-found' }]);
    }
    const existing = w3().members.find((m) => m.asset_id === asset.id);
    if (existing) {
      const other = w3().pools.find((p) => p.id === existing.loaner_pool_id);
      return fail('conflict', {
        detail:
          existing.loaner_pool_id === pool.id
            ? 'The asset is already in this pool.'
            : `The asset already belongs to the pool "${other?.name ?? 'another pool'}".`,
      });
    }
    const member: MockMember = { loaner_pool_id: pool.id, asset_id: asset.id, added_at: nowIso() };
    mutateW3((data) => data.members.push(member));
    mutateRegistry(() => {
      asset.loaner_pool_id = pool.id;
    });
    return HttpResponse.json(memberView(member), { status: 201 });
  }),

  http.delete('/v1/loaner-pools/:id/members/:assetId', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:manage' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const member = w3().members.find(
      (m) => m.loaner_pool_id === params.id && m.asset_id === params.assetId,
    );
    if (!member) return notFound('Pool member');
    const asset = assetOf(member.asset_id);
    if (asset?.current_assignment) {
      return inUse('The asset', { open_assignments: 1 });
    }
    mutateW3((data) => {
      data.members = data.members.filter((m) => m !== member);
    });
    mutateRegistry(() => {
      if (asset) asset.loaner_pool_id = null;
    });
    return new HttpResponse(null, { status: 204 });
  }),
];

// ---- the quick loan -----------------------------------------------------------------------------------

const loanProblem = (code: string, title: string, detail: string) =>
  problem(409, code, title, { detail });

const checkoutHandler = http.post('/v1/loaner-pools/:id/checkout', async ({ request, params }) => {
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

    const pool = w3().pools.find((p) => p.id === params.id && !p.archived_at);
    if (!pool) return notFound('Loaner pool');
    if (!pool.is_active) {
      return fail('conflict', { detail: 'The loaner pool is switched off.' });
    }
    const data = registry();
    const person = data.people.find((p) => p.id === body.person_id && !p.archived_at);
    if (!person) {
      return validation([{ pointer: '/person_id', message: 'No such person.', code: 'not-found' }]);
    }
    if (person.status !== 'active') {
      return validation([
        {
          pointer: '/person_id',
          message: 'inactive people cannot receive assets',
          code: 'inactive',
        },
      ]);
    }
    const due =
      (body.expected_return as string | undefined) ?? dayFromToday(pool.default_loan_days);
    const latest = pool.max_loan_days ? dayFromToday(pool.max_loan_days) : null;
    if (due < todayUtc() || (latest && due > latest)) {
      return validation([
        {
          pointer: '/expected_return',
          message: latest
            ? `must be between today and ${latest} (the pool allows ${pool.max_loan_days} days)`
            : 'must not be in the past',
          code: 'invalid',
        },
      ]);
    }

    const members = w3()
      .members.filter((m) => m.loaner_pool_id === pool.id)
      .map((m) => assetOf(m.asset_id))
      .filter((a): a is MockAsset => !!a && !a.archived_at)
      .sort((a, b) => a.asset_tag.localeCompare(b.asset_tag));
    let asset: MockAsset | undefined;
    if (typeof body.asset_id === 'string') {
      asset = members.find((a) => a.id === body.asset_id);
      if (!asset) {
        return validation([
          { pointer: '/asset_id', message: 'The asset is not in this pool.', code: 'not-found' },
        ]);
      }
      const refusal = refuseAssetAction('checkout', asset);
      if (refusal) return fail(refusal.code, { detail: refusal.detail });
    } else {
      asset = members.find((a) => refuseAssetAction('checkout', a) === null);
      if (!asset) {
        return loanProblem(
          'no-loaner-available',
          'No loaner available',
          'Every device of this pool is out or cannot be lent right now.',
        );
      }
    }
    const holding = data.assignments.filter(
      (a) => a.person_id === person.id && a.loaner_pool_id === pool.id && !a.checked_in_at,
    ).length;
    if (pool.max_loans_per_person && holding >= pool.max_loans_per_person) {
      return loanProblem(
        'loan-limit-reached',
        'Loan limit reached',
        `${person.display_name} already has ${holding} device${holding === 1 ? '' : 's'} from this pool, the most it allows.`,
      );
    }
    if (!statusOfType('deployed')) return noLabel('deployed');
    const result = mutateRegistry((reg) => {
      const live = reg.assets.find((a) => a.id === asset!.id)!;
      const assignment = lend(
        reg,
        live,
        person,
        pool,
        due,
        guard.user.id,
        (body.note as string | undefined)?.trim() || null,
      );
      return { live, assignment };
    });
    return custodyResponse(
      result.live,
      { assignment: assignmentView(result.assignment, false) },
      201,
      `/v1/assets/${result.live.id}/assignments`,
    );
  });
});

// ---- overdue, activity, defaults ---------------------------------------------------------------------

const readHandlers: HttpHandler[] = [
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
        days: Math.max(1, Math.round((Date.parse(today) - Date.parse(a.expected_return!)) / DAY)),
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
        const person = a.person_id ? registry().people.find((p) => p.id === a.person_id) : null;
        return {
          assignment_id: a.id,
          asset_id: a.asset_id,
          asset_tag: asset.asset_tag,
          asset_name: asset.name ?? null,
          person_id: a.person_id ?? null,
          person_name: person?.display_name ?? null,
          person_email: person?.email ?? null,
          person_phone: person?.phone ?? null,
          location_id: a.location_id ?? null,
          target_asset_id: a.target_asset_id ?? null,
          loaner_pool_id: a.loaner_pool_id ?? null,
          expected_return: a.expected_return,
          days_overdue: days,
        };
      },
    );
  }),

  http.get('/v1/loans/activity', ({ request }) => {
    const guard = requireSession(request, { permission: 'loaner:read' });
    if (!guard.ok) return guard.response;
    ensureSeed();
    const poolOf = new Map(w3().members.map((m) => [m.asset_id, m.loaner_pool_id]));
    const rows = registry()
      .history.filter(
        (e) =>
          (e.event_type === 'checked_out' || e.event_type === 'checked_in') &&
          e.asset_id &&
          poolOf.has(e.asset_id),
      )
      .map((e) => ({ id: e.id, _v: 1, archived_at: null, e }));
    return paginate(
      request,
      rows,
      {
        sorts: { at: (r) => r.e.at },
        defaultSort: '-at',
        filter: (r, params) =>
          !params.get('loaner_pool_id') ||
          poolOf.get(r.e.asset_id!) === params.get('loaner_pool_id'),
      },
      ({ e }) => {
        const asset = assetOf(e.asset_id!)!;
        const payload = (e.payload ?? {}) as Record<string, unknown>;
        const person = payload.target_type === 'person';
        return {
          id: e.id,
          at: e.at,
          kind: e.event_type === 'checked_out' ? 'checked_out' : 'returned',
          asset_id: asset.id,
          asset_tag: asset.asset_tag,
          asset_name: asset.name ?? null,
          person_id: person ? ((payload.target_id as string | undefined) ?? null) : null,
          person_name: person ? ((payload.target_name as string | undefined) ?? null) : null,
          loaner_pool_id: poolOf.get(asset.id) ?? null,
          expected_return: (payload.expected_return as string | null | undefined) ?? null,
        };
      },
    );
  }),

  http.get('/v1/settings/loans', ({ request }) => {
    const guard = requireSession(request, { permission: 'loaner:read' });
    if (!guard.ok) return guard.response;
    const { _v, ...settings } = w3().loanSettings;
    return HttpResponse.json(settings, { headers: { ETag: etagOf(_v) } });
  }),

  http.put('/v1/settings/loans', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'loaner:manage' });
    if (!guard.ok) return guard.response;
    const current = w3().loanSettings;
    const stale = checkIfMatch(request, current._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = [
      ...rejectUnknown(body, ['default_loan_days', 'max_loan_days', 'reminder_lead_days']),
      ...checkInt(body, 'default_loan_days', { min: 1, required: true }),
      ...(body.max_loan_days === null
        ? []
        : checkInt(body, 'max_loan_days', { min: 1, required: true })),
      ...checkInt(body, 'reminder_lead_days', { min: 0, required: true }),
    ];
    if (
      errors.length === 0 &&
      typeof body.max_loan_days === 'number' &&
      body.max_loan_days < (body.default_loan_days as number)
    ) {
      errors.push({
        pointer: '/max_loan_days',
        message: 'must be at least the default loan length',
        code: 'invalid',
      });
    }
    if (errors.length > 0) return validation(errors);
    mutateW3((data) => {
      data.loanSettings = {
        default_loan_days: body.default_loan_days as number,
        max_loan_days: body.max_loan_days as number | null,
        reminder_lead_days: body.reminder_lead_days as number,
        _v: current._v + 1,
      };
    });
    const { _v, ...settings } = w3().loanSettings;
    return HttpResponse.json(settings, { headers: { ETag: etagOf(_v) } });
  }),
];

export const loanerHandlers: HttpHandler[] = [...poolHandlers, checkoutHandler, ...readHandlers];

export { OWNER_ID };
