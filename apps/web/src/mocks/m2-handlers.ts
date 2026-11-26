import type { components } from '@assettracker/api-client';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { checkIfMatch, etagOf, problem, requireSession, type ProblemExtra } from './http';
import {
  newResourceId,
  type MockAsset,
  type MockAssignment,
  type MockAttachment,
  type MockLocation,
  type MockPerson,
  type RegistryData,
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
import { inScope, scopedLocationErrors } from './scope';
import { onMockReset } from './state';
import { rememberImportUpload } from './w3-state';

/**
 * Mock handlers of the M2 wave 1 endpoints of docs/engineering/openapi.yaml: locations, people (with
 * the forced deactivation), check-out / check-in / transfer (with `Idempotency-Key` replay and
 * optional `If-Match`), the asset and person histories, assignment lists, scan resolve, attachments
 * (create, presigned PUT, complete, scan states, download URLs in the list, delete) and the files
 * settings. They mirror what apps/api answers: field names, problem codes and `usage` keys, the
 * order the services check things in, and the payload shape of every history event.
 */
type S = components['schemas'];

// ---- problems the way the API's catalogue words them ---------------------------------------------

const CATALOG = {
  'bad-request': [400, 'Bad request'],
  'not-found': [404, 'Not found'],
  conflict: [409, 'Conflict'],
  'upload-missing': [409, 'Upload not found'],
  'asset-already-checked-out': [409, 'Asset already checked out'],
  'asset-not-checked-out': [409, 'Asset is not checked out'],
  'asset-not-deployable': [409, 'Asset cannot be checked out in its state'],
  'precondition-failed': [412, 'Precondition failed'],
  'payload-too-large': [413, 'Payload too large'],
  'unsupported-media-type': [415, 'Unsupported media type'],
} as const;

export function fail(code: keyof typeof CATALOG, extra: ProblemExtra = {}) {
  const [status, title] = CATALOG[code];
  return problem(status, code, title, extra);
}

export const notFound = (what: string) => fail('not-found', { detail: `${what} not found.` });

/** `409 conflict` with the `usage` counts of what still references the record (`inUse` of the API). */
export function inUse(label: string, usage: Record<string, number>) {
  const parts = Object.entries(usage)
    .filter(([, n]) => n > 0)
    .map(([what, n]) => `${what}: ${n}`);
  return fail('conflict', {
    detail: `${label} is in use (${parts.join(', ')}) and cannot be deleted.`,
    usage,
  });
}

/** `409 conflict` of a unique value taken (`duplicate` of the API). */
export const duplicate = (label: string, pointer: string, value: string) =>
  fail('conflict', {
    detail: `${label} "${value}" already exists.`,
    errors: [{ pointer, message: 'is already in use', code: 'duplicate' }],
  });

/** A reference to something that does not exist (`invalidRef` of the API). */
export const missing = (pointer: string, message: string): FieldError => ({
  pointer,
  message,
  code: 'not-found',
});

/** A body member the schema does not know: zod's strict object reports it on the root. */
export function rejectUnknown(body: Body, allowed: readonly string[]): FieldError[] {
  return Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({
      pointer: '/',
      message: `Unrecognized key: "${key}"`,
      code: 'unrecognized_keys',
    }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** `z.uuid()` members (optionally nullable): the bad ones as field errors. */
export function checkUuids(body: Body, keys: readonly string[], nullable: readonly string[] = []) {
  const errors: FieldError[] = [];
  for (const key of keys) {
    const value = body[key];
    if (value === undefined || (value === null && nullable.includes(key))) continue;
    if (!isUuid(value)) {
      errors.push({ pointer: `/${key}`, message: 'Invalid UUID', code: 'format' });
    }
  }
  return errors;
}

/** `str().trim().max(n)` members. */
export function checkTexts(
  body: Body,
  limits: Record<string, number>,
  nullable: readonly string[] = [],
) {
  const errors: FieldError[] = [];
  for (const [key, max] of Object.entries(limits)) {
    const value = body[key];
    if (value === undefined || (value === null && nullable.includes(key))) continue;
    if (typeof value !== 'string') {
      errors.push({
        pointer: `/${key}`,
        message: 'Invalid input: expected string',
        code: 'invalid_type',
      });
    } else if (value.trim().length > max) {
      errors.push({
        pointer: `/${key}`,
        message: `Too big: expected string to have <=${max} characters`,
        code: 'too_big',
      });
    }
  }
  return errors;
}

const todayUtc = () => new Date().toISOString().slice(0, 10);
const dayBefore = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const DEFAULT_COMPANY = '0190a6b2-0000-7000-8000-0000000000c0';

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
const ADDRESS_KEYS = ['line1', 'line2', 'city', 'region', 'postal_code', 'country'] as const;
/** Deepest allowed `depth` (a root has depth 0): ten levels (`MAX_LOCATION_DEPTH` of the API). */
const MAX_LOCATION_DEPTH = 9;

const depthError = (): FieldError => ({
  pointer: '/parent_id',
  message: `locations can be nested at most ${MAX_LOCATION_DEPTH + 1} levels deep`,
  code: 'too-deep',
});

/** `asset_count` (here and below), `direct_asset_count` and `child_count` of a location. */
function locationCounts(data: RegistryData, id: string) {
  const live = data.locations.filter((l) => !l.archived_at);
  const direct = (locationId: string) =>
    data.assets.filter((a) => !a.archived_at && a.location_id === locationId).length;
  return {
    asset_count: live
      .filter((l) => l.ancestor_ids?.includes(id))
      .reduce((sum, l) => sum + direct(l.id), 0),
    direct_asset_count: direct(id),
    child_count: live.filter((l) => l.parent_id === id).length,
  };
}

function locationView(location: MockLocation) {
  return { ...strip(location), ...locationCounts(registry(), location.id) };
}

function oneLocation(location: MockLocation, status = 200, headers: Record<string, string> = {}) {
  return HttpResponse.json(locationView(location), {
    status,
    headers: { ETag: etagOf(location._v), ...headers },
  });
}

function validateLocationBody(body: Body, creating: boolean): FieldError[] {
  const errors = rejectUnknown(body, LOCATION_KEYS);
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  if (creating || 'name' in body) {
    if (name === undefined) {
      errors.push({
        pointer: '/name',
        message: 'Invalid input: expected string',
        code: 'invalid_type',
      });
    } else if (name.length < 1) {
      errors.push({
        pointer: '/name',
        message: 'Too small: expected string to have >=1 characters',
        code: 'too_small',
      });
    } else if (name.length > 200) {
      errors.push({
        pointer: '/name',
        message: 'Too big: expected string to have <=200 characters',
        code: 'too_big',
      });
    }
  }
  if ('kind' in body && !LOCATION_KINDS.includes(String(body.kind))) {
    errors.push({
      pointer: '/kind',
      message: `Invalid option: expected one of ${LOCATION_KINDS.map((k) => `"${k}"`).join('|')}`,
      code: 'invalid_value',
    });
  }
  errors.push(...checkUuids(body, ['parent_id', 'company_id'], ['parent_id']));
  errors.push(...checkTexts(body, { code: 100, notes: 10_000 }, ['code', 'notes']));
  if ('address' in body && body.address !== null) {
    const address = body.address as Record<string, unknown> | undefined;
    if (typeof address !== 'object' || Array.isArray(address)) {
      errors.push({
        pointer: '/address',
        message: 'Invalid input: expected object',
        code: 'invalid_type',
      });
    } else {
      errors.push(
        ...rejectUnknown(address, ADDRESS_KEYS).map((e) => ({ ...e, pointer: '/address' })),
      );
      errors.push(
        ...checkTexts(
          address,
          { line1: 200, line2: 200, city: 100, region: 100, postal_code: 40 },
          ['line1', 'line2', 'city', 'region', 'postal_code'],
        ).map((e) => ({ ...e, pointer: `/address${e.pointer}` })),
      );
      // ISO 3166-1 alpha-2: exactly two letters (the API stores it upper-case)
      const country = address.country;
      if (country !== undefined && country !== null) {
        if (typeof country !== 'string') {
          errors.push({
            pointer: '/address/country',
            message: 'Invalid input: expected string',
            code: 'invalid_type',
          });
        } else if (!/^[A-Za-z]{2}$/.test(country.trim())) {
          errors.push({
            pointer: '/address/country',
            message: 'must be a two-letter country code (ISO 3166-1 alpha-2)',
            code: 'invalid_format',
          });
        }
      }
    }
  }
  for (const [key, limit] of [
    ['latitude', 90],
    ['longitude', 180],
  ] as const) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push({
        pointer: `/${key}`,
        message: 'Invalid input: expected number',
        code: 'invalid_type',
      });
    } else if (Math.abs(value) > limit) {
      errors.push({
        pointer: `/${key}`,
        message: `Too big: expected number to be <=${limit}`,
        code: 'too_big',
      });
    }
  }
  return errors;
}

/** The address as the API stores it: the country code upper-cased, text trimmed. */
function storedAddress(value: unknown): MockLocation['address'] {
  if (value === null || value === undefined) return null;
  const out: Record<string, string | null> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] =
      typeof v === 'string' ? (key === 'country' ? v.trim().toUpperCase() : v.trim()) : null;
  }
  return out as MockLocation['address'];
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
    const scope = guard.user.locationScope;
    return paginate(
      request,
      registry().locations,
      {
        sorts: { name: (l) => l.name, depth: (l) => l.depth, created_at: (l) => l.created_at },
        defaultSort: 'name',
        haystack: (l) => [l.name, l.code],
        filter: (l, p) => {
          // M2-LOC-03: a scoped principal lists only its subtrees
          if (!inScope(scope, l.id)) return false;
          if (p.get('parent_id') && l.parent_id !== p.get('parent_id')) return false;
          if (p.get('root') === 'true' && l.parent_id) return false;
          if (p.get('root') === 'false' && !l.parent_id) return false;
          const below = p.get('descendants_of');
          if (below && !(l.ancestor_ids?.includes(below) && l.id !== below)) return false;
          if (p.get('company_id') && l.company_id !== p.get('company_id')) return false;
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
    return found && inScope(guard.user.locationScope, found.id)
      ? oneLocation(found)
      : notFound('Location');
  }),

  http.post('/v1/locations', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'location:manage' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = validateLocationBody(body, true);
    if (errors.length > 0) return validation(errors);
    const data = registry();
    const parent = body.parent_id ? data.locations.find((l) => l.id === body.parent_id) : undefined;
    if (body.parent_id) {
      if (!parent || parent.archived_at) {
        errors.push(missing('/parent_id', 'No such location.'));
      } else if ((parent.depth ?? 0) + 1 > MAX_LOCATION_DEPTH) {
        errors.push(depthError());
      }
    }
    if (body.company_id && body.company_id !== DEFAULT_COMPANY) {
      errors.push(missing('/company_id', 'No such company.'));
    }
    // M2-LOC-03: a scoped principal adds below its scope roots, never at the top level
    errors.push(
      ...scopedLocationErrors(
        guard.user.locationScope,
        body.parent_id,
        '/parent_id',
        true,
        'A parent location inside your scope is required.',
      ).filter((e) => !(e.code === 'not-found' && errors.some((x) => x.pointer === '/parent_id'))),
    );
    if (errors.length > 0) return validation(errors);
    const name = String(body.name).trim();
    const taken = data.locations.some(
      (l) =>
        !l.archived_at && (l.parent_id ?? null) === (parent?.id ?? null) && sameName(l.name, name),
    );
    if (taken) return duplicate('A location named', '/name', name);
    const created = mutateRegistry((d) => {
      const stamp = nowIso();
      const id = newResourceId('location');
      const location: MockLocation = {
        id,
        created_at: stamp,
        updated_at: stamp,
        archived_at: null,
        parent_id: parent?.id ?? null,
        company_id: (body.company_id as string | undefined) ?? DEFAULT_COMPANY,
        name,
        kind: (body.kind as MockLocation['kind']) ?? 'other',
        code: (body.code as string | null | undefined) ?? null,
        address: storedAddress(body.address),
        latitude: (body.latitude as number | null | undefined) ?? null,
        longitude: (body.longitude as number | null | undefined) ?? null,
        notes: (body.notes as string | null | undefined) ?? null,
        depth: parent ? (parent.depth ?? 0) + 1 : 0,
        ancestor_ids: [...(parent?.ancestor_ids ?? []), id],
        _v: 1,
      };
      d.locations.push(location);
      return location;
    });
    return oneLocation(created, 201, { Location: `/v1/locations/${created.id}` });
  }),

  http.patch('/v1/locations/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'location:manage' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const bodyErrors = validateLocationBody(body, false);
    if (bodyErrors.length > 0) return validation(bodyErrors);
    const data = registry();
    const existing = data.locations.find((l) => l.id === params.id);
    if (!existing || existing.archived_at || !inScope(guard.user.locationScope, existing.id)) {
      return notFound('Location');
    }
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;

    const errors: FieldError[] = [];
    let move: MockLocation | null | undefined;
    if (body.parent_id !== undefined && body.parent_id !== existing.parent_id) {
      const parent = body.parent_id ? data.locations.find((l) => l.id === body.parent_id) : null;
      if (guard.user.locationScope && !body.parent_id) {
        // M2-LOC-03: a scoped principal cannot move a location to the top level
        errors.push({
          pointer: '/parent_id',
          message: 'A parent location inside your scope is required.',
          code: 'required',
        });
      } else if (
        body.parent_id &&
        (!parent || parent.archived_at || !inScope(guard.user.locationScope, parent.id))
      ) {
        errors.push(missing('/parent_id', 'No such location.'));
      } else if (
        parent &&
        (parent.id === existing.id || parent.ancestor_ids?.includes(existing.id))
      ) {
        errors.push({
          pointer: '/parent_id',
          message: 'a location cannot be moved under itself or one of its own sub-locations',
          code: 'cycle',
        });
      } else {
        // The deepest descendant must still fit below the new parent.
        const below = data.locations.filter((l) => l.ancestor_ids?.includes(existing.id));
        const height =
          Math.max(...below.map((l) => l.depth ?? 0), existing.depth ?? 0) - (existing.depth ?? 0);
        if ((parent ? (parent.depth ?? 0) + 1 : 0) + height > MAX_LOCATION_DEPTH) {
          errors.push(depthError());
        }
        move = parent;
      }
    }
    if (body.company_id !== undefined && body.company_id !== DEFAULT_COMPANY) {
      errors.push(missing('/company_id', 'No such company.'));
    }
    if (errors.length > 0) return validation(errors);

    const name = typeof body.name === 'string' ? body.name.trim() : existing.name;
    const parentId = move === undefined ? existing.parent_id : (move?.id ?? null);
    const clash = data.locations.some(
      (l) =>
        l.id !== existing.id &&
        !l.archived_at &&
        (l.parent_id ?? null) === (parentId ?? null) &&
        sameName(l.name, name),
    );
    if (clash && (name !== existing.name || move !== undefined)) {
      return duplicate('A location named', '/name', name);
    }

    const updated = mutateRegistry((d) => {
      const target = d.locations.find((l) => l.id === existing.id)!;
      let changed = false;
      const set = <K extends keyof MockLocation>(key: K, value: MockLocation[K]) => {
        if (JSON.stringify(target[key]) === JSON.stringify(value)) return;
        target[key] = value;
        changed = true;
      };
      if (body.name !== undefined) set('name', name);
      if (body.kind !== undefined) set('kind', body.kind as MockLocation['kind']);
      if (body.code !== undefined) set('code', body.code as string | null);
      if (body.notes !== undefined) set('notes', body.notes as string | null);
      if (body.address !== undefined) set('address', storedAddress(body.address));
      if (body.latitude !== undefined) set('latitude', body.latitude as number | null);
      if (body.longitude !== undefined) set('longitude', body.longitude as number | null);
      if (move !== undefined) {
        target.parent_id = move?.id ?? null;
        relocate(d.locations, target);
        changed = true;
      }
      if (changed) {
        target.updated_at = nowIso();
        target._v += 1;
      }
      return target;
    });
    return oneLocation(updated);
  }),

  http.delete('/v1/locations/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'location:manage' });
    if (!guard.ok) return guard.response;
    const data = registry();
    const existing = data.locations.find((l) => l.id === params.id);
    if (!existing || existing.archived_at) return notFound('Location');
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    const usage = {
      children: data.locations.filter((l) => !l.archived_at && l.parent_id === existing.id).length,
      assets: data.assets.filter((a) => !a.archived_at && a.location_id === existing.id).length,
      people: data.people.filter((p) => !p.archived_at && p.location_id === existing.id).length,
      open_assignments: data.assignments.filter(
        (a) => a.location_id === existing.id && !a.checked_in_at,
      ).length,
    };
    if (Object.values(usage).some((n) => n > 0)) return inUse('Location', usage);
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
  'department_id',
  'job_title',
  'location_id',
  'company_id',
  'status',
  'notes',
] as const;

/** Assets currently checked out to the person (open, asset-bound assignments). */
const assetsHeld = (personId: string) =>
  registry().assignments.filter((a) => a.person_id === personId && a.asset_id && !a.checked_in_at)
    .length;

/** All open custody periods of the person (assets and accessories): what blocks a deactivation. */
export const openAssignmentsOf = (personId: string) =>
  registry().assignments.filter((a) => a.person_id === personId && !a.checked_in_at).length;

/** `Person.department` is the NAME of the linked department (read-only); `department_id` is what is written. */
const departmentNameOf = (id: string | null | undefined): string | null =>
  (id ? registry().departments.find((d) => d.id === id)?.name : undefined) ?? null;

function personView(person: MockPerson) {
  return {
    ...strip(person),
    department: departmentNameOf(person.department_id),
    assets_held: assetsHeld(person.id),
    // ED-33: the login's own automatic record (the API's `user_id` set and no `created_by`)
    is_login_placeholder: !!person.user_id && person._system === true,
  };
}

export function onePerson(person: MockPerson, status = 200, headers: Record<string, string> = {}) {
  return HttpResponse.json(personView(person), {
    status,
    headers: { ETag: etagOf(person._v), ...headers },
  });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePersonBody(body: Body, mode: 'create' | 'update'): FieldError[] {
  const errors = rejectUnknown(body, [
    ...PERSON_KEYS,
    ...(mode === 'update' ? (['force', 'reason'] as const) : []),
  ]);
  if (mode === 'create' || 'display_name' in body) {
    const name = typeof body.display_name === 'string' ? body.display_name.trim() : undefined;
    if (name === undefined) {
      errors.push({
        pointer: '/display_name',
        message: 'Invalid input: expected string',
        code: 'invalid_type',
      });
    } else if (name.length < 1) {
      errors.push({
        pointer: '/display_name',
        message: 'Too small: expected string to have >=1 characters',
        code: 'too_small',
      });
    } else if (name.length > 200) {
      errors.push({
        pointer: '/display_name',
        message: 'Too big: expected string to have <=200 characters',
        code: 'too_big',
      });
    }
  }
  if ('kind' in body && !PERSON_KINDS.includes(String(body.kind))) {
    errors.push({
      pointer: '/kind',
      message: `Invalid option: expected one of ${PERSON_KINDS.map((k) => `"${k}"`).join('|')}`,
      code: 'invalid_value',
    });
  }
  if ('status' in body && !['active', 'inactive'].includes(String(body.status))) {
    errors.push({
      pointer: '/status',
      message: 'Invalid option: expected one of "active"|"inactive"',
      code: 'invalid_value',
    });
  }
  if ('email' in body && body.email !== null) {
    if (typeof body.email !== 'string' || !EMAIL.test(body.email.trim())) {
      errors.push({ pointer: '/email', message: 'Invalid email address', code: 'format' });
    }
  }
  errors.push(
    ...checkUuids(
      body,
      ['location_id', 'company_id', 'department_id'],
      ['location_id', 'department_id'],
    ),
  );
  errors.push(
    ...checkTexts(
      body,
      {
        first_name: 100,
        last_name: 100,
        phone: 60,
        employee_ref: 100,
        job_title: 200,
        notes: 10_000,
      },
      ['first_name', 'last_name', 'phone', 'employee_ref', 'job_title', 'notes'],
    ),
  );
  if ('force' in body && typeof body.force !== 'boolean') {
    errors.push({
      pointer: '/force',
      message: 'Invalid input: expected boolean',
      code: 'invalid_type',
    });
  }
  if ('reason' in body) {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined;
    if (reason === undefined) {
      errors.push({
        pointer: '/reason',
        message: 'Invalid input: expected string',
        code: 'invalid_type',
      });
    } else if (reason.length < 1) {
      errors.push({
        pointer: '/reason',
        message: 'Too small: expected string to have >=1 characters',
        code: 'too_small',
      });
    } else if (reason.length > 500) {
      errors.push({
        pointer: '/reason',
        message: 'Too big: expected string to have <=500 characters',
        code: 'too_big',
      });
    }
  }
  return errors;
}

/** E-mail and employee number are unique among live people (`409 conflict`, pointer on the field). */
function checkPersonUnique(
  email: string | null | undefined,
  employeeRef: string | null | undefined,
  selfId?: string,
): Response | null {
  const people = registry().people.filter((p) => !p.archived_at && p.id !== selfId);
  if (email && people.some((p) => p.email?.toLowerCase() === email.toLowerCase())) {
    return duplicate('A person with the email', '/email', email);
  }
  if (employeeRef && people.some((p) => p.employee_ref === employeeRef)) {
    return duplicate('A person with the employee number', '/employee_ref', employeeRef);
  }
  return null;
}

const nullableText = (value: unknown): string | null =>
  typeof value === 'string' ? value.trim() : null;

const personHandlers: HttpHandler[] = [
  http.get('/v1/people', ({ request }) => {
    const guard = requireSession(request, { permission: 'person:read' });
    if (!guard.ok) return guard.response;
    const scope = guard.user.locationScope;
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
        // `search_text` of the API: name, e-mail and employee number
        haystack: (p) => [p.display_name, p.email, p.employee_ref],
        filter: (p, params) => {
          // M2-LOC-03: a scoped principal lists the people whose home location is in scope
          if (!inScope(scope, p.location_id)) return false;
          const kinds = csv(params, 'kind');
          if (kinds.length > 0 && !kinds.includes(p.kind ?? 'employee')) return false;
          if (params.get('status') && p.status !== params.get('status')) return false;
          if (params.get('department_id') && p.department_id !== params.get('department_id'))
            return false;
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
    return found && inScope(guard.user.locationScope, found.location_id)
      ? onePerson(found)
      : notFound('Person');
  }),

  http.post('/v1/people', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'person:manage' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = validatePersonBody(body, 'create');
    if (errors.length > 0) return validation(errors);
    const data = registry();
    if (
      body.location_id &&
      !data.locations.some((l) => l.id === body.location_id && !l.archived_at)
    ) {
      errors.push(missing('/location_id', 'No such location.'));
    } else {
      // M2-LOC-03: a scoped principal gives every new person a home location inside its scope
      errors.push(
        ...scopedLocationErrors(
          guard.user.locationScope,
          body.location_id,
          '/location_id',
          true,
          'A home location inside your scope is required.',
        ),
      );
    }
    if (
      body.department_id &&
      !data.departments.some((d) => d.id === body.department_id && !d.archived_at)
    ) {
      errors.push(missing('/department_id', 'No such department.'));
    }
    if (body.company_id && body.company_id !== DEFAULT_COMPANY) {
      errors.push(missing('/company_id', 'No such company.'));
    }
    if (errors.length > 0) return validation(errors);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
    const clash = checkPersonUnique(email, nullableText(body.employee_ref));
    if (clash) return clash;
    const created = mutateRegistry((d) => {
      const stamp = nowIso();
      const person: MockPerson = {
        id: newResourceId('person'),
        created_at: stamp,
        updated_at: stamp,
        archived_at: null,
        kind: (body.kind as MockPerson['kind']) ?? 'employee',
        display_name: String(body.display_name).trim(),
        first_name: nullableText(body.first_name),
        last_name: nullableText(body.last_name),
        email,
        phone: nullableText(body.phone),
        employee_ref: nullableText(body.employee_ref),
        department: null,
        department_id: (body.department_id as string | null | undefined) ?? null,
        job_title: nullableText(body.job_title),
        location_id: (body.location_id as string | null | undefined) ?? null,
        company_id: (body.company_id as string | undefined) ?? DEFAULT_COMPANY,
        status: (body.status as MockPerson['status']) ?? 'active',
        notes: nullableText(body.notes),
        user_id: null,
        _v: 1,
      };
      d.people.push(person);
      return person;
    });
    return onePerson(created, 201, { Location: `/v1/people/${created.id}` });
  }),

  http.patch('/v1/people/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'person:manage' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const bodyErrors = validatePersonBody(body, 'update');
    if (bodyErrors.length > 0) return validation(bodyErrors);
    const data = registry();
    const existing = data.people.find((p) => p.id === params.id);
    if (!existing || existing.archived_at) return notFound('Person');
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;

    const errors: FieldError[] = [];
    if (
      body.location_id &&
      body.location_id !== existing.location_id &&
      !data.locations.some((l) => l.id === body.location_id && !l.archived_at)
    ) {
      errors.push(missing('/location_id', 'No such location.'));
    }
    if (
      body.department_id &&
      body.department_id !== existing.department_id &&
      !data.departments.some((d) => d.id === body.department_id && !d.archived_at)
    ) {
      errors.push(missing('/department_id', 'No such department.'));
    }
    if (
      body.company_id &&
      body.company_id !== existing.company_id &&
      body.company_id !== DEFAULT_COMPANY
    ) {
      errors.push(missing('/company_id', 'No such company.'));
    }
    if (errors.length > 0) return validation(errors);

    const changes: Partial<MockPerson> = {};
    for (const key of PERSON_KEYS) {
      let value = body[key];
      if (value === undefined) continue;
      if (typeof value === 'string')
        value = key === 'email' ? value.trim().toLowerCase() : value.trim();
      if (value !== existing[key]) (changes as Record<string, unknown>)[key] = value;
    }

    // Deactivating a person who still holds things: refused unless forced with a reason.
    if (changes.status === 'inactive') {
      const open = openAssignmentsOf(existing.id);
      if (open > 0) {
        if (!body.force) return inUse('Person', { open_assignments: open });
        if (typeof body.reason !== 'string' || !body.reason.trim()) {
          return validation([
            {
              pointer: '/reason',
              message: 'a forced deactivation needs a reason',
              code: 'required',
            },
          ]);
        }
      }
    }
    if (Object.keys(changes).length === 0) return onePerson(existing);
    const clash = checkPersonUnique(
      'email' in changes ? (changes.email as string | null) : undefined,
      'employee_ref' in changes ? (changes.employee_ref as string | null) : undefined,
      existing.id,
    );
    if (clash) return clash;

    const updated = mutateRegistry((d) => {
      const target = d.people.find((p) => p.id === existing.id)!;
      Object.assign(target, changes);
      target.updated_at = nowIso();
      target._v += 1;
      // Assets held by this person show the new name.
      for (const asset of d.assets) {
        if (
          asset.current_assignment?.target_type === 'person' &&
          asset.current_assignment.target_id === target.id
        ) {
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
    if (!existing || existing.archived_at) return notFound('Person');
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    const open = openAssignmentsOf(existing.id);
    if (open > 0 || existing.user_id) {
      return inUse('Person', { open_assignments: open, login_accounts: existing.user_id ? 1 : 0 });
    }
    mutateRegistry((d) => {
      const target = d.people.find((p) => p.id === existing.id)!;
      target.archived_at = nowIso();
      target._v += 1;
    });
    return new HttpResponse(null, { status: 204 });
  }),
];

// ==== assignments and history =====================================================================

/**
 * `Assignment` of the contract: `overdue` is computed (open, due before today UTC); the lists of a
 * person and of an asset also carry the asset's tag and name, the custody results do not.
 */
export function assignmentView(a: MockAssignment, withAsset: boolean) {
  const { _v: _ignored, ...pub } = a;
  const asset = a.asset_id ? registry().assets.find((x) => x.id === a.asset_id) : undefined;
  return {
    ...pub,
    attachment_ids: pub.attachment_ids ?? [],
    checkin_attachment_ids: pub.checkin_attachment_ids ?? [],
    checkin_condition: pub.checkin_condition ?? null,
    overdue: !a.checked_in_at && !!a.expected_return && a.expected_return < todayUtc(),
    ...(withAsset ? { asset_tag: asset?.asset_tag ?? null, asset_name: asset?.name ?? null } : {}),
  };
}

function actorOf(actorId: string | null | undefined) {
  if (!actorId) return null;
  const user = registry().users.find((u) => u.id === actorId);
  return user ? { id: user.id, display_name: user.display_name } : null;
}

type StoredEvent = S['HistoryEvent'] & { _v?: number };

/** `HistoryEvent` of the contract: the actor resolved, the asset's tag, nulls instead of gaps. */
function historyView(e: StoredEvent) {
  const asset = registry().assets.find((a) => a.id === e.asset_id);
  return {
    id: e.id,
    asset_id: e.asset_id,
    asset_tag: asset?.asset_tag ?? null,
    at: e.at,
    event_type: e.event_type,
    actor_type: e.actor_type,
    actor_id: e.actor_id ?? null,
    actor: e.actor_type === 'user' ? actorOf(e.actor_id) : null,
    assignment_id: e.assignment_id ?? null,
    transfer_id: e.transfer_id ?? null,
    summary: e.summary ?? null,
    payload: e.payload ?? {},
  };
}

function historyList(request: Request, events: StoredEvent[], withFilters: boolean) {
  return paginate(
    request,
    events.map((e) => ({ ...e, _v: 0 })),
    {
      sorts: { at: (e) => e.at },
      defaultSort: '-at',
      filter: (e, p) => {
        if (!withFilters) return true;
        const types = csv(p, 'event_type');
        if (types.length > 0 && !types.includes(e.event_type)) return false;
        const from = p.get('from');
        if (from && e.at < from) return false;
        const to = p.get('to');
        return !(to && e.at >= to);
      },
    },
    (e) => historyView(e),
  );
}

const readHandlers: HttpHandler[] = [
  http.get('/v1/assets/:id/history', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const asset = registry().assets.find((a) => a.id === params.id);
    if (!asset) return notFound('Asset');
    return historyList(
      request,
      registry().history.filter((e) => e.asset_id === asset.id),
      true,
    );
  }),

  /** What happened to the assets this person held: their assignments and transfers out of them. */
  http.get('/v1/people/:id/history', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'person:read' });
    if (!guard.ok) return guard.response;
    const person = registry().people.find((p) => p.id === params.id);
    if (!person) return notFound('Person');
    const mine = new Set(
      registry()
        .assignments.filter((a) => a.person_id === person.id)
        .map((a) => a.id),
    );
    return historyList(
      request,
      registry().history.filter(
        (e) =>
          (e.assignment_id != null && mine.has(e.assignment_id)) ||
          (e.event_type === 'transferred' &&
            typeof e.payload?.from_assignment_id === 'string' &&
            mine.has(e.payload.from_assignment_id)),
      ),
      false,
    );
  }),

  http.get('/v1/assets/:id/assignments', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const asset = registry().assets.find((a) => a.id === params.id);
    if (!asset) return notFound('Asset');
    return paginate(
      request,
      registry().assignments.filter((a) => a.asset_id === asset.id),
      { sorts: { checked_out_at: (a) => a.checked_out_at }, defaultSort: '-checked_out_at' },
      (a) => assignmentView(a, true),
    );
  }),

  http.get('/v1/people/:id/assignments', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'person:read' });
    if (!guard.ok) return guard.response;
    const person = registry().people.find((p) => p.id === params.id);
    if (!person) return notFound('Person');
    const state = new URL(request.url).searchParams.get('state') ?? 'open';
    if (!['open', 'closed', 'all'].includes(state)) {
      return fail('bad-request', {
        detail: 'Query parameter "state": Invalid option',
        errors: [{ pointer: 'query:state', message: 'Invalid option', code: 'invalid_value' }],
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
      (a) => assignmentView(a, true),
    );
  }),

  /** `GET /v1/scan/resolve`: label code, then asset tag, then (unique) serial number. */
  http.get('/v1/scan/resolve', ({ request }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const raw = new URL(request.url).searchParams.get('code')?.trim();
    if (!raw) {
      return fail('bad-request', {
        detail: 'Query parameter "code": Too small',
        errors: [{ pointer: 'query:code', message: 'is required', code: 'too_small' }],
      });
    }
    // The whole code first (a tag may contain "/"); a label URL then yields its last path segment.
    const candidates = [raw];
    if (/^(https?:\/\/|\/)/i.test(raw)) {
      const last = raw.split(/[?#]/)[0]!.split('/').filter(Boolean).pop();
      if (last && last !== raw) candidates.push(last);
    }
    const assets = registry().assets;
    let matchType: S['ScanResolveResult']['match_type'] = 'label_code';
    let found: MockAsset | undefined;
    for (const code of candidates) {
      matchType = 'label_code';
      found = assets.find((a) => a.label_code === code);
      if (!found) {
        matchType = 'asset_tag';
        found = assets.find((a) => a.asset_tag.toLowerCase() === code.toLowerCase());
      }
      if (!found) {
        // Not unique per tenant: an ambiguous serial is refused rather than guessed.
        matchType = 'serial';
        const bySerial = assets.filter((a) => a.serial?.toLowerCase() === code.toLowerCase());
        if (bySerial.length > 1) {
          return fail('conflict', {
            detail:
              'Several assets share this serial number. Scan the label or enter the asset tag instead.',
          });
        }
        found = bySerial[0];
      }
      if (found) break;
    }
    if (!found) return fail('not-found', { detail: 'No asset matches this code.' });
    return HttpResponse.json(
      {
        match_type: matchType,
        entity_type: 'asset',
        asset: expandAsset(found, []),
        allowed_actions: allowedActions(found, guard.user.permissions),
      },
      { headers: { ETag: etagOf(found._v) } },
    );
  }),
];

const holds = (permissions: string[], needed: string) =>
  permissions.includes('*') ||
  permissions.includes(needed) ||
  permissions.includes(`${needed.split(':')[0]}:*`);

// ==== the asset state machine (`registry/asset-actions.ts`) =======================================

type ActionRefusal = { code: keyof typeof CATALOG; detail: string };

/** `null` when the action is allowed, otherwise why not. */
export function refuseAssetAction(
  action: 'checkout' | 'checkin' | 'transfer' | 'update',
  asset: MockAsset,
): ActionRefusal | null {
  if (asset.archived_at) {
    return { code: 'conflict', detail: 'The asset is archived. Restore it first.' };
  }
  const stateType =
    registry().statusLabels.find((s) => s.id === asset.status_id)?.state_type ?? 'deployable';
  const hasAssignment = !!asset.current_assignment;
  switch (action) {
    case 'checkout':
      if (hasAssignment) {
        return { code: 'asset-already-checked-out', detail: 'The asset is already checked out.' };
      }
      return stateType === 'deployable'
        ? null
        : {
            code: 'asset-not-deployable',
            detail: `The asset cannot be checked out: its status is of type "${stateType}" (only "deployable" assets can be checked out).`,
          };
    case 'checkin':
      return hasAssignment
        ? null
        : { code: 'asset-not-checked-out', detail: 'The asset is not checked out.' };
    case 'transfer':
      if (hasAssignment || stateType === 'deployable') return null;
      return {
        code: 'asset-not-deployable',
        detail: `The asset cannot be handed out: it is not checked out and its status is of type "${stateType}" (only "deployable" assets can be).`,
      };
    case 'update':
      return null;
  }
}

/** The actions valid for the asset in its current state and for the caller (`ScanResolveResult`). */
function allowedActions(
  asset: MockAsset,
  permissions: string[],
): S['ScanResolveResult']['allowed_actions'] {
  const actions: S['ScanResolveResult']['allowed_actions'] = [];
  const may = (action: Parameters<typeof refuseAssetAction>[0], needed: string) =>
    holds(permissions, needed) && refuseAssetAction(action, asset) === null;
  if (may('checkout', 'asset:checkout')) actions.push('checkout');
  if (may('checkin', 'asset:checkin')) actions.push('checkin');
  if (may('transfer', 'asset:transfer')) actions.push('transfer');
  if (may('update', 'asset:update')) actions.push('update');
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
export async function idempotent(
  request: Request,
  userId: string,
  body: unknown,
  run: () => Response,
): Promise<Response> {
  const key = request.headers.get('idempotency-key');
  if (!key) return problem(400, 'idempotency-key-required', 'Idempotency-Key required');
  if (key.length < 8 || key.length > 255) {
    return problem(400, 'idempotency-key-invalid', 'Invalid Idempotency-Key');
  }
  const scope = `${userId}:${key}`;
  const fingerprint = `${request.method} ${new URL(request.url).pathname} ${JSON.stringify(body)}`;
  const stored = replays.get(scope);
  if (stored) {
    if (stored.fingerprint !== fingerprint) {
      return problem(
        422,
        'idempotency-key-reuse',
        'Idempotency-Key reused with a different request',
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

export type Target =
  | { type: 'person'; id: string; name: string }
  | { type: 'location'; id: string; name: string }
  | { type: 'asset'; id: string; name: string };

const TARGET_KEYS = ['person_id', 'location_id', 'target_asset_id'] as const;

/** Exactly one of person / location / asset (schema `AssignmentTarget`). */
function checkExactlyOneTarget(body: Body): FieldError[] {
  const given = TARGET_KEYS.filter((key) => body[key] !== undefined);
  if (given.length === 1) return [];
  return [
    {
      pointer: `/${given[0] ?? TARGET_KEYS[0]}`,
      message:
        given.length === 0
          ? 'exactly one of person_id, location_id and target_asset_id is required'
          : 'send only one of person_id, location_id and target_asset_id',
      code: 'custom',
    },
  ];
}

/** The person / location / asset the request points at, validated (422 with a pointer). */
function resolveTarget(body: Body, selfId: string): Target | FieldError[] {
  const data = registry();
  if (typeof body.person_id === 'string') {
    const person = data.people.find((p) => p.id === body.person_id);
    if (!person || person.archived_at) return [missing('/person_id', 'No such person.')];
    if (person.status !== 'active') {
      return [
        {
          pointer: '/person_id',
          message: 'inactive people cannot receive assets',
          code: 'inactive',
        },
      ];
    }
    return { type: 'person', id: person.id, name: person.display_name };
  }
  if (typeof body.location_id === 'string') {
    const location = data.locations.find((l) => l.id === body.location_id);
    if (!location || location.archived_at) return [missing('/location_id', 'No such location.')];
    return { type: 'location', id: location.id, name: location.name };
  }
  const targetId = body.target_asset_id as string;
  if (targetId === selfId) {
    return [
      {
        pointer: '/target_asset_id',
        message: 'an asset cannot be checked out to itself',
        code: 'invalid',
      },
    ];
  }
  const target = data.assets.find((a) => a.id === targetId);
  if (!target || target.archived_at) return [missing('/target_asset_id', 'No such asset.')];
  // No cycles: following "is checked out to asset" upwards must never come back to this asset.
  let cursor: string | null = targetId;
  for (let depth = 0; cursor && depth < 50; depth += 1) {
    if (cursor === selfId) {
      return [
        {
          pointer: '/target_asset_id',
          message: 'would create a cycle (the target is itself checked out to this asset)',
          code: 'cycle',
        },
      ];
    }
    const up: MockAssignment | undefined = data.assignments.find(
      (a) => a.asset_id === cursor && !a.checked_in_at && a.target_asset_id,
    );
    cursor = up?.target_asset_id ?? null;
  }
  return {
    type: 'asset',
    id: target.id,
    name: target.name ? `${target.asset_tag} ${target.name}` : target.asset_tag,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Members shared by the three custody bodies (zod schema of `lifecycle/schemas.ts`). */
function checkCommon(body: Body): FieldError[] {
  const errors: FieldError[] = [];
  const due = body.expected_return;
  if (due !== undefined) {
    const ok =
      typeof due === 'string' &&
      ISO_DATE.test(due) &&
      !Number.isNaN(Date.parse(`${due}T00:00:00Z`));
    if (!ok)
      errors.push({ pointer: '/expected_return', message: 'Invalid ISO date', code: 'format' });
  }
  errors.push(...checkTexts(body, { note: 2000, reason: 500 }));
  const ids = body.attachment_ids;
  if (ids !== undefined) {
    if (!Array.isArray(ids)) {
      errors.push({
        pointer: '/attachment_ids',
        message: 'Invalid input: expected array',
        code: 'invalid_type',
      });
    } else {
      if (ids.length > 10) {
        errors.push({
          pointer: '/attachment_ids',
          message: 'Too big: expected array to have <=10 items',
          code: 'too_big',
        });
      }
      ids.forEach((id, index) => {
        if (!isUuid(id)) {
          errors.push({
            pointer: `/attachment_ids/${index}`,
            message: 'Invalid UUID',
            code: 'format',
          });
        }
      });
    }
  }
  return errors;
}

/** A due date more than a day in the past (a day of slack: the caller's "today" may be behind UTC). */
function checkDue(body: Body): FieldError[] {
  const due = body.expected_return;
  return typeof due === 'string' && due < dayBefore()
    ? [
        {
          pointer: '/expected_return',
          message: `must not be in the past (today is ${todayUtc()} UTC)`,
          code: 'in-the-past',
        },
      ]
    : [];
}

/** The tenant's first active label of a state type (the default one when it has the type and `preferDefault`). */
export function statusOfType(stateType: 'deployed' | 'deployable', preferDefault = false) {
  const labels = registry()
    .statusLabels.filter((s) => s.state_type === stateType && !s.archived_at)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name));
  return (preferDefault ? labels.find((s) => s.is_default) : undefined) ?? labels[0];
}

export const noLabel = (stateType: string) =>
  fail('conflict', {
    detail: `The tenant has no active status label of type "${stateType}". Create one in the status labels first.`,
  });

/**
 * Photos and signatures sent with a custody action: each must be a live attachment that is not
 * rejected and that belongs to the asset (uploaded against it before the action). A bad id is a 422
 * with the pointer of the offending array item.
 */
function checkPhotos(ids: unknown, assetId: string): FieldError[] {
  if (!Array.isArray(ids)) return [];
  const data = registry();
  const errors: FieldError[] = [];
  ids.forEach((id, index) => {
    const at = `/attachment_ids/${index}`;
    const row = data.attachments.find((a) => a.id === id && !a.archived_at);
    if (!row) errors.push({ pointer: at, message: 'No such attachment.', code: 'not-found' });
    else if (row.scan_status === 'infected' || row.scan_status === 'error') {
      errors.push({ pointer: at, message: 'This file was rejected.', code: 'rejected' });
    } else if (!(row.entity_type === 'asset' && row.entity_id === assetId)) {
      errors.push({
        pointer: at,
        message: 'This attachment belongs to another record.',
        code: 'wrong-owner',
      });
    }
  });
  return errors;
}

/** Re-points the photos at the assignment they now belong to (they list under it from then on). */
function linkPhotos(data: RegistryData, ids: readonly string[], assignmentId: string) {
  for (const id of ids) {
    const row = data.attachments.find((a) => a.id === id);
    if (!row) continue;
    row.entity_type = 'assignment';
    row.entity_id = assignmentId;
    row._v += 1;
  }
}

const photoIds = (body: Body): string[] =>
  Array.isArray(body.attachment_ids) ? [...new Set(body.attachment_ids as string[])] : [];

export function custodyResponse(
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

/** Asset lookup and the optional `If-Match`, inside the idempotent part of a custody request. */
function lockAsset(request: Request, id: string): { asset: MockAsset } | { response: Response } {
  const asset = registry().assets.find((a) => a.id === id);
  if (!asset) return { response: notFound('Asset') };
  const ifMatch = request.headers.get('if-match');
  if (ifMatch && ifMatch !== etagOf(asset._v)) {
    return {
      response: fail('precondition-failed', {
        detail: `The resource has changed (current ETag ${etagOf(asset._v)}). Re-read it and retry.`,
      }),
    };
  }
  return { asset };
}

export const statusName = (id: string) =>
  registry().statusLabels.find((s) => s.id === id)?.name ?? '';

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

export function pushEvent(
  data: RegistryData,
  asset: MockAsset,
  type: S['HistoryEvent']['event_type'],
  summary: string,
  actorId: string,
  links: { assignmentId?: string | null; transferId?: string | null },
  payload: Record<string, unknown>,
) {
  data.history.push({
    id: newResourceId('history'),
    asset_id: asset.id,
    at: nowIso(),
    event_type: type,
    actor_type: 'user',
    actor_id: actorId,
    assignment_id: links.assignmentId ?? null,
    transfer_id: links.transferId ?? null,
    summary,
    payload,
  });
}

export function openAssignment(
  data: RegistryData,
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
    checkin_condition: null,
    attachment_ids: photoIds(body),
    checkin_attachment_ids: [],
    _v: 1,
  };
  data.assignments.push(assignment);
  asset.current_assignment = summaryOf(assignment, target);
  linkPhotos(data, assignment.attachment_ids ?? [], assignment.id);
  return assignment;
}

export function closeAssignment(
  assignment: MockAssignment,
  actorId: string,
  close: {
    locationId: string | null;
    note: string | null;
    attachmentIds: string[];
    condition: string | null;
  },
) {
  assignment.checked_in_at = nowIso();
  assignment.checked_in_by = actorId;
  assignment.checkin_location_id = close.locationId;
  assignment.checkin_note = close.note;
  assignment.checkin_attachment_ids = close.attachmentIds;
  assignment.checkin_condition = close.condition as MockAssignment['checkin_condition'];
  assignment.quantity_returned = assignment.quantity;
  assignment._v += 1;
  linkPhotos(registry(), close.attachmentIds, assignment.id);
}

const CONDITIONS = ['good', 'fair', 'poor', 'damaged'];

const custodyHandlers: HttpHandler[] = [
  http.post('/v1/assets/:id/checkout', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:checkout' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    return idempotent(request, guard.user.id, body, () => {
      if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
      const bodyErrors = [
        ...rejectUnknown(body, [
          ...TARGET_KEYS,
          'expected_return',
          'note',
          'acceptance_required',
          'status_label_id',
          'attachment_ids',
        ]),
        ...checkUuids(body, [...TARGET_KEYS, 'status_label_id']),
        ...checkExactlyOneTarget(body),
        ...checkCommon(body),
      ];
      if ('acceptance_required' in body && typeof body.acceptance_required !== 'boolean') {
        bodyErrors.push({
          pointer: '/acceptance_required',
          message: 'Invalid input: expected boolean',
          code: 'invalid_type',
        });
      }
      if (bodyErrors.length > 0) return validation(bodyErrors);

      const locked = lockAsset(request, String(params.id));
      if ('response' in locked) return locked.response;
      const { asset } = locked;
      const refusal = refuseAssetAction('checkout', asset);
      if (refusal) return fail(refusal.code, { detail: refusal.detail });

      const target = resolveTarget(body, asset.id);
      if (Array.isArray(target)) return validation(target);
      const dueErrors = checkDue(body);
      if (dueErrors.length > 0) return validation(dueErrors);
      let deployed = statusOfType('deployed');
      if (typeof body.status_label_id === 'string') {
        const label = registry().statusLabels.find((s) => s.id === body.status_label_id);
        if (!label || label.archived_at) {
          return validation([missing('/status_label_id', 'No such status label.')]);
        }
        if (label.state_type !== 'deployed') {
          return validation([
            {
              pointer: '/status_label_id',
              message: 'a checked-out asset needs a status label of type "deployed"',
              code: 'invalid',
            },
          ]);
        }
        deployed = label;
      } else if (!deployed) {
        return noLabel('deployed');
      }
      const photoErrors = checkPhotos(body.attachment_ids, asset.id);
      if (photoErrors.length > 0) return validation(photoErrors);

      const from = statusName(asset.status_id);
      const fromId = asset.status_id;
      const result = mutateRegistry((data) => {
        const live = data.assets.find((a) => a.id === asset.id)!;
        const assignment = openAssignment(data, live, target, body, guard.user.id);
        live.status_id = deployed!.id;
        live.updated_at = nowIso();
        live._v += 1;
        pushEvent(
          data,
          live,
          'checked_out',
          `Checked out to ${target.name}`,
          guard.user.id,
          { assignmentId: assignment.id },
          {
            assignment_id: assignment.id,
            target_type: target.type,
            target_id: target.id,
            target_name: target.name,
            expected_return: assignment.expected_return ?? null,
            status: { from, to: deployed!.name, from_id: fromId, to_id: deployed!.id },
            ...(assignment.note ? { note: assignment.note } : {}),
            ...(photoIds(body).length > 0 ? { attachment_ids: photoIds(body) } : {}),
          },
        );
        return { live, assignment };
      });
      return custodyResponse(
        result.live,
        { assignment: assignmentView(result.assignment, false) },
        201,
        `/v1/assets/${asset.id}/assignments`,
      );
    });
  }),

  http.post('/v1/assets/:id/checkin', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:checkin' });
    if (!guard.ok) return guard.response;
    // the body is optional (`checkinSchema.default({})`)
    const body = (await readBody(request)) ?? {};
    return idempotent(request, guard.user.id, body, () => {
      const bodyErrors = [
        ...rejectUnknown(body, [
          'checkin_location_id',
          'status_id',
          'condition',
          'note',
          'attachment_ids',
        ]),
        ...checkUuids(
          body,
          ['checkin_location_id', 'status_id'],
          ['checkin_location_id', 'status_id'],
        ),
        ...checkCommon(body),
      ];
      if ('condition' in body && !CONDITIONS.includes(String(body.condition))) {
        bodyErrors.push({
          pointer: '/condition',
          message: `Invalid option: expected one of ${CONDITIONS.map((c) => `"${c}"`).join('|')}`,
          code: 'invalid_value',
        });
      }
      if (bodyErrors.length > 0) return validation(bodyErrors);

      const locked = lockAsset(request, String(params.id));
      if ('response' in locked) return locked.response;
      const { asset } = locked;
      const refusal = refuseAssetAction('checkin', asset);
      if (refusal) return fail(refusal.code, { detail: refusal.detail });

      const data = registry();
      const errors: FieldError[] = [];
      if (
        body.checkin_location_id &&
        !data.locations.some((l) => l.id === body.checkin_location_id && !l.archived_at)
      ) {
        errors.push(missing('/checkin_location_id', 'No such location.'));
      }
      let chosen: (typeof data.statusLabels)[number] | undefined;
      if (body.status_id) {
        chosen = data.statusLabels.find((s) => s.id === body.status_id);
        if (!chosen || chosen.archived_at) {
          errors.push(missing('/status_id', 'No such status label.'));
          chosen = undefined;
        } else if (chosen.state_type === 'deployed') {
          errors.push({
            pointer: '/status_id',
            message: 'a checked-in asset cannot get a status of type "deployed"',
            code: 'invalid',
          });
          chosen = undefined;
        }
      }
      if (errors.length > 0) return validation(errors);
      const status = chosen ?? statusOfType('deployable', true);
      if (!status) return noLabel('deployable');
      const photoErrors = checkPhotos(body.attachment_ids, asset.id);
      if (photoErrors.length > 0) return validation(photoErrors);

      const open = openAssignmentOf(asset.id)!;
      const holder = asset.current_assignment!;
      const note = text(body.note) ?? null;
      const condition = (body.condition as string | undefined) ?? null;
      const result = mutateRegistry((d) => {
        const live = d.assets.find((a) => a.id === asset.id)!;
        const assignment = d.assignments.find((a) => a.id === open.id)!;
        closeAssignment(assignment, guard.user.id, {
          locationId: (body.checkin_location_id as string | undefined) ?? null,
          note,
          attachmentIds: photoIds(body),
          condition,
        });
        const fromStatus = statusName(live.status_id);
        const fromStatusId = live.status_id;
        const fromLocation = live.location_id;
        const newLocation =
          body.checkin_location_id && body.checkin_location_id !== live.location_id
            ? (body.checkin_location_id as string)
            : undefined;
        live.current_assignment = null;
        live.status_id = status.id;
        if (newLocation) live.location_id = newLocation;
        live.updated_at = nowIso();
        live._v += 1;
        pushEvent(
          d,
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
            status: {
              from: fromStatus,
              to: status.name,
              from_id: fromStatusId,
              to_id: status.id,
            },
            ...(newLocation ? { location: { from: fromLocation ?? null, to: newLocation } } : {}),
            ...(condition ? { condition } : {}),
            ...(note ? { note } : {}),
            ...(photoIds(body).length > 0 ? { attachment_ids: photoIds(body) } : {}),
          },
        );
        return { live, assignment };
      });
      return custodyResponse(
        result.live,
        { assignment: assignmentView(result.assignment, false) },
        200,
      );
    });
  }),

  http.post('/v1/assets/:id/transfer', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:transfer' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    return idempotent(request, guard.user.id, body, () => {
      if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
      const bodyErrors = [
        ...rejectUnknown(body, [
          ...TARGET_KEYS,
          'to_location_id',
          'expected_return',
          'reason',
          'note',
          'attachment_ids',
        ]),
        ...checkUuids(body, [...TARGET_KEYS, 'to_location_id'], ['to_location_id']),
        ...checkExactlyOneTarget(body),
        ...checkCommon(body),
      ];
      if (bodyErrors.length > 0) return validation(bodyErrors);

      const locked = lockAsset(request, String(params.id));
      if ('response' in locked) return locked.response;
      const { asset } = locked;
      const refusal = refuseAssetAction('transfer', asset);
      if (refusal) return fail(refusal.code, { detail: refusal.detail });

      const target = resolveTarget(body, asset.id);
      if (Array.isArray(target)) return validation(target);
      const dueErrors = checkDue(body);
      if (dueErrors.length > 0) return validation(dueErrors);
      const open = openAssignmentOf(asset.id);
      const holder = asset.current_assignment ?? null;
      if (holder && holder.target_type === target.type && holder.target_id === target.id) {
        return validation([
          {
            pointer: `/${target.type === 'asset' ? 'target_asset' : target.type}_id`,
            message: 'the asset is already with this holder',
            code: 'same-holder',
          },
        ]);
      }
      if (
        body.to_location_id &&
        !registry().locations.some((l) => l.id === body.to_location_id && !l.archived_at)
      ) {
        return validation([missing('/to_location_id', 'No such location.')]);
      }
      // Out of stock the transfer is a check-out: the asset leaves with the deployed status.
      const deployed = open ? null : statusOfType('deployed');
      if (!open && !deployed) return noLabel('deployed');
      const photoErrors = checkPhotos(body.attachment_ids, asset.id);
      if (photoErrors.length > 0) return validation(photoErrors);

      const reason = text(body.reason) ?? null;
      const note = text(body.note) ?? null;
      const result = mutateRegistry((d) => {
        const live = d.assets.find((a) => a.id === asset.id)!;
        if (open) {
          closeAssignment(
            d.assignments.find((a) => a.id === open.id)!,
            guard.user.id,
            {
              locationId: (body.to_location_id as string | undefined) ?? null,
              note: reason ?? note,
              attachmentIds: [],
              condition: null,
            },
          );
        }
        const assignment = openAssignment(d, live, target, body, guard.user.id);
        const fromStatus = { name: statusName(live.status_id), id: live.status_id };
        if (deployed) live.status_id = deployed.id;
        const fromLocation = live.location_id ?? null;
        const newLocation =
          body.to_location_id && body.to_location_id !== live.location_id
            ? (body.to_location_id as string)
            : undefined;
        if (newLocation) live.location_id = newLocation;
        live.updated_at = nowIso();
        live._v += 1;
        const transfer: S['Transfer'] = {
          id: newResourceId('assignment'),
          asset_id: live.id,
          from_assignment_id: open?.id ?? null,
          to_assignment_id: assignment.id,
          from_location_id: fromLocation,
          to_location_id: newLocation ?? fromLocation,
          reason,
          note,
          transferred_at: nowIso(),
          transferred_by: guard.user.id,
        };
        pushEvent(
          d,
          live,
          'transferred',
          `Transferred ${holder ? `from ${holder.target_name ?? holder.target_type} ` : ''}to ${target.name}`,
          guard.user.id,
          { assignmentId: assignment.id, transferId: transfer.id },
          {
            from: holder
              ? { type: holder.target_type, id: holder.target_id, name: holder.target_name ?? null }
              : null,
            to: { type: target.type, id: target.id, name: target.name },
            from_assignment_id: open?.id ?? null,
            to_assignment_id: assignment.id,
            ...(deployed
              ? {
                  status: {
                    from: fromStatus.name,
                    to: deployed.name,
                    from_id: fromStatus.id,
                    to_id: deployed.id,
                  },
                }
              : {}),
            ...(newLocation ? { location: { from: fromLocation, to: newLocation } } : {}),
            ...(reason ? { reason } : {}),
            ...(note ? { note } : {}),
            ...(photoIds(body).length > 0 ? { attachment_ids: photoIds(body) } : {}),
          },
        );
        return { live, assignment, transfer };
      });
      return custodyResponse(
        result.live,
        { transfer: result.transfer, assignment: assignmentView(result.assignment, false) },
        201,
        `/v1/assets/${asset.id}/assignments`,
      );
    });
  }),
];

// ---- undo of a custody action (M2-UX-02, ED-23) ---------------------------------------------------

/** How long after a custody action it can still be undone (the API's UNDO_WINDOW_SECONDS). */
const UNDO_WINDOW_MS = 300_000;
const UNDO_KINDS: Record<
  string,
  { undone: 'checkout' | 'checkin' | 'transfer'; permission: string; label: string }
> = {
  checked_out: { undone: 'checkout', permission: 'asset:checkout', label: 'check-out' },
  checked_in: { undone: 'checkin', permission: 'asset:checkin', label: 'check-in' },
  transferred: { undone: 'transfer', permission: 'asset:transfer', label: 'transfer' },
};
const undoProblem = (code: string, title: string, detail: string) =>
  problem(409, code, title, { detail });

const undoHandlers: HttpHandler[] = [
  http.post('/v1/assets/:id/undo-custody', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:checkout' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    return idempotent(request, guard.user.id, body, () => {
      const ifMatch = request.headers.get('if-match');
      if (!ifMatch || ifMatch === '*') {
        return problem(428, 'precondition-required', 'If-Match is required');
      }
      if (
        !body ||
        typeof body.assignment_id !== 'string' ||
        Object.keys(body).length !== 1 ||
        checkUuids(body, ['assignment_id']).length > 0
      ) {
        return validation([
          { pointer: '/assignment_id', message: 'must be a uuid', code: 'invalid' },
        ]);
      }
      const locked = lockAsset(request, String(params.id));
      if ('response' in locked) return locked.response;
      const { asset } = locked;
      const data = registry();
      const last = [...data.history].reverse().find((h) => h.asset_id === asset.id);
      if (last?.event_type === 'custody_undone') {
        return undoProblem(
          'undo-not-possible',
          'This action cannot be undone',
          'This action was already undone.',
        );
      }
      const kind = last ? UNDO_KINDS[last.event_type] : undefined;
      if (!last || !kind || last.assignment_id !== body.assignment_id) {
        return undoProblem(
          'undo-asset-changed',
          'The asset changed since the action',
          'The asset changed after this action, so it can no longer be undone.',
        );
      }
      if (Date.now() - Date.parse(last.at) > UNDO_WINDOW_MS) {
        return undoProblem(
          'undo-expired',
          'Too late to undo',
          'The time to undo this action has passed.',
        );
      }
      const allowed = requireSession(request, { mutation: true, permission: kind.permission });
      if (!allowed.ok) return allowed.response;

      const payload = (last.payload ?? {}) as Record<string, unknown>;
      const status = payload.status as { from_id?: string } | undefined;
      const wantedStatus = typeof status?.from_id === 'string' ? status.from_id : null;
      const original = data.assignments.find((a) => a.id === last.assignment_id);
      if (!original || original.loaner_pool_id) {
        return undoProblem(
          'undo-not-possible',
          'This action cannot be undone',
          'Loaner custody cannot be undone here. Use the loaner screens.',
        );
      }
      let reopenFrom: MockAssignment | null = null;
      if (kind.undone === 'checkin') {
        if (asset.current_assignment || !original.checked_in_at) {
          return undoProblem(
            'undo-asset-changed',
            'The asset changed since the action',
            'The asset is checked out again.',
          );
        }
        reopenFrom = original;
      } else {
        if (asset.current_assignment?.assignment_id !== original.id || original.checked_in_at) {
          return undoProblem(
            'undo-asset-changed',
            'The asset changed since the action',
            'The asset is no longer held as it was.',
          );
        }
        if (kind.undone === 'transfer' && typeof payload.from_assignment_id === 'string') {
          reopenFrom = data.assignments.find((a) => a.id === payload.from_assignment_id) ?? null;
          if (!reopenFrom || reopenFrom.loaner_pool_id) {
            return undoProblem(
              'undo-not-possible',
              'This action cannot be undone',
              'The previous holder cannot be restored.',
            );
          }
        }
      }
      const restore =
        kind.undone !== 'transfer' || !reopenFrom
          ? data.statusLabels.find((s) => s.id === wantedStatus)
          : undefined;
      if ((kind.undone !== 'transfer' || !reopenFrom) && !restore) {
        return undoProblem(
          'undo-not-possible',
          'This action cannot be undone',
          'The previous status of the asset is not known any more.',
        );
      }
      let holder: Target | null = null;
      if (reopenFrom) {
        const resolved = resolveTarget(
          {
            ...(reopenFrom.person_id ? { person_id: reopenFrom.person_id } : {}),
            ...(reopenFrom.location_id ? { location_id: reopenFrom.location_id } : {}),
            ...(reopenFrom.target_asset_id ? { target_asset_id: reopenFrom.target_asset_id } : {}),
          },
          asset.id,
        );
        if (Array.isArray(resolved)) {
          return undoProblem(
            'undo-not-possible',
            'This action cannot be undone',
            'The previous holder can no longer receive the asset, so the action cannot be undone.',
          );
        }
        holder = resolved;
      }

      const note = `Undo of ${kind.label}`;
      const locationFrom = (payload.location as { from?: string | null } | undefined) ?? undefined;
      const result = mutateRegistry((d) => {
        const live = d.assets.find((a) => a.id === asset.id)!;
        const fromStatus = { id: live.status_id, name: statusName(live.status_id) };
        const fromLocation = live.location_id ?? null;
        const closed =
          kind.undone === 'checkin' ? null : d.assignments.find((a) => a.id === original.id)!;
        if (closed) {
          closeAssignment(closed, guard.user.id, {
            locationId: null,
            note,
            attachmentIds: [],
            condition: null,
          });
        }
        let reopened: MockAssignment | null = null;
        if (reopenFrom && holder) {
          reopened = openAssignment(
            d,
            live,
            holder,
            {
              expected_return: reopenFrom.expected_return ?? undefined,
              note: reopenFrom.note ?? note,
            },
            guard.user.id,
          );
        } else {
          live.current_assignment = null;
        }
        if (restore) live.status_id = restore.id;
        if (locationFrom && 'from' in locationFrom) live.location_id = locationFrom.from ?? null;
        live.updated_at = nowIso();
        live._v += 1;
        let transferId: string | null = null;
        if (kind.undone === 'transfer' && closed && reopened) {
          transferId = newResourceId('assignment');
        }
        const inEffect = (reopened ?? closed)!;
        const who = holder ?? {
          type: original.person_id ? 'person' : original.location_id ? 'location' : 'asset',
          id: (original.person_id ?? original.location_id ?? original.target_asset_id)!,
          name: asset.current_assignment?.target_name ?? '',
        };
        pushEvent(
          d,
          live,
          'custody_undone',
          `Undid ${kind.label}${who.name ? ` (${who.name})` : ''}`,
          guard.user.id,
          { assignmentId: inEffect.id, transferId },
          {
            undone: kind.undone,
            undone_event_type: last.event_type,
            undone_assignment_id: original.id,
            assignment_id: inEffect.id,
            target_type: who.type,
            target_id: who.id,
            target_name: who.name,
            status: {
              from: fromStatus.name,
              to: statusName(live.status_id),
              from_id: fromStatus.id,
              to_id: live.status_id,
            },
            ...(live.location_id !== fromLocation
              ? { location: { from: fromLocation, to: live.location_id ?? null } }
              : {}),
          },
        );
        return { live, inEffect };
      });
      return custodyResponse(
        result.live,
        { assignment: assignmentView(result.inEffect, false), undone: kind.undone },
        200,
      );
    });
  }),
];

// ==== files settings ============================================================================

function filesSettingsView() {
  const s = registry().filesSettings;
  const wanted =
    s.max_upload_bytes === null
      ? s.tier_max_upload_bytes
      : Math.min(s.max_upload_bytes, s.tier_max_upload_bytes);
  return {
    strip_exif_original: s.strip_exif_original,
    max_upload_bytes: s.max_upload_bytes,
    effective_max_upload_bytes: wanted,
    tier_max_upload_bytes: s.tier_max_upload_bytes,
  };
}

/** The upload cap that applies to the organisation. */
const uploadCap = () => filesSettingsView().effective_max_upload_bytes;

const settingsHandlers: HttpHandler[] = [
  http.get('/v1/settings/files', ({ request }) => {
    const guard = requireSession(request, { permission: 'catalog:read' });
    if (!guard.ok) return guard.response;
    return HttpResponse.json(filesSettingsView(), {
      headers: { ETag: etagOf(registry().filesSettings.version) },
    });
  }),

  http.put('/v1/settings/files', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'catalog:manage' });
    if (!guard.ok) return guard.response;
    const stale = checkIfMatch(request, registry().filesSettings.version);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = rejectUnknown(body, ['strip_exif_original', 'max_upload_bytes']);
    if (typeof body.strip_exif_original !== 'boolean') {
      errors.push({
        pointer: '/strip_exif_original',
        message: 'Invalid input: expected boolean',
        code: 'invalid_type',
      });
    }
    const max = body.max_upload_bytes;
    if (max !== null && (typeof max !== 'number' || !Number.isInteger(max))) {
      errors.push({
        pointer: '/max_upload_bytes',
        message: 'Invalid input: expected int',
        code: 'invalid_type',
      });
    } else if (typeof max === 'number' && max < 1024) {
      errors.push({
        pointer: '/max_upload_bytes',
        message: 'Too small: expected number to be >=1024',
        code: 'too_small',
      });
    }
    if (errors.length > 0) return validation(errors);
    mutateRegistry((d) => {
      d.filesSettings.strip_exif_original = body.strip_exif_original as boolean;
      d.filesSettings.max_upload_bytes = body.max_upload_bytes as number | null;
      d.filesSettings.version += 1;
    });
    return HttpResponse.json(filesSettingsView(), {
      headers: { ETag: etagOf(registry().filesSettings.version) },
    });
  }),
];

// ==== attachments ================================================================================

const ENTITY_TYPES = [
  'asset',
  'asset_model',
  'accessory',
  'consumable',
  'location',
  'person',
  'maintenance_record',
  'assignment',
  'import_job',
];
const KINDS = ['photo', 'document', 'signature', 'import_file', 'other'];

/** How long the simulated virus scan takes after the upload is confirmed (tests set it). */
let scanDelayMs = 1500;
export function setMockScanDelay(ms: number): void {
  scanDelayMs = ms;
}
onMockReset(() => {
  scanDelayMs = 1500;
});

/** The upload allow-list of `files/content.ts`: declared type and the extensions a file of it may carry. */
const OOXML = 'application/vnd.openxmlformats-officedocument';
const ODF = 'application/vnd.oasis.opendocument';
const ALLOWED_TYPES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['image/jpeg', ['jpg', 'jpeg']],
  ['image/png', ['png']],
  ['image/webp', ['webp']],
  ['image/gif', ['gif']],
  ['application/pdf', ['pdf']],
  [`${OOXML}.wordprocessingml.document`, ['docx']],
  [`${OOXML}.spreadsheetml.sheet`, ['xlsx']],
  [`${OOXML}.presentationml.presentation`, ['pptx']],
  [`${ODF}.text`, ['odt']],
  [`${ODF}.spreadsheet`, ['ods']],
  [`${ODF}.presentation`, ['odp']],
  ['application/msword', ['doc']],
  ['application/vnd.ms-excel', ['xls']],
  ['application/vnd.ms-powerpoint', ['ppt']],
  ['text/csv', ['csv']],
];

/** Declared type and file name: allow-listed, and the extension fits the type (`checkDeclaredType`). */
function declaredTypeProblem(contentType: string, filename: string): string | null {
  const mime = contentType.split(';')[0]!.trim().toLowerCase();
  const type = ALLOWED_TYPES.find(([m]) => m === mime);
  if (!type) {
    return `Files of type "${mime.slice(0, 100)}" are not accepted. Allowed: images (JPEG, PNG, WebP, GIF), PDF, Office documents and CSV.`;
  }
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 && dot < filename.length - 1 ? filename.slice(dot + 1).toLowerCase() : '';
  if (!type[1].includes(ext)) {
    return `The file name extension "${ext || '(none)'}" does not match ${mime} (expected ${type[1].map((e) => `.${e}`).join(' or ')}).`;
  }
  return null;
}

/** A pending scan answers once its due time has passed (reads advance the simulated scanner). */
function advanceScan(attachment: MockAttachment) {
  if (
    attachment.scan_status === 'pending' &&
    attachment.scan_due_at != null &&
    Date.now() >= attachment.scan_due_at
  ) {
    const infected = attachment.scan_result === 'infected';
    attachment.scan_status = infected ? 'infected' : 'clean';
    attachment.scan_detail = infected ? 'Eicar-Test-Signature' : null;
    if (!infected && attachment.content_type.startsWith('image/')) {
      attachment.width = 640;
      attachment.height = 480;
    }
  }
}

const PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#cbd5e1"/><circle cx="48" cy="40" r="14" fill="#64748b"/><rect x="22" y="62" width="52" height="16" rx="8" fill="#64748b"/></svg>',
)}`;

/**
 * `Attachment` of the contract. The URLs come with the list and the single read alike (null unless
 * the file is clean); the answers of create and complete carry none.
 */
function attachmentView(attachment: MockAttachment, withUrls: boolean) {
  advanceScan(attachment);
  const clean = attachment.scan_status === 'clean' && !!attachment.uploaded_at;
  return {
    id: attachment.id,
    entity_type: attachment.entity_type,
    entity_id: attachment.entity_id,
    kind: attachment.kind,
    filename: attachment.filename,
    content_type: attachment.content_type,
    size_bytes: attachment.size_bytes,
    sha256: attachment.sha256 ?? null,
    scan_status: attachment.scan_status,
    scan_detail: attachment.scan_detail ?? null,
    uploaded_at: attachment.uploaded_at ?? null,
    created_at: attachment.created_at,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    download_url: withUrls && clean ? PLACEHOLDER : null,
    thumbnail_url:
      withUrls && clean && attachment.content_type.startsWith('image/') ? PLACEHOLDER : null,
  };
}

function ownerExists(type: string, id: string): boolean {
  const data = registry();
  switch (type) {
    case 'asset':
      return data.assets.some((a) => a.id === id && !a.archived_at);
    case 'person':
      return data.people.some((p) => p.id === id);
    case 'location':
      return data.locations.some((l) => l.id === id);
    case 'assignment':
      return data.assignments.some((a) => a.id === id);
    default:
      return true;
  }
}

/** Marks an upload rejected (archived, `error`); the caller answers with the problem. */
function rejectUpload(target: MockAttachment, reason: string) {
  mutateRegistry(() => {
    target.scan_status = 'error';
    target.scan_detail = reason;
    target.archived_at = nowIso();
    target._v += 1;
  });
}

const attachmentHandlers: HttpHandler[] = [
  http.get('/v1/attachments', ({ request }) => {
    const guard = requireSession(request, { permission: 'attachment:read' });
    if (!guard.ok) return guard.response;
    const params = new URL(request.url).searchParams;
    const errors: FieldError[] = [];
    const type = params.get('entity_type');
    const entityId = params.get('entity_id');
    if (!type || !ENTITY_TYPES.includes(type)) {
      errors.push({
        pointer: 'query:entity_type',
        message: 'Invalid option',
        code: 'invalid_value',
      });
    }
    if (!entityId || !isUuid(entityId)) {
      errors.push({ pointer: 'query:entity_id', message: 'Invalid UUID', code: 'format' });
    }
    if (params.get('kind') && !KINDS.includes(params.get('kind')!)) {
      errors.push({ pointer: 'query:kind', message: 'Invalid option', code: 'invalid_value' });
    }
    if (errors.length > 0) {
      return fail('bad-request', {
        detail: `Query parameter "${errors[0]!.pointer.split(':')[1]}": ${errors[0]!.message}`,
        errors,
      });
    }
    return paginate(
      request,
      registry().attachments.filter((a) => a.entity_type === type && a.entity_id === entityId),
      {
        sorts: { created_at: (a) => a.created_at },
        defaultSort: '-created_at',
        filter: (a, p) => !p.get('kind') || a.kind === p.get('kind'),
      },
      (a) => attachmentView(a, true),
    );
  }),

  http.post('/v1/attachments', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'attachment:write' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
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
      errors.push({ pointer: '/entity_type', message: 'Invalid option', code: 'invalid_value' });
    }
    errors.push(...checkUuids(body, ['entity_id']));
    if (body.entity_id === undefined) {
      errors.push({
        pointer: '/entity_id',
        message: 'Invalid input: expected string',
        code: 'invalid_type',
      });
    }
    if (body.kind !== undefined && !KINDS.includes(String(body.kind))) {
      errors.push({ pointer: '/kind', message: 'Invalid option', code: 'invalid_value' });
    }
    const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
    if (!filename || filename.length > 255) {
      errors.push({
        pointer: '/filename',
        message: filename
          ? 'Too big: expected string to have <=255 characters'
          : 'Too small: expected string to have >=1 characters',
        code: filename ? 'too_big' : 'too_small',
      });
    }
    const contentType = typeof body.content_type === 'string' ? body.content_type.trim() : '';
    if (!contentType) {
      errors.push({
        pointer: '/content_type',
        message: 'Too small: expected string to have >=1 characters',
        code: 'too_small',
      });
    }
    const size = body.size_bytes;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
      errors.push({
        pointer: '/size_bytes',
        message: 'Invalid input: expected int',
        code: 'invalid_type',
      });
    }
    if (body.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(String(body.sha256))) {
      errors.push({
        pointer: '/sha256',
        message: 'must be 64 lower-case hex characters',
        code: 'pattern',
      });
    }
    if (errors.length > 0) return validation(errors);

    const typeProblem = declaredTypeProblem(contentType, filename);
    if (typeProblem) {
      return fail('unsupported-media-type', {
        detail: typeProblem,
        errors: [{ pointer: '/content_type', message: typeProblem, code: 'type-not-allowed' }],
      });
    }
    const bytes = size as number;
    if (bytes < 1) {
      return validation([{ pointer: '/size_bytes', message: 'The file is empty.', code: 'empty' }]);
    }
    if (body.kind === 'photo' && !contentType.toLowerCase().startsWith('image/')) {
      return validation([
        { pointer: '/kind', message: 'A photo must be an image file.', code: 'photo-not-image' },
      ]);
    }
    const cap = uploadCap();
    if (bytes > cap) {
      return fail('payload-too-large', {
        detail: `The file is ${bytes} bytes; the limit for this organisation is ${cap} bytes.`,
        errors: [{ pointer: '/size_bytes', message: `Must be at most ${cap}.`, code: 'too-large' }],
      });
    }
    if (!ownerExists(String(body.entity_type), String(body.entity_id))) {
      return validation([
        {
          pointer: '/entity_id',
          message: `No such ${String(body.entity_type)}.`,
          code: 'not-found',
        },
      ]);
    }

    const created = mutateRegistry((data) => {
      const stamp = nowIso();
      const attachment: MockAttachment = {
        id: newResourceId('attachment'),
        entity_type: body.entity_type as MockAttachment['entity_type'],
        entity_id: body.entity_id as string,
        kind: (body.kind as MockAttachment['kind']) ?? 'document',
        filename,
        content_type: contentType.split(';')[0]!.trim().toLowerCase(),
        size_bytes: bytes,
        sha256: (body.sha256 as string | undefined) ?? null,
        scan_status: 'pending',
        scan_detail: null,
        width: null,
        height: null,
        uploaded_at: null,
        created_at: stamp,
        archived_at: null,
        scan_due_at: null,
        scan_result: /eicar/i.test(filename) ? 'infected' : 'clean',
        _v: 1,
      };
      data.attachments.push(attachment);
      return attachment;
    });
    return HttpResponse.json(
      {
        attachment: attachmentView(created, false),
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
    const buffer = await request.arrayBuffer();
    const bytes = buffer.byteLength;
    // an import file is read again by the mock import worker (analysis, dry run)
    if (target.kind === 'import_file') {
      rememberImportUpload(target.id, new TextDecoder().decode(buffer));
    }
    mutateRegistry(() => {
      target.stored_bytes = bytes;
    });
    return new HttpResponse(null, { status: 200 });
  }),

  http.post('/v1/attachments/:id/complete', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'attachment:write' });
    if (!guard.ok) return guard.response;
    const target = registry().attachments.find((a) => a.id === params.id && !a.archived_at);
    if (!target) return notFound('Attachment');
    if (target.uploaded_at) return HttpResponse.json(attachmentView(target, false));
    if (target.stored_bytes === undefined) {
      return fail('upload-missing', {
        detail: 'No uploaded file was found. PUT the bytes to the upload URL first.',
      });
    }
    const cap = uploadCap();
    if (target.stored_bytes > cap || target.stored_bytes > target.size_bytes) {
      rejectUpload(target, 'size-exceeded');
      return fail('payload-too-large', {
        detail: `The uploaded object has ${target.stored_bytes} bytes; ${Math.min(cap, target.size_bytes)} were allowed.`,
      });
    }
    if (target.stored_bytes !== target.size_bytes) {
      rejectUpload(target, 'size-mismatch');
      return validation([
        {
          pointer: '/size_bytes',
          message: `The upload has ${target.stored_bytes} bytes, not the declared ${target.size_bytes}.`,
          code: 'size-mismatch',
        },
      ]);
    }
    const updated = mutateRegistry(() => {
      target.uploaded_at = nowIso();
      target.scan_due_at = Date.now() + scanDelayMs;
      target._v += 1;
      return target;
    });
    return HttpResponse.json(attachmentView(updated, false));
  }),

  http.get('/v1/attachments/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'attachment:read' });
    if (!guard.ok) return guard.response;
    const target = registry().attachments.find((a) => a.id === params.id && !a.archived_at);
    return target ? HttpResponse.json(attachmentView(target, true)) : notFound('Attachment');
  }),

  http.delete('/v1/attachments/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'attachment:write' });
    if (!guard.ok) return guard.response;
    const target = registry().attachments.find((a) => a.id === params.id && !a.archived_at);
    if (!target) return notFound('Attachment');
    mutateRegistry(() => {
      target.archived_at = nowIso();
      target._v += 1;
    });
    return new HttpResponse(null, { status: 204 });
  }),
];

export const m2Handlers: HttpHandler[] = [
  ...locationHandlers,
  ...personHandlers,
  ...readHandlers,
  ...custodyHandlers,
  ...undoHandlers,
  ...settingsHandlers,
  ...attachmentHandlers,
];
