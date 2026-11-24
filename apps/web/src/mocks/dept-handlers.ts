import { http, HttpResponse, type HttpHandler } from 'msw';
import { checkIfMatch, etagOf, requireSession } from './http';
import {
  checkTexts,
  checkUuids,
  duplicate,
  fail,
  inUse,
  missing,
  notFound,
  rejectUnknown,
} from './m2-handlers';
import { newResourceId, type MockDepartment } from './registry-fixtures';
import { mutateRegistry, registry } from './registry-state';
import {
  nowIso,
  paginate,
  readBody,
  strip,
  validation,
  type Body,
  type FieldError,
} from './registry-handlers';

/**
 * Mock handlers of the department endpoints (ED-17) of docs/engineering/openapi.yaml, mirroring
 * apps/api/src/departments: names and codes unique among live departments (case-insensitive, trimmed),
 * a live person as manager, `409` with `usage` {people, assets} while the department is referenced,
 * and `DELETE ?reassign_to=` to merge into another live department.
 */
const KEYS = ['name', 'code', 'description', 'manager_person_id'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Live people and assets of a department (the counts the list carries). */
function counts(id: string) {
  const data = registry();
  return {
    person_count: data.people.filter((p) => !p.archived_at && p.department_id === id).length,
    asset_count: data.assets.filter((a) => !a.archived_at && a.department_id === id).length,
  };
}

function view(department: MockDepartment) {
  const manager = department.manager_person_id
    ? registry().people.find((p) => p.id === department.manager_person_id)
    : undefined;
  return {
    ...strip(department),
    manager_name: manager?.display_name ?? null,
    ...counts(department.id),
  };
}

function one(department: MockDepartment, status = 200, headers: Record<string, string> = {}) {
  return HttpResponse.json(view(department), {
    status,
    headers: { ETag: etagOf(department._v), ...headers },
  });
}

/** `''` is "no code" (the API's schema says so once). */
const normalCode = (value: unknown): string | null =>
  typeof value === 'string' ? value.trim() || null : null;

function validateBody(body: Body, creating: boolean): FieldError[] {
  const errors = rejectUnknown(body, KEYS);
  if (creating || 'name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
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
  errors.push(...checkTexts(body, { code: 50, description: 2000 }, ['code', 'description']));
  errors.push(...checkUuids(body, ['manager_person_id'], ['manager_person_id']));
  return errors;
}

/** Name and code are unique among live departments (`409`, pointer on the field). */
function checkUnique(
  name: string | undefined,
  code: string | null | undefined,
  selfId?: string,
): Response | null {
  const live = registry().departments.filter((d) => !d.archived_at && d.id !== selfId);
  if (name && live.some((d) => d.name.trim().toLowerCase() === name.trim().toLowerCase())) {
    return duplicate('A department named', '/name', name);
  }
  if (code && live.some((d) => (d.code ?? '').trim().toLowerCase() === code.toLowerCase())) {
    return duplicate('A department with the code', '/code', code);
  }
  return null;
}

const livePerson = (id: string) => registry().people.some((p) => p.id === id && !p.archived_at);

export const departmentHandlers: HttpHandler[] = [
  http.get('/v1/departments', ({ request }) => {
    const guard = requireSession(request, { permission: 'department:read' });
    if (!guard.ok) return guard.response;
    return paginate(
      request,
      registry().departments,
      {
        sorts: {
          name: (d) => d.name.toLowerCase(),
          code: (d) => d.code,
          created_at: (d) => d.created_at,
        },
        defaultSort: 'name',
        // the stored lower-case keys of the API: name and code
        haystack: (d) => [d.name, d.code],
      },
      (d) => view(d),
    );
  }),

  http.get('/v1/departments/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'department:read' });
    if (!guard.ok) return guard.response;
    const found = registry().departments.find((d) => d.id === params.id);
    return found ? one(found) : notFound('Department');
  }),

  http.post('/v1/departments', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'department:manage' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = validateBody(body, true);
    if (errors.length > 0) return validation(errors);
    if (typeof body.manager_person_id === 'string' && !livePerson(body.manager_person_id)) {
      return validation([missing('/manager_person_id', 'No such person.')]);
    }
    const name = String(body.name).trim();
    const code = normalCode(body.code);
    const clash = checkUnique(name, code);
    if (clash) return clash;
    const created = mutateRegistry((d) => {
      const stamp = nowIso();
      const department: MockDepartment = {
        id: newResourceId('department'),
        created_at: stamp,
        updated_at: stamp,
        archived_at: null,
        name,
        code,
        description: typeof body.description === 'string' ? body.description.trim() : null,
        manager_person_id: (body.manager_person_id as string | null | undefined) ?? null,
        _v: 1,
      };
      d.departments.push(department);
      return department;
    });
    return one(created, 201, { Location: `/v1/departments/${created.id}` });
  }),

  http.patch('/v1/departments/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'department:manage' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const bodyErrors = validateBody(body, false);
    if (bodyErrors.length > 0) return validation(bodyErrors);
    const existing = registry().departments.find((d) => d.id === params.id);
    if (!existing || existing.archived_at) return notFound('Department');
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    if (
      typeof body.manager_person_id === 'string' &&
      body.manager_person_id !== existing.manager_person_id &&
      !livePerson(body.manager_person_id)
    ) {
      return validation([missing('/manager_person_id', 'No such person.')]);
    }

    const changes: Partial<MockDepartment> = {};
    if (typeof body.name === 'string' && body.name.trim() !== existing.name) {
      changes.name = body.name.trim();
    }
    if ('code' in body && normalCode(body.code) !== existing.code) {
      changes.code = normalCode(body.code);
    }
    if ('description' in body) {
      const next = typeof body.description === 'string' ? body.description.trim() : null;
      if (next !== existing.description) changes.description = next;
    }
    if ('manager_person_id' in body && body.manager_person_id !== existing.manager_person_id) {
      changes.manager_person_id = (body.manager_person_id as string | null) ?? null;
    }
    if (Object.keys(changes).length === 0) return one(existing);
    const clash = checkUnique(changes.name, changes.code, existing.id);
    if (clash) return clash;
    const updated = mutateRegistry((d) => {
      const target = d.departments.find((x) => x.id === existing.id)!;
      Object.assign(target, changes);
      target.updated_at = nowIso();
      target._v += 1;
      return target;
    });
    return one(updated);
  }),

  http.delete('/v1/departments/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'department:manage' });
    if (!guard.ok) return guard.response;
    const reassignTo = new URL(request.url).searchParams.get('reassign_to');
    if (reassignTo !== null && !UUID.test(reassignTo)) {
      return fail('bad-request', {
        detail: 'The query string is invalid.',
        errors: [{ pointer: 'query:reassign_to', message: 'Invalid UUID', code: 'format' }],
      });
    }
    const existing = registry().departments.find((d) => d.id === params.id);
    if (!existing || existing.archived_at) return notFound('Department');
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    const { person_count, asset_count } = counts(existing.id);
    if (reassignTo !== null) {
      if (reassignTo === existing.id) {
        return validation([
          {
            pointer: 'query:reassign_to',
            message: 'must be a different department',
            code: 'invalid',
          },
        ]);
      }
      const target = registry().departments.find((d) => d.id === reassignTo);
      if (!target || target.archived_at) {
        return validation([missing('query:reassign_to', 'No such department.')]);
      }
    } else if (person_count + asset_count > 0) {
      return inUse('Department', { people: person_count, assets: asset_count });
    }
    mutateRegistry((d) => {
      if (reassignTo !== null) {
        // every reference moves, archived people and assets included
        const stamp = nowIso();
        for (const row of [...d.people, ...d.assets]) {
          if (row.department_id !== existing.id) continue;
          row.department_id = reassignTo;
          row.updated_at = stamp;
          row._v += 1;
        }
      }
      const target = d.departments.find((x) => x.id === existing.id)!;
      target.archived_at = nowIso();
      target._v += 1;
    });
    return new HttpResponse(null, { status: 204 });
  }),
];
