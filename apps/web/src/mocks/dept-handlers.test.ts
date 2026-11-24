import { ApiError } from '@assettracker/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { getApi } from '@/lib/api';
import { assetsApi, departmentsApi, fetchAll, peopleApi } from '@/lib/registry/api';
import { seedSession } from '@/test/render';
import { MOCK_ACCOUNTS } from './fixtures';
import { uid } from './registry-fixtures';

/**
 * The department mock endpoints follow docs/engineering/openapi.yaml and apps/api/src/departments:
 * unique names and codes, a live manager, `409` with `usage`, merge through `reassign_to`, the
 * references from people and assets.
 */
async function fails(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error('expected the request to fail');
}

const problem = (error: ApiError) =>
  error.body as {
    code?: string;
    usage?: Record<string, number>;
    errors?: Array<{ pointer: string; code?: string }>;
  };

describe('mock departments (owner)', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('lists the six demo departments with counts and the manager name', async () => {
    const all = await fetchAll((cursor) => departmentsApi.list({ limit: 200, cursor }));
    expect(all.map((d) => d.name)).toEqual([
      'Administration',
      'Facilities',
      'IT',
      'Library',
      'Mathematics',
      'Science',
    ]);
    const it = all.find((d) => d.name === 'IT')!;
    expect(it).toMatchObject({ code: 'IT', manager_name: 'Alice Owner' });
    expect(it.person_count).toBeGreaterThan(0);
    expect(it.asset_count).toBeGreaterThan(0);
    // searches the name and the code, case-insensitively
    expect((await departmentsApi.list({ q: 'math' })).data.map((d) => d.name)).toEqual([
      'Mathematics',
    ]);
    expect((await departmentsApi.list({ q: 'lib' })).data.map((d) => d.name)).toEqual(['Library']);
  });

  it('creates with 201, keeps names and codes unique among live departments, and gives the ETag', async () => {
    const created = await departmentsApi.create({ name: ' Art ', code: 'ART' });
    expect(created.value).toMatchObject({ name: 'Art', code: 'ART', person_count: 0 });
    expect(created.etag).toBe('W/"1"');
    const sameName = await fails(departmentsApi.create({ name: 'art' }));
    expect(sameName.status).toBe(409);
    expect(problem(sameName).errors![0]).toMatchObject({ pointer: '/name', code: 'duplicate' });
    const sameCode = await fails(departmentsApi.create({ name: 'Arts', code: 'art' }));
    expect(problem(sameCode).errors![0]).toMatchObject({ pointer: '/code' });
    // an empty code is "no code": two departments may both have none
    await departmentsApi.create({ name: 'No code one', code: '' });
    await departmentsApi.create({ name: 'No code two', code: '' });
    expect((await fails(departmentsApi.create({ name: '' }))).status).toBe(422);
  });

  it('the manager must be a live person; patch needs a fresh ETag and keeps references', async () => {
    const bad = await fails(
      departmentsApi.create({
        name: 'Ghosts',
        manager_person_id: '00000000-0000-4000-8000-000000000000',
      }),
    );
    expect(problem(bad).errors![0]).toMatchObject({ pointer: '/manager_person_id' });

    const library = (await departmentsApi.list({ q: 'Library' })).data[0]!;
    const before = await departmentsApi.get(library.id);
    const renamed = await departmentsApi.update(
      library.id,
      { name: 'Learning centre' },
      before.etag,
    );
    expect(renamed.value.name).toBe('Learning centre');
    const stale = await fails(departmentsApi.update(library.id, { name: 'Again' }, before.etag));
    expect(stale.status).toBe(412);
    const clash = await fails(departmentsApi.update(library.id, { name: 'it' }));
    expect(clash.status).toBe(409);
    // people point at the id: the new name shows on them
    const people = await peopleApi.list({ department_id: library.id, limit: 5 });
    expect(people.data.length).toBeGreaterThan(0);
    for (const p of people.data) expect(p.department).toBe('Learning centre');
  });

  it('archive: 409 with usage while people or assets use it, 422 for a bad reassign_to, merge moves everything', async () => {
    const science = (await departmentsApi.list({ q: 'Science' })).data[0]!;
    const maths = (await departmentsApi.list({ q: 'Mathematics' })).data[0]!;
    expect(science.person_count).toBeGreaterThan(0);
    const refused = await fails(departmentsApi.archive(science.id));
    expect(refused.status).toBe(409);
    expect(problem(refused).usage).toEqual({
      people: science.person_count,
      assets: science.asset_count,
    });
    for (const target of [science.id, uid('department', 99)]) {
      const bad = await fails(departmentsApi.archive(science.id, { reassignTo: target }));
      expect(bad.status).toBe(422);
      expect(problem(bad).errors![0]!.pointer).toBe('query:reassign_to');
    }
    const mathsBefore = (await departmentsApi.get(maths.id)).value;
    await departmentsApi.archive(science.id, { reassignTo: maths.id });
    const mathsAfter = (await departmentsApi.get(maths.id)).value;
    expect(mathsAfter.person_count).toBe(
      (mathsBefore.person_count ?? 0) + (science.person_count ?? 0),
    );
    expect(mathsAfter.asset_count).toBe(
      (mathsBefore.asset_count ?? 0) + (science.asset_count ?? 0),
    );
    // the archived one is gone from the default list, readable with archived=include, and cannot be edited
    expect((await departmentsApi.list({ q: 'Science' })).data).toHaveLength(0);
    expect(
      (await departmentsApi.list({ q: 'Science', archived: 'include' })).data[0]!.archived_at,
    ).not.toBeNull();
    expect((await fails(departmentsApi.update(science.id, { description: 'x' }))).status).toBe(404);
    // an unused department archives directly
    const empty = (await departmentsApi.create({ name: 'Empty' })).value;
    await departmentsApi.archive(empty.id);
  });
});

describe('mock people and assets reference a department', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('a person takes department_id, reads back the name and refuses the old free text', async () => {
    const it = (await departmentsApi.list({ q: 'IT' })).data.find((d) => d.name === 'IT')!;
    const created = (await peopleApi.create({ display_name: 'Dept Test', department_id: it.id }))
      .value;
    expect(created).toMatchObject({ department_id: it.id, department: 'IT' });
    const text = await fails(
      getApi().http.POST('/v1/people', {
        body: { display_name: 'Free text', department: 'Maths' } as never,
      }),
    );
    expect(text.status).toBe(422);
    expect(problem(text).errors![0]).toMatchObject({ pointer: '/', code: 'unrecognized_keys' });
    const missing = await fails(
      peopleApi.create({
        display_name: 'Nowhere',
        department_id: '00000000-0000-4000-8000-000000000000',
      }),
    );
    expect(problem(missing).errors![0]).toMatchObject({ pointer: '/department_id' });
    const cleared = await peopleApi.update(created.id, { department_id: null });
    expect(cleared.value).toMatchObject({ department_id: null, department: null });
    const filtered = await peopleApi.list({ department_id: it.id, include_total: true });
    expect(filtered.data.every((p) => p.department_id === it.id)).toBe(true);
  });

  it('an asset takes department_id: filter, expand, bulk edit, validation', async () => {
    const lib = (await departmentsApi.list({ q: 'Library' })).data[0]!;
    const some = await assetsApi.list({ department_id: lib.id, expand: ['department'], limit: 3 });
    expect(some.data.length).toBeGreaterThan(0);
    for (const a of some.data) {
      expect(a.department_id).toBe(lib.id);
      expect((a.expanded as { department?: { name: string } }).department?.name).toBe('Library');
    }
    const free = (await assetsApi.list({ limit: 200 })).data.filter((a) => !a.department_id);
    expect(free.length).toBeGreaterThan(0);
    const ids = free.slice(0, 2).map((a) => a.id);
    const bulk = await assetsApi.bulkUpdate(ids, { department_id: lib.id });
    expect(bulk.summary).toMatchObject({ succeeded: 2, failed: 0 });
    const cleared = await assetsApi.bulkUpdate(ids, { department_id: null });
    expect(cleared.results![0]!.data!.department_id).toBeNull();
    const bad = await assetsApi.bulkUpdate(ids, {
      department_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(bad.summary).toMatchObject({ failed: 2 });
  });
});

describe('mock departments (roles)', () => {
  it('a viewer reads departments but cannot write; a manager can write', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    expect((await departmentsApi.list()).data.length).toBeGreaterThan(0);
    expect((await fails(departmentsApi.create({ name: 'Nope' }))).status).toBe(403);
    seedSession(MOCK_ACCOUNTS.manager);
    expect((await departmentsApi.create({ name: 'Manager made' })).value.name).toBe('Manager made');
  });
});
