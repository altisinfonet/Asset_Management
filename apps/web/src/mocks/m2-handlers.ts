import type { components } from '@assettracker/api-client';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { subtreeIds } from '@/lib/registry/locations';
import { checkIfMatch, etagOf, problem, requireSession } from './http';
import {
  newResourceId,
  type MockAsset,
  type MockAssignment,
  type MockAttachment,
  type MockLocation,
  type MockPerson,
} from './registry-fixtures';
import {
  csv,
  expandAsset,
  nowIso,
  paginate,
  readBody,
  strip,
  text,
  validation,
  type Body,
  type FieldError,
} from './registry-handlers';
import { mutateRegistry, registry } from './registry-state';
import { onMockReset } from './state';

/**
 * Mock handlers of the M2 wave 1 endpoints of docs/engineering/openapi.yaml: locations, people,
 * check-out / check-in / transfer (with `Idempotency-Key` replay and optional `If-Match`), the
 * asset history with actors, scan resolve, and attachments (create, presigned PUT, complete, scan
 * states, download, delete). Same conventions as the registry handlers: cursor pagination bound to
 * sort and filters, weak ETags, problem+json with `errors[]` pointers, server-side permissions.
 */
type S = components['schemas'];

const notFound = () => problem(404, 'not-found', 'Not found');

/** What a refused change of something still in use answers: the sentence and the `usage` counts. */
function inUse(label: string, usage: Record<string, number>) {
  const parts = Object.entries(usage)
    .filter(([, n]) => n > 0)
    .map(([what, n]) => `${what}: ${n}`);
  return parts.length
    ? { detail: `${label} is in use (${parts.join(', ')}) and cannot be deleted.`, usage }
    : undefined;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function rejectUnknown(body: Body, allowed: readonly string[]): FieldError[] {
  return Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ pointer: `/${key}`, message: 'is not allowed', code: 'unrecognized_keys' }));
}

const conflict = (message: string, pointer: string) =>
  problem(409, 'conflict', message, { errors: [{ pointer, message, code: 'unique' }] });

// ==== locations ==================================================================================

const LOCATION_KINDS = ['site', 'building', 'floor', 'room', 'storage', 'vehicle', 'other'];
const LOCATION_KEYS = [
  'parent_id',
  'company_id',
  'name',
  'kind',
  'code',
  'address',
  'latitude',
  'longitude',
  'notes',
] as const;
const MAX_DEPTH = 8;

function locationView(location: MockLocation) {
  const data = registry();
  const live = data.locations.filter((l) => !l.archived_at);
  const ids = subtreeIds(live, location.id);
  const count = data.assets.filter(
    (a) => !a.archived_at && a.location_id && ids.has(a.location_id),
  ).length;
  return { ...strip(location), asset_count: count };
}

function oneLocation(location: MockLocation, status = 200, headers: Record<string, string> = {}) {
  return HttpResponse.json(locationView(location), {
    status,
    headers: { ETag: etagOf(location._v), ...headers },
  });
}

function validateLocation(body: Body, existing?: MockLocation): FieldError[] | Response {
  const data = registry();
  const errors = rejectUnknown(body, LOCATION_KEYS);
  if (!existing || 'name' in body) {
    const name = text(body.name);
    if (!name) errors.push({ pointer: '/name', message: 'is required', code: 'required' });
    else if (name.length > 200) {
      errors.push({ pointer: '/name', message: 'must be at most 200 characters', code: 'too_big' });
    }
  }
  if ('kind' in body && !LOCATION_KINDS.includes(String(body.kind))) {
    errors.push({
      pointer: '/kind',
      message: `must be one of ${LOCATION_KINDS.join(', ')}`,
      code: 'invalid_enum',
    });
  }
  if ('code' in body && body.code !== null && typeof body.code !== 'string') {
    errors.push({ pointer: '/code', message: 'must be text', code: 'invalid_type' });
  }
  if ('address' in body && body.address !== null) {
    const address = body.address as Record<string, unknown> | undefined;
    if (typeof address !== 'object' || Array.isArray(address)) {
      errors.push({ pointer: '/address', message: 'must be an object', code: 'invalid_type' });
    } else if (
      typeof address.country === 'string' &&
      address.country !== '' &&
      !/^[A-Z]{2}$/.test(address.country)
    ) {
      errors.push({
        pointer: '/address/country',
        message: 'must be a two-letter country code',
        code: 'invalid_format',
      });
    }
  }
  if ('parent_id' in body && body.parent_id !== null) {
    const parent = data.locations.find((l) => l.id === body.parent_id && !l.archived_at);
    if (!parent) {
      errors.push({ pointer: '/parent_id', message: 'does not exist', code: 'not_found' });
    } else if (existing && subtreeIds(data.locations, existing.id).has(parent.id)) {
      errors.push({
        pointer: '/parent_id',
        message: 'cannot be the location itself or anything inside it',
        code: 'cycle',
      });
    } else if ((parent.depth ?? 0) + 1 >= MAX_DEPTH) {
      errors.push({
        pointer: '/parent_id',
        message: `locations can be nested at most ${MAX_DEPTH} levels deep`,
        code: 'too_deep',
      });
    }
  }
  if (errors.length > 0) return errors;
  const name = text(body.name) ?? existing?.name ?? '';
  const parentId =
    'parent_id' in body
      ? ((body.parent_id as string | null) ?? null)
      : (existing?.parent_id ?? null);
  const clash = data.locations.some(
    (l) =>
      l.id !== existing?.id &&
      !l.archived_at &&
      (l.parent_id ?? null) === parentId &&
      sameName(l.name, name),
  );
  return clash ? conflict('A location with this name already exists here', '/name') : [];
}

/** Recompute `depth` and `ancestor_ids` of a location and everything below it after a move. */
function relocate(locations: MockLocation[], root: MockLocation) {
  const place = (node: MockLocation, parent: MockLocation | undefined) => {
    node.depth = parent ? (parent.depth ?? 0) + 1 : 0;
    node.ancestor_ids = [...(parent ? (parent.ancestor_ids ?? []) : []), node.id];
    for (const child of locations.filter((l) => l.parent_id === node.id)) place(child, node);
  };
  place(
    root,
    locations.find((l) => l.id === root.parent_id),
  );
}

const locationHandlers: HttpHandler[] = [
  http.get('/v1/locations', ({ request }) => {
    const guard = requireSession(request, { permission: 'location:read' });
    if (!guard.ok) return guard.response;
    return paginate(
      request,
      registry().locations,
      {
        sorts: { name: (l) => l.name, depth: (l) => l.depth, created_at: (l) => l.created_at },
        defaultSort: 'name',
        haystack: (l) => [l.name, l.code],
        filter: (l, p) => {
          if (p.get('parent_id') && l.parent_id !== p.get('parent_id')) return false;
          if (p.get('root') === 'true' && l.parent_id) return false;
          const below = p.get('descendants_of');
          if (below && !(subtreeIds(registry().locations, below).has(l.id) && l.id !== below)) {
            return false;
          }
          const kinds = csv(p, 'kind');
          return kinds.length === 0 || kinds.includes(l.kind ?? 'other');
        },
      },
      (l) => locationView(l),
    );
  }),

  http.get('/v1/locations/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'location:read' });
    if (!guard.ok) return guard.response;
    const found = registry().locations.find((l) => l.id === params.id);
    return found ? oneLocation(found) : notFound();
  }),

  http.post('/v1/locations', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'location:manage' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    const outcome = validateLocation(body);
    if (outcome instanceof Response) return outcome;
    if (outcome.length > 0) return validation(outcome);
    const created = mutateRegistry((data) => {
      const stamp = nowIso();
      const parent = data.locations.find((l) => l.id === body.parent_id);
      const id = newResourceId('location');
      const location: MockLocation = {
        id,
        created_at: stamp,
        updated_at: stamp,
        archived_at: null,
        parent_id: parent?.id ?? null,
        company_id:
          (body.company_id as string | undefined) ?? '0190a6b2-0000-7000-8000-0000000000c0',
        name: text(body.name)!,
        kind: (body.kind as MockLocation['kind']) ?? 'other',
        code: text(body.code) ?? null,
        address: (body.address as MockLocation['address']) ?? null,
        latitude: (body.latitude as number | null | undefined) ?? null,
        longitude: (body.longitude as number | null | undefined) ?? null,
        notes: text(body.notes) ?? null,
        depth: parent ? (parent.depth ?? 0) + 1 : 0,
        ancestor_ids: [...(parent?.ancestor_ids ?? []), id],
        _v: 1,
      };
      data.locations.push(location);
      return location;
    });
    return oneLocation(created, 201, { Location: `/v1/locations/${created.id}` });
  }),

  http.patch('/v1/locations/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'location:manage' });
    if (!guard.ok) return guard.response;
    const existing = registry().locations.find((l) => l.id === params.id);
    if (!existing) return notFound();
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    const outcome = validateLocation(body, existing);
    if (outcome instanceof Response) return outcome;
    if (outcome.length > 0) return validation(outcome);
    const updated = mutateRegistry((data) => {
      const target = data.locations.find((l) => l.id === existing.id)!;
      if (body.name !== undefined) target.name = text(body.name)!;
      if (body.kind !== undefined) target.kind = body.kind as MockLocation['kind'];
      if (body.code !== undefined) target.code = text(body.code) ?? null;
      if (body.notes !== undefined) target.notes = text(body.notes) ?? null;
      if (body.address !== undefined) target.address = body.address as MockLocation['address'];
      if (body.latitude !== undefined) target.latitude = body.latitude as number | null;
      if (body.longitude !== undefined) target.longitude = body.longitude as number | null;
      if (body.parent_id !== undefined && body.parent_id !== target.parent_id) {
        target.parent_id = body.parent_id as string | null;
        relocate(data.locations, target);
      }
      target.updated_at = nowIso();
      target._v += 1;
      return target;
    });
    return oneLocation(updated);
  }),

  http.delete('/v1/locations/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'location:manage' });
    if (!guard.ok) return guard.response;
    const data = registry();
    const existing = data.locations.find((l) => l.id === params.id);
    if (!existing) return notFound();
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    const ids = subtreeIds(
      data.locations.filter((l) => !l.archived_at),
      existing.id,
    );
    const reason = inUse('The location', {
      assets: data.assets.filter((a) => !a.archived_at && a.location_id && ids.has(a.location_id))
        .length,
      children: data.locations.filter((l) => !l.archived_at && l.parent_id === existing.id).length,
    });
    if (reason) return problem(409, 'conflict', 'The location is in use', reason);
    mutateRegistry((d) => {
      const target = d.locations.find((l) => l.id === existing.id)!;
      target.archived_at = nowIso();
      target._v += 1;
    });
    return new HttpResponse(null, { status: 204 });
  }),
];

// ==== people =====================================================================================

const PERSON_KINDS = ['employee', 'student', 'contractor', 'external'];
const PERSON_KEYS = [
  'kind',
  'display_name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'employee_ref',
  'department',
  'job_title',
  'location_id',
  'company_id',
  'status',
  'notes',
] as const;

function personView(person: MockPerson) {
  return strip(person);
}

function onePerson(person: MockPerson, status = 200, headers: Record<string, string> = {}) {
  return HttpResponse.json(personView(person), {
    status,
    headers: { ETag: etagOf(person._v), ...headers },
  });
}

function validatePerson(body: Body, existing?: MockPerson): FieldError[] | Response {
  const data = registry();
  const errors = rejectUnknown(body, PERSON_KEYS);
  if (!existing || 'display_name' in body) {
    const name = text(body.display_name);
    if (!name) errors.push({ pointer: '/display_name', message: 'is required', code: 'required' });
    else if (name.length > 200) {
      errors.push({
        pointer: '/display_name',
        message: 'must be at most 200 characters',
        code: 'too_big',
      });
    }
  }
  if ('kind' in body && !PERSON_KINDS.includes(String(body.kind))) {
    errors.push({
      pointer: '/kind',
      message: `must be one of ${PERSON_KINDS.join(', ')}`,
      code: 'invalid_enum',
    });
  }
  if ('status' in body && !['active', 'inactive'].includes(String(body.status))) {
    errors.push({
      pointer: '/status',
      message: 'must be active or inactive',
      code: 'invalid_enum',
    });
  }
  if ('email' in body && body.email !== null && body.email !== '') {
    if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      errors.push({
        pointer: '/email',
        message: 'must be a valid e-mail address',
        code: 'invalid_format',
      });
    }
  }
  if ('location_id' in body && body.location_id) {
    if (!data.locations.some((l) => l.id === body.location_id && !l.archived_at)) {
      errors.push({ pointer: '/location_id', message: 'does not exist', code: 'not_found' });
    }
  }
  if (errors.length > 0) return errors;

  const email = text(body.email)?.toLowerCase();
  if (email && data.people.some((p) => p.id !== existing?.id && p.email?.toLowerCase() === email)) {
    return conflict('This e-mail address is already in use', '/email');
  }
  const ref = text(body.employee_ref);
  if (ref && data.people.some((p) => p.id !== existing?.id && p.employee_ref === ref)) {
    return conflict('This employee or student number is already in use', '/employee_ref');
  }
  return [];
}

const openAssignmentsOf = (personId: string) =>
  registry().assignments.filter((a) => a.person_id === personId && !a.checked_in_at);

const personHandlers: HttpHandler[] = [
  http.get('/v1/people', ({ request }) => {
    const guard = requireSession(request, { permission: 'person:read' });
    if (!guard.ok) return guard.response;
    return paginate(
      request,
      registry().people,
      {
        sorts: {
          display_name: (p) => p.display_name,
          created_at: (p) => p.created_at,
          employee_ref: (p) => p.employee_ref,
        },
        defaultSort: 'display_name',
        haystack: (p) => [p.display_name, p.email, p.employee_ref, p.department],
        filter: (p, params) => {
          const kinds = csv(params, 'kind');
          if (kinds.length > 0 && !kinds.includes(p.kind ?? 'employee')) return false;
          if (params.get('status') && p.status !== params.get('status')) return false;
          if (params.get('department') && p.department !== params.get('department')) return false;
          if (params.get('location_id') && p.location_id !== params.get('location_id'))
            return false;
          if (params.get('employee_ref') && p.employee_ref !== params.get('employee_ref'))
            return false;
          const login = params.get('has_login');
          if (login === 'true' && !p.user_id) return false;
          if (login === 'false' && p.user_id) return false;
          return true;
        },
      },
      (p) => personView(p),
    );
  }),

  http.get('/v1/people/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'person:read' });
    if (!guard.ok) return guard.response;
    const found = registry().people.find((p) => p.id === params.id);
    return found ? onePerson(found) : notFound();
  }),

  http.post('/v1/people', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'person:manage' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    const outcome = validatePerson(body);
    if (outcome instanceof Response) return outcome;
    if (outcome.length > 0) return validation(outcome);
    const created = mutateRegistry((data) => {
      const stamp = nowIso();
      const person: MockPerson = {
        id: newResourceId('person'),
        created_at: stamp,
        updated_at: stamp,
        archived_at: null,
        kind: (body.kind as MockPerson['kind']) ?? 'employee',
        display_name: text(body.display_name)!,
        first_name: text(body.first_name) ?? null,
        last_name: text(body.last_name) ?? null,
        email: text(body.email) ?? null,
        phone: text(body.phone) ?? null,
        employee_ref: text(body.employee_ref) ?? null,
        department: text(body.department) ?? null,
        job_title: text(body.job_title) ?? null,
        location_id: text(body.location_id) ?? null,
        company_id:
          (body.company_id as string | undefined) ?? '0190a6b2-0000-7000-8000-0000000000c0',
        status: (body.status as MockPerson['status']) ?? 'active',
        notes: text(body.notes) ?? null,
        user_id: null,
        _v: 1,
      };
      data.people.push(person);
      return person;
    });
    return onePerson(created, 201, { Location: `/v1/people/${created.id}` });
  }),

  http.patch('/v1/people/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'person:manage' });
    if (!guard.ok) return guard.response;
    const existing = registry().people.find((p) => p.id === params.id);
    if (!existing) return notFound();
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    const outcome = validatePerson(body, existing);
    if (outcome instanceof Response) return outcome;
    if (outcome.length > 0) return validation(outcome);
    if (body.status === 'inactive' && existing.status !== 'inactive') {
      const held = openAssignmentsOf(existing.id).length;
      if (held > 0) {
        return problem(409, 'conflict', 'The person still holds assets', {
          detail: `${existing.display_name} still holds ${held} asset(s). Check them in before making the person inactive.`,
          usage: { open_assignments: held },
        });
      }
    }
    const updated = mutateRegistry((data) => {
      const target = data.people.find((p) => p.id === existing.id)!;
      const simple = [
        'first_name',
        'last_name',
        'email',
        'phone',
        'employee_ref',
        'department',
        'job_title',
        'location_id',
        'notes',
      ] as const;
      for (const key of simple) {
        if (body[key] !== undefined)
          (target as Record<string, unknown>)[key] = text(body[key]) ?? null;
      }
      if (body.display_name !== undefined) target.display_name = text(body.display_name)!;
      if (body.kind !== undefined) target.kind = body.kind as MockPerson['kind'];
      if (body.status !== undefined) target.status = body.status as MockPerson['status'];
      target.updated_at = nowIso();
      target._v += 1;
      // Assets held by this person show the new name.
      for (const asset of data.assets) {
        if (asset.current_assignment?.target_id === target.id) {
          asset.current_assignment.target_name = target.display_name;
        }
      }
      return target;
    });
    return onePerson(updated);
  }),

  http.delete('/v1/people/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'person:manage' });
    if (!guard.ok) return guard.response;
    const existing = registry().people.find((p) => p.id === params.id);
    if (!existing) return notFound();
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    const reason = inUse('The person', { open_assignments: openAssignmentsOf(existing.id).length });
    if (reason) return problem(409, 'conflict', 'The person still holds assets', reason);
    mutateRegistry((data) => {
      const target = data.people.find((p) => p.id === existing.id)!;
      target.archived_at = nowIso();
      target._v += 1;
    });
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/v1/people/:id/assignments', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'person:read' });
    if (!guard.ok) return guard.response;
    const person = registry().people.find((p) => p.id === params.id);
    if (!person) return notFound();
    const state = new URL(request.url).searchParams.get('state') ?? 'open';
    if (!['open', 'closed', 'all'].includes(state)) {
      return problem(400, 'bad-request', 'state must be open, closed or all', {
        errors: [{ pointer: 'query:state', message: 'must be open, closed or all' }],
      });
    }
    return paginate(
      request,
      registry().assignments.filter(
        (a) =>
          a.person_id === person.id &&
          (state === 'all' || (state === 'open' ? !a.checked_in_at : !!a.checked_in_at)),
      ),
      {
        sorts: { checked_out_at: (a) => a.checked_out_at },
        defaultSort: '-checked_out_at',
      },
      (a) => strip(a),
    );
  }),
];

// ==== history, assignments, scan resolve ===========================================================

function actorOf(actorId: string | null | undefined) {
  if (!actorId) return null;
  const user = registry().users.find((u) => u.id === actorId);
  return user ? { id: user.id, display_name: user.display_name } : null;
}

const readHandlers: HttpHandler[] = [
  http.get('/v1/assets/:id/history', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const asset = registry().assets.find((a) => a.id === params.id);
    if (!asset) return notFound();
    const events = registry()
      .history.filter((e) => e.asset_id === asset.id)
      .map((e) => ({ ...e, _v: 0 }));
    return paginate(
      request,
      events,
      {
        sorts: { at: (e) => e.at },
        defaultSort: '-at',
        filter: (e, p) => {
          const types = csv(p, 'event_type');
          if (types.length > 0 && !types.includes(e.event_type)) return false;
          const from = p.get('from');
          if (from && e.at < from) return false;
          const to = p.get('to');
          return !(to && e.at >= to);
        },
      },
      (e) => {
        const { _v: _ignored, ...pub } = e;
        return { ...pub, actor: actorOf(pub.actor_id), payload: pub.payload ?? {} };
      },
    );
  }),

  http.get('/v1/assets/:id/assignments', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const asset = registry().assets.find((a) => a.id === params.id);
    if (!asset) return notFound();
    return paginate(
      request,
      registry().assignments.filter((a) => a.asset_id === asset.id),
      { sorts: { checked_out_at: (a) => a.checked_out_at }, defaultSort: '-checked_out_at' },
      (a) => strip(a),
    );
  }),

  http.get('/v1/scan/resolve', ({ request }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const raw = new URL(request.url).searchParams.get('code')?.trim();
    if (!raw) {
      return problem(400, 'bad-request', 'code is required', {
        errors: [{ pointer: 'query:code', message: 'is required' }],
      });
    }
    const code = raw.toLowerCase();
    const assets = registry().assets;
    const byLabel = assets.find((a) => a.label_code?.toLowerCase() === code);
    const found = byLabel ?? assets.find((a) => a.asset_tag.toLowerCase() === code);
    if (!found) return problem(404, 'not-found', 'Nothing matches this code');
    return HttpResponse.json({
      match_type: byLabel ? 'label_code' : 'asset_tag',
      asset: expandAsset(found, []),
      allowed_actions: allowedActions(found, guard.user.permissions),
    });
  }),
];

const holds = (permissions: string[], needed: string) =>
  permissions.includes('*') ||
  permissions.includes(needed) ||
  permissions.includes(`${needed.split(':')[0]}:*`);

/** The actions valid for the asset in its current state and for the caller (`ScanResolveResult`). */
function allowedActions(
  asset: MockAsset,
  permissions: string[],
): S['ScanResolveResult']['allowed_actions'] {
  if (asset.archived_at) return [];
  const state = registry().statusLabels.find((s) => s.id === asset.status_id)?.state_type;
  const actions: S['ScanResolveResult']['allowed_actions'] = [];
  const add = (action: S['ScanResolveResult']['allowed_actions'][number], needed: string) => {
    if (holds(permissions, needed)) actions.push(action);
  };
  if (asset.current_assignment) {
    add('checkin', 'asset:checkin');
    add('transfer', 'asset:transfer');
  } else if (state === 'deployable') {
    add('checkout', 'asset:checkout');
  }
  add('update', 'asset:update');
  add('open_repair', 'repair:manage');
  return actions;
}

// ==== custody ====================================================================================

interface StoredReplay {
  fingerprint: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
}
const replays = new Map<string, StoredReplay>();
onMockReset(() => replays.clear());

/**
 * `Idempotency-Key` handling of the contract: required (8-255 characters); the same key and the
 * same request replays the stored answer with `Idempotent-Replayed: true`; the same key with a
 * different request is `422 idempotency-key-reuse`. Only successful answers are stored.
 */
async function idempotent(
  request: Request,
  userId: string,
  body: unknown,
  run: () => Response,
): Promise<Response> {
  const key = request.headers.get('idempotency-key');
  if (!key) return problem(400, 'idempotency-key-required', 'Idempotency-Key is required');
  if (key.length < 8 || key.length > 255) {
    return problem(400, 'idempotency-key-invalid', 'Idempotency-Key must be 8-255 characters');
  }
  const scope = `${userId}:${key}`;
  const fingerprint = `${request.method} ${new URL(request.url).pathname} ${JSON.stringify(body)}`;
  const stored = replays.get(scope);
  if (stored) {
    if (stored.fingerprint !== fingerprint) {
      return problem(
        422,
        'idempotency-key-reuse',
        'This Idempotency-Key was used with a different request',
      );
    }
    return HttpResponse.json(stored.body as object, {
      status: stored.status,
      headers: { ...stored.headers, 'Idempotent-Replayed': 'true' },
    });
  }
  const response = run();
  if (response.status >= 200 && response.status < 300) {
    const copy = response.clone();
    const headers: Record<string, string> = {};
    copy.headers.forEach((value, name) => {
      if (['etag', 'location', 'content-type'].includes(name)) headers[name] = value;
    });
    replays.set(scope, {
      fingerprint,
      status: copy.status,
      headers,
      body: await copy.json(),
    });
  }
  return response;
}

type Target =
  | { type: 'person'; id: string; name: string }
  | { type: 'location'; id: string; name: string }
  | { type: 'asset'; id: string; name: string };

/** The one target of a check-out or transfer, or the field errors that refuse the request. */
function readTarget(body: Body, selfId: string): Target | FieldError[] {
  const data = registry();
  const given = (['person_id', 'location_id', 'target_asset_id'] as const).filter(
    (key) => typeof body[key] === 'string' && body[key] !== '',
  );
  if (given.length !== 1) {
    return [
      {
        pointer: '/person_id',
        message: 'exactly one of person_id, location_id or target_asset_id is required',
        code: given.length === 0 ? 'required' : 'too_many',
      },
    ];
  }
  const key = given[0]!;
  const id = body[key] as string;
  if (key === 'person_id') {
    const person = data.people.find((p) => p.id === id && !p.archived_at);
    if (!person) return [{ pointer: '/person_id', message: 'does not exist', code: 'not_found' }];
    if (person.status === 'inactive') {
      return [
        {
          pointer: '/person_id',
          message: 'is inactive and cannot receive assets',
          code: 'inactive',
        },
      ];
    }
    return { type: 'person', id, name: person.display_name };
  }
  if (key === 'location_id') {
    const location = data.locations.find((l) => l.id === id && !l.archived_at);
    if (!location)
      return [{ pointer: '/location_id', message: 'does not exist', code: 'not_found' }];
    return { type: 'location', id, name: location.name };
  }
  const target = data.assets.find((a) => a.id === id && !a.archived_at);
  if (!target)
    return [{ pointer: '/target_asset_id', message: 'does not exist', code: 'not_found' }];
  if (target.id === selfId) {
    return [
      {
        pointer: '/target_asset_id',
        message: 'an asset cannot be checked out to itself',
        code: 'invalid',
      },
    ];
  }
  return { type: 'asset', id, name: target.asset_tag };
}

function checkCommon(body: Body, errors: FieldError[]) {
  if (body.expected_return !== undefined && body.expected_return !== null) {
    const value = body.expected_return;
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value))
    ) {
      errors.push({
        pointer: '/expected_return',
        message: 'must be a date (YYYY-MM-DD)',
        code: 'invalid_format',
      });
    } else if (value < new Date().toISOString().slice(0, 10)) {
      errors.push({
        pointer: '/expected_return',
        message: 'must not be in the past',
        code: 'too_small',
      });
    }
  }
  for (const key of ['note', 'reason'] as const) {
    const value = body[key];
    const max = key === 'note' ? 2000 : 500;
    if (value !== undefined && (typeof value !== 'string' || value.length > max)) {
      errors.push({
        pointer: `/${key}`,
        message: `must be text of at most ${max} characters`,
        code: 'too_big',
      });
    }
  }
  const ids = body.attachment_ids;
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.length > 10 || ids.some((i) => typeof i !== 'string')) {
      errors.push({
        pointer: '/attachment_ids',
        message: 'must be a list of at most 10 ids',
        code: 'invalid',
      });
    }
  }
}

function deployedStatusId(): string | undefined {
  return registry().statusLabels.find((s) => s.state_type === 'deployed' && !s.archived_at)?.id;
}
function readyStatusId(): string | undefined {
  const labels = registry().statusLabels.filter(
    (s) => s.state_type === 'deployable' && !s.archived_at,
  );
  return (labels.find((s) => s.is_default) ?? labels[0])?.id;
}

function custodyResponse(
  asset: MockAsset,
  body: Record<string, unknown>,
  status: number,
  location?: string,
) {
  return HttpResponse.json(
    { asset: expandAsset(asset, []), ...body },
    {
      status,
      headers: { ETag: etagOf(asset._v), ...(location ? { Location: location } : {}) },
    },
  );
}

/** Session, permission, asset lookup and `If-Match` shared by the three custody endpoints. */
function custodyGuard(request: Request, id: string, permission: string) {
  const guard = requireSession(request, { mutation: true, permission });
  if (!guard.ok) return { response: guard.response } as const;
  const asset = registry().assets.find((a) => a.id === id);
  if (!asset) return { response: notFound() } as const;
  const ifMatch = request.headers.get('if-match');
  if (ifMatch && ifMatch !== etagOf(asset._v)) {
    return {
      response: problem(412, 'precondition-failed', 'The asset changed since you loaded it'),
    } as const;
  }
  return { guard, asset } as const;
}

function openAssignmentOf(assetId: string) {
  return registry().assignments.find((a) => a.asset_id === assetId && !a.checked_in_at);
}

function summaryOf(
  assignment: MockAssignment,
  target: Target,
): NonNullable<MockAsset['current_assignment']> {
  return {
    assignment_id: assignment.id,
    target_type: target.type,
    target_id: target.id,
    target_name: target.name,
    checked_out_at: assignment.checked_out_at,
    expected_return: assignment.expected_return ?? null,
    loaner_pool_id: null,
  };
}

function history(
  data: ReturnType<typeof registry>,
  asset: MockAsset,
  type: S['HistoryEvent']['event_type'],
  summary: string,
  actorId: string,
  assignmentId: string | null,
  payload: Record<string, unknown>,
) {
  data.history.push({
    id: newResourceId('history'),
    asset_id: asset.id,
    at: nowIso(),
    event_type: type,
    actor_type: 'user',
    actor_id: actorId,
    ...(assignmentId ? { assignment_id: assignmentId } : {}),
    summary,
    payload,
  });
}

function openAssignment(
  data: ReturnType<typeof registry>,
  asset: MockAsset,
  target: Target,
  body: Body,
  actorId: string,
): MockAssignment {
  const assignment: MockAssignment = {
    id: newResourceId('assignment'),
    asset_id: asset.id,
    accessory_id: null,
    person_id: target.type === 'person' ? target.id : null,
    location_id: target.type === 'location' ? target.id : null,
    target_asset_id: target.type === 'asset' ? target.id : null,
    quantity: 1,
    quantity_returned: 0,
    loaner_pool_id: null,
    checked_out_at: nowIso(),
    checked_out_by: actorId,
    expected_return: (body.expected_return as string | undefined) ?? null,
    checked_in_at: null,
    checked_in_by: null,
    checkin_location_id: null,
    acceptance_state: body.acceptance_required === true ? 'pending' : 'not_required',
    note: text(body.note) ?? null,
    checkin_note: null,
    _v: 1,
  };
  data.assignments.push(assignment);
  asset.current_assignment = summaryOf(assignment, target);
  return assignment;
}

function closeAssignment(
  assignment: MockAssignment,
  actorId: string,
  locationId: string | null,
  note: string | null,
) {
  assignment.checked_in_at = nowIso();
  assignment.checked_in_by = actorId;
  assignment.checkin_location_id = locationId;
  assignment.checkin_note = note;
  assignment.quantity_returned = assignment.quantity;
  assignment._v += 1;
}

const custodyHandlers: HttpHandler[] = [
  http.post('/v1/assets/:id/checkout', async ({ request, params }) => {
    const checked = custodyGuard(request, String(params.id), 'asset:checkout');
    if ('response' in checked) return checked.response;
    const { guard, asset } = checked;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    return idempotent(request, guard.user.id, body, () => {
      if (asset.archived_at) return problem(409, 'conflict', 'The asset is archived');
      const unknown = rejectUnknown(body, [
        'person_id',
        'location_id',
        'target_asset_id',
        'expected_return',
        'note',
        'acceptance_required',
        'attachment_ids',
      ]);
      const target = readTarget(body, asset.id);
      const errors = [...unknown, ...(Array.isArray(target) ? target : [])];
      checkCommon(body, errors);
      if (errors.length > 0) return validation(errors);
      if (asset.current_assignment) {
        return problem(409, 'asset-already-checked-out', 'The asset is already checked out', {
          detail: `The asset is already checked out to ${asset.current_assignment.target_name ?? 'someone'}.`,
        });
      }
      const state = registry().statusLabels.find((s) => s.id === asset.status_id)?.state_type;
      if (state !== 'deployable') {
        return problem(409, 'conflict', 'The asset cannot be checked out in its current state', {
          detail: 'Only assets with a ready (deployable) status can be checked out.',
        });
      }
      const resolved = target as Target;
      const result = mutateRegistry((data) => {
        const live = data.assets.find((a) => a.id === asset.id)!;
        const assignment = openAssignment(data, live, resolved, body, guard.user.id);
        const deployed = deployedStatusId();
        if (deployed) live.status_id = deployed;
        live.updated_at = nowIso();
        live._v += 1;
        history(
          data,
          live,
          'checked_out',
          `Checked out to ${resolved.name}`,
          guard.user.id,
          assignment.id,
          {
            [`${resolved.type === 'asset' ? 'target_asset' : resolved.type}_id`]: resolved.id,
            ...(assignment.expected_return ? { expected_return: assignment.expected_return } : {}),
            ...(assignment.note ? { note: assignment.note } : {}),
          },
        );
        return { live, assignment };
      });
      return custodyResponse(
        result.live,
        { assignment: strip(result.assignment) },
        201,
        `/v1/assets/${asset.id}/assignments`,
      );
    });
  }),

  http.post('/v1/assets/:id/checkin', async ({ request, params }) => {
    const checked = custodyGuard(request, String(params.id), 'asset:checkin');
    if ('response' in checked) return checked.response;
    const { guard, asset } = checked;
    const body = (await readBody(request)) ?? {};
    return idempotent(request, guard.user.id, body, () => {
      const errors = rejectUnknown(body, [
        'checkin_location_id',
        'status_id',
        'note',
        'attachment_ids',
      ]);
      checkCommon(body, errors);
      const data = registry();
      if (
        body.checkin_location_id &&
        !data.locations.some((l) => l.id === body.checkin_location_id && !l.archived_at)
      ) {
        errors.push({
          pointer: '/checkin_location_id',
          message: 'does not exist',
          code: 'not_found',
        });
      }
      if (
        body.status_id &&
        !data.statusLabels.some((s) => s.id === body.status_id && !s.archived_at)
      ) {
        errors.push({ pointer: '/status_id', message: 'does not exist', code: 'not_found' });
      }
      for (const id of (body.attachment_ids as string[] | undefined) ?? []) {
        const attachment = data.attachments.find((a) => a.id === id && !a.archived_at);
        if (!attachment || attachment.entity_id !== asset.id) {
          errors.push({
            pointer: '/attachment_ids',
            message: `${id} is not an attachment of this asset`,
            code: 'not_found',
          });
        }
      }
      if (errors.length > 0) return validation(errors);
      const open = openAssignmentOf(asset.id);
      if (!open) {
        return problem(409, 'asset-not-checked-out', 'The asset is not checked out', {
          detail: 'The asset has no open check-out to return.',
        });
      }
      const holder = asset.current_assignment?.target_name ?? '';
      const result = mutateRegistry((d) => {
        const live = d.assets.find((a) => a.id === asset.id)!;
        const assignment = d.assignments.find((a) => a.id === open.id)!;
        closeAssignment(
          assignment,
          guard.user.id,
          (body.checkin_location_id as string | undefined) ?? null,
          text(body.note) ?? null,
        );
        live.current_assignment = null;
        live.status_id =
          (body.status_id as string | undefined) ?? readyStatusId() ?? live.status_id;
        if (body.checkin_location_id) live.location_id = body.checkin_location_id as string;
        live.updated_at = nowIso();
        live._v += 1;
        history(d, live, 'checked_in', `Checked in from ${holder}`, guard.user.id, assignment.id, {
          ...(text(body.note) ? { note: text(body.note) } : {}),
          ...(Array.isArray(body.attachment_ids) && body.attachment_ids.length > 0
            ? { attachment_ids: body.attachment_ids }
            : {}),
        });
        return { live, assignment };
      });
      return custodyResponse(result.live, { assignment: strip(result.assignment) }, 200);
    });
  }),

  http.post('/v1/assets/:id/transfer', async ({ request, params }) => {
    const checked = custodyGuard(request, String(params.id), 'asset:transfer');
    if ('response' in checked) return checked.response;
    const { guard, asset } = checked;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    return idempotent(request, guard.user.id, body, () => {
      if (asset.archived_at) return problem(409, 'conflict', 'The asset is archived');
      const unknown = rejectUnknown(body, [
        'person_id',
        'location_id',
        'target_asset_id',
        'to_location_id',
        'expected_return',
        'reason',
        'note',
        'attachment_ids',
      ]);
      const target = readTarget(body, asset.id);
      const errors = [...unknown, ...(Array.isArray(target) ? target : [])];
      checkCommon(body, errors);
      if (
        body.to_location_id &&
        !registry().locations.some((l) => l.id === body.to_location_id && !l.archived_at)
      ) {
        errors.push({ pointer: '/to_location_id', message: 'does not exist', code: 'not_found' });
      }
      if (errors.length > 0) return validation(errors);
      const resolved = target as Target;
      const previous = openAssignmentOf(asset.id);
      const from = asset.current_assignment?.target_name ?? null;
      const result = mutateRegistry((d) => {
        const live = d.assets.find((a) => a.id === asset.id)!;
        if (previous) {
          closeAssignment(
            d.assignments.find((a) => a.id === previous.id)!,
            guard.user.id,
            null,
            null,
          );
        }
        const assignment = openAssignment(d, live, resolved, body, guard.user.id);
        const deployed = deployedStatusId();
        if (deployed) live.status_id = deployed;
        const fromLocation = live.location_id;
        if (body.to_location_id) live.location_id = body.to_location_id as string;
        live.updated_at = nowIso();
        live._v += 1;
        const transfer: S['Transfer'] = {
          id: newResourceId('assignment'),
          asset_id: live.id,
          from_assignment_id: previous?.id ?? null,
          to_assignment_id: assignment.id,
          from_location_id: fromLocation,
          to_location_id: live.location_id,
          reason: text(body.reason) ?? null,
          note: text(body.note) ?? null,
          transferred_at: nowIso(),
          transferred_by: guard.user.id,
        };
        history(
          d,
          live,
          'transferred',
          from ? `Transferred from ${from} to ${resolved.name}` : `Transferred to ${resolved.name}`,
          guard.user.id,
          assignment.id,
          {
            ...(from ? { from } : {}),
            to: resolved.name,
            ...(text(body.reason) ? { reason: text(body.reason) } : {}),
          },
        );
        return { live, assignment, transfer };
      });
      return custodyResponse(
        result.live,
        { transfer: result.transfer, assignment: strip(result.assignment) },
        201,
        `/v1/assets/${asset.id}/assignments`,
      );
    });
  }),
];

// ==== attachments ================================================================================

const ENTITY_TYPES = [
  'asset',
  'accessory',
  'consumable',
  'location',
  'person',
  'maintenance_record',
  'assignment',
  'import_job',
];
const KINDS = ['photo', 'document', 'signature', 'import_file', 'other'];
export const MAX_ATTACHMENT_BYTES = 25_000_000;

/** How long the simulated virus scan takes after the upload is confirmed (tests set it). */
let scanDelayMs = 1500;
export function setMockScanDelay(ms: number): void {
  scanDelayMs = ms;
}
onMockReset(() => {
  scanDelayMs = 1500;
});

const allowedType = (type: string) =>
  type.startsWith('image/') ||
  type === 'application/pdf' ||
  type === 'text/csv' ||
  type === 'application/msword' ||
  type.includes('officedocument') ||
  type.includes('ms-excel') ||
  type.includes('ms-powerpoint') ||
  type.includes('opendocument');

/** A pending scan answers once its due time has passed (reads advance the simulated scanner). */
function advanceScan(attachment: MockAttachment) {
  if (
    attachment.scan_status === 'pending' &&
    attachment.scan_due_at != null &&
    Date.now() >= attachment.scan_due_at
  ) {
    attachment.scan_status = attachment.scan_result === 'infected' ? 'infected' : 'clean';
  }
}

const DOWNLOAD_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#cbd5e1"/><circle cx="48" cy="40" r="14" fill="#64748b"/><rect x="22" y="62" width="52" height="16" rx="8" fill="#64748b"/></svg>',
)}`;

function attachmentView(attachment: MockAttachment, withUrl = false) {
  advanceScan(attachment);
  const {
    _v: _ignoredVersion,
    stored_bytes: _stored,
    scan_due_at: _due,
    scan_result: _result,
    archived_at: _archived,
    ...pub
  } = attachment;
  return {
    ...pub,
    ...(withUrl
      ? { download_url: attachment.scan_status === 'clean' ? DOWNLOAD_PLACEHOLDER : null }
      : {}),
  };
}

function entityExists(type: string, id: string): boolean {
  const data = registry();
  switch (type) {
    case 'asset':
      return data.assets.some((a) => a.id === id);
    case 'person':
      return data.people.some((p) => p.id === id);
    case 'location':
      return data.locations.some((l) => l.id === id);
    default:
      return true;
  }
}

const attachmentHandlers: HttpHandler[] = [
  http.get('/v1/attachments', ({ request }) => {
    const guard = requireSession(request, { permission: 'attachment:read' });
    if (!guard.ok) return guard.response;
    const params = new URL(request.url).searchParams;
    const errors: Array<{ pointer: string; message: string }> = [];
    const type = params.get('entity_type');
    const entityId = params.get('entity_id');
    if (!type || !ENTITY_TYPES.includes(type)) {
      errors.push({ pointer: 'query:entity_type', message: 'is required' });
    }
    if (!entityId) errors.push({ pointer: 'query:entity_id', message: 'is required' });
    if (errors.length > 0) return problem(400, 'bad-request', 'Invalid query', { errors });
    return paginate(
      request,
      registry().attachments.filter((a) => a.entity_type === type && a.entity_id === entityId),
      {
        sorts: { created_at: (a) => a.created_at },
        defaultSort: '-created_at',
        filter: (a, p) => !p.get('kind') || a.kind === p.get('kind'),
      },
      (a) => attachmentView(a),
    );
  }),

  http.post('/v1/attachments', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'attachment:write' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    const errors = rejectUnknown(body, [
      'entity_type',
      'entity_id',
      'kind',
      'filename',
      'content_type',
      'size_bytes',
      'sha256',
    ]);
    if (!ENTITY_TYPES.includes(String(body.entity_type))) {
      errors.push({ pointer: '/entity_type', message: 'is required', code: 'required' });
    }
    if (typeof body.entity_id !== 'string' || !body.entity_id) {
      errors.push({ pointer: '/entity_id', message: 'is required', code: 'required' });
    } else if (!entityExists(String(body.entity_type), body.entity_id)) {
      errors.push({ pointer: '/entity_id', message: 'does not exist', code: 'not_found' });
    }
    if (body.kind !== undefined && !KINDS.includes(String(body.kind))) {
      errors.push({
        pointer: '/kind',
        message: `must be one of ${KINDS.join(', ')}`,
        code: 'invalid_enum',
      });
    }
    const filename = text(body.filename);
    if (!filename || filename.length > 255) {
      errors.push({
        pointer: '/filename',
        message: 'is required (at most 255 characters)',
        code: 'required',
      });
    }
    const contentType = text(body.content_type);
    if (!contentType) {
      errors.push({ pointer: '/content_type', message: 'is required', code: 'required' });
    } else if (!allowedType(contentType)) {
      errors.push({
        pointer: '/content_type',
        message: 'This type of file is not allowed. Use images, PDF, Office documents or CSV.',
        code: 'unsupported',
      });
    }
    const size = body.size_bytes;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) {
      errors.push({
        pointer: '/size_bytes',
        message: 'must be at least 1 byte',
        code: 'too_small',
      });
    } else if (size > MAX_ATTACHMENT_BYTES) {
      errors.push({
        pointer: '/size_bytes',
        message: `The file is too large. The limit is ${MAX_ATTACHMENT_BYTES / 1_000_000} MB.`,
        code: 'too_big',
      });
    }
    if (body.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(String(body.sha256))) {
      errors.push({
        pointer: '/sha256',
        message: 'must be 64 hex characters',
        code: 'invalid_format',
      });
    }
    if (errors.length > 0) return validation(errors);

    const created = mutateRegistry((data) => {
      const stamp = nowIso();
      const attachment: MockAttachment = {
        id: newResourceId('attachment'),
        entity_type: body.entity_type as MockAttachment['entity_type'],
        entity_id: body.entity_id as string,
        kind: (body.kind as MockAttachment['kind']) ?? 'document',
        filename: filename!,
        content_type: contentType!,
        size_bytes: size as number,
        sha256: (body.sha256 as string | undefined) ?? null,
        scan_status: 'pending',
        uploaded_at: null,
        created_at: stamp,
        archived_at: null,
        scan_due_at: null,
        scan_result: /eicar/i.test(filename!) ? 'infected' : 'clean',
        _v: 1,
      };
      data.attachments.push(attachment);
      return attachment;
    });
    return HttpResponse.json(
      {
        attachment: attachmentView(created),
        upload: {
          method: 'PUT',
          url: `/mock-storage/${created.id}`,
          headers: { 'content-type': created.content_type },
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        },
      },
      { status: 201, headers: { Location: `/v1/attachments/${created.id}` } },
    );
  }),

  // The "storage" the presigned URL points at (not part of the contract).
  http.put('/mock-storage/:id', async ({ request, params }) => {
    const target = registry().attachments.find((a) => a.id === params.id);
    if (!target) return new HttpResponse(null, { status: 404 });
    const bytes = (await request.arrayBuffer()).byteLength;
    mutateRegistry(() => {
      target.stored_bytes = bytes;
    });
    return new HttpResponse(null, { status: 200 });
  }),

  http.post('/v1/attachments/:id/complete', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'attachment:write' });
    if (!guard.ok) return guard.response;
    const target = registry().attachments.find((a) => a.id === params.id && !a.archived_at);
    if (!target) return notFound();
    if (target.stored_bytes === undefined) {
      return problem(409, 'conflict', 'The file has not been uploaded yet', {
        detail: 'The upload is not complete. Send the file to the upload URL first.',
      });
    }
    const updated = mutateRegistry(() => {
      if (!target.uploaded_at) {
        target.uploaded_at = nowIso();
        target.scan_due_at = Date.now() + scanDelayMs;
      }
      return target;
    });
    return HttpResponse.json(attachmentView(updated));
  }),

  http.get('/v1/attachments/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'attachment:read' });
    if (!guard.ok) return guard.response;
    const target = registry().attachments.find((a) => a.id === params.id && !a.archived_at);
    return target ? HttpResponse.json(attachmentView(target, true)) : notFound();
  }),

  http.delete('/v1/attachments/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'attachment:write' });
    if (!guard.ok) return guard.response;
    const target = registry().attachments.find((a) => a.id === params.id && !a.archived_at);
    if (!target) return notFound();
    mutateRegistry(() => {
      target.archived_at = nowIso();
    });
    return new HttpResponse(null, { status: 204 });
  }),
];

export const m2Handlers: HttpHandler[] = [
  ...locationHandlers,
  ...personHandlers,
  ...readHandlers,
  ...custodyHandlers,
  ...attachmentHandlers,
];
