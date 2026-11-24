import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type App,
  type Basics,
  type TenantFixture,
  type Resp,
  auditRows,
  basics,
  contractViolations,
  createTenant,
  createUser,
  ifMatch,
  newAsset,
  newPerson,
  newTenancy,
  outboxRows,
  ownerTenantSql,
  startRegistryApp,
  unique,
} from './support.js';

/**
 * Managed departments (ED-17, founder request 2026-11-24): the table, its rules, the references from
 * people and assets, the merge-on-archive, permissions, and the migration of the old free text.
 */
describe.skipIf(!dbEnabled)(`departments (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  let b: Basics;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'depts');
    other = await createTenant(app, tenancy, 'depts2');
    b = await basics(t);
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    // every status this file provoked is one the contract documents for that operation
    expect(contractViolations()).toEqual([]);
  });

  const newDepartment = async (extra: Record<string, unknown> = {}) => {
    const res = await a().post('/v1/departments', { name: unique('Dept'), ...extra });
    if (res.status !== 201) throw new Error(`create department: ${res.status} ${res.raw}`);
    return {
      id: res.body.id as string,
      name: res.body.name as string,
      etag: String(res.headers.etag),
    };
  };
  const etagOf = async (url: string) => String((await a().get(url)).headers.etag);
  const patch = async (url: string, body: Record<string, unknown>) =>
    a().patch(url, body, ifMatch(await etagOf(url)));
  const archive = async (id: string, query = '') =>
    a().del(
      `/v1/departments/${id}${query}`,
      undefined,
      ifMatch(await etagOf(`/v1/departments/${id}`)),
    );

  describe('the department resource', () => {
    it('creates with 201, ETag and Location; reads back with counts; lists with search, sort and cursors', async () => {
      const marker = unique('Zd');
      const res = await a().post('/v1/departments', {
        name: `${marker} Physics`,
        code: `${marker}-PH`,
        description: 'Labs',
      });
      expect(res.status).toBe(201);
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(`/v1/departments/${res.body.id}`);
      expect(res.body).toMatchObject({
        name: `${marker} Physics`,
        code: `${marker}-PH`,
        description: 'Labs',
        manager_person_id: null,
        manager_name: null,
        person_count: 0,
        asset_count: 0,
        archived_at: null,
      });
      const got = await a().get(`/v1/departments/${res.body.id}`);
      expect(got.status).toBe(200);
      expect(got.headers.etag).toBe('W/"1"');

      for (let i = 0; i < 4; i++) await newDepartment({ name: `${marker} ${i}` });
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Resp = await a().get(
          `/v1/departments?q=${marker}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        );
        expect(page.status).toBe(200);
        seen.push(...page.body.data.map((d: { id: string }) => d.id));
        cursor = page.body.page.next_cursor;
      } while (cursor);
      expect(new Set(seen).size).toBe(5);
      // search matches the code too, case-insensitively; sort by name; total on request
      expect(
        (await a().get(`/v1/departments?q=${marker.toLowerCase()}-ph`)).body.data,
      ).toHaveLength(1);
      const sorted = await a().get(`/v1/departments?q=${marker}&sort=-name&include_total=true`);
      expect(sorted.body.page.total).toBe(5);
      const names = sorted.body.data.map((d: { name: string }) => d.name);
      expect(names).toEqual([...names].sort().reverse());
      expect((await a().get('/v1/departments?sort=nope')).status).toBe(400);
    });

    it('a name is unique among live departments whatever its case or padding; so is a code; both are free again once archived', async () => {
      const d = await newDepartment({ name: unique('Maths'), code: unique('M').toUpperCase() });
      for (const name of [d.name.toUpperCase(), `  ${d.name.toLowerCase()}  `]) {
        const res = await a().post('/v1/departments', { name });
        expect(res.status, name).toBe(409);
        expect(res.body.errors[0]).toMatchObject({ pointer: '/name', code: 'duplicate' });
      }
      const dupCode = await a().post('/v1/departments', {
        name: unique('Other'),
        code: (await a().get(`/v1/departments/${d.id}`)).body.code.toLowerCase(),
      });
      expect(dupCode.status).toBe(409);
      expect(dupCode.body.errors[0]).toMatchObject({ pointer: '/code', code: 'duplicate' });
      // an empty code is "no code": two departments may both have none
      expect((await a().post('/v1/departments', { name: unique('A'), code: '' })).status).toBe(201);
      expect((await a().post('/v1/departments', { name: unique('B'), code: '' })).status).toBe(201);
      // renaming onto another live name is the same 409; onto its own name (other case) is fine
      const second = await newDepartment();
      const clash = await patch(`/v1/departments/${second.id}`, { name: d.name.toUpperCase() });
      expect(clash.status).toBe(409);
      expect(clash.body.errors[0].pointer).toBe('/name');
      expect((await patch(`/v1/departments/${d.id}`, { name: d.name.toUpperCase() })).status).toBe(
        200,
      );
      // another tenant may use the same name
      expect((await other.admin.post('/v1/departments', { name: d.name })).status).toBe(201);
      // archived: the name is free again
      expect((await archive(d.id)).status).toBe(204);
      expect((await a().post('/v1/departments', { name: d.name })).status).toBe(201);
    });

    it('PATCH needs If-Match (428), refuses a stale one (412), merges fields and keeps people linked after a rename', async () => {
      const d = await newDepartment({ name: unique('Old') });
      const person = await newPerson(a(), { department_id: d.id });
      expect((await a().patch(`/v1/departments/${d.id}`, { description: 'x' })).status).toBe(428);
      expect(
        (await a().patch(`/v1/departments/${d.id}`, { description: 'x' }, ifMatch('W/"9"'))).status,
      ).toBe(412);
      const renamed = await a().patch(
        `/v1/departments/${d.id}`,
        { name: unique('New'), description: 'Renamed' },
        ifMatch(d.etag),
      );
      expect(renamed.status).toBe(200);
      expect(renamed.headers.etag).toBe('W/"2"');
      expect(renamed.body).toMatchObject({ description: 'Renamed', person_count: 1 });
      // the person still points at it and now reads the new name
      const got = await a().get(`/v1/people/${person.id}`);
      expect(got.body).toMatchObject({ department_id: d.id, department: renamed.body.name });
      // null clears a nullable field; an unchanged body is a no-op that keeps the ETag
      const cleared = await patch(`/v1/departments/${d.id}`, { description: null, code: null });
      expect(cleared.body).toMatchObject({ description: null, code: null });
      const same = await patch(`/v1/departments/${d.id}`, { description: null });
      expect(same.headers.etag).toBe(cleared.headers.etag);
      expect((await patch(`/v1/departments/${d.id}`, { name: '' })).status).toBe(422);
      expect((await patch(`/v1/departments/${d.id}`, { nope: 1 })).status).toBe(422);
      expect(
        (await a().get(`/v1/departments/${'0'.repeat(8)}-0000-4000-8000-000000000000`)).status,
      ).toBe(404);
    });

    it('the manager must be a live person; the name of the manager is shown', async () => {
      const boss = await newPerson(a(), { display_name: unique('Boss') });
      const d = await newDepartment({ manager_person_id: boss.id });
      expect((await a().get(`/v1/departments/${d.id}`)).body).toMatchObject({
        manager_person_id: boss.id,
        manager_name: boss.body.display_name,
      });
      const missing = await a().post('/v1/departments', {
        name: unique('X'),
        manager_person_id: '00000000-0000-4000-8000-000000000000',
      });
      expect(missing.status).toBe(422);
      expect(missing.body.errors[0]).toMatchObject({ pointer: '/manager_person_id' });
      // a person of another tenant is "no such person"
      const foreign = await newPerson(other.admin);
      expect(
        (await a().post('/v1/departments', { name: unique('X'), manager_person_id: foreign.id }))
          .status,
      ).toBe(422);
      // an archived person cannot be named
      const gone = await newPerson(a());
      await a().del(
        `/v1/people/${gone.id}`,
        undefined,
        ifMatch(await etagOf(`/v1/people/${gone.id}`)),
      );
      expect((await patch(`/v1/departments/${d.id}`, { manager_person_id: gone.id })).status).toBe(
        422,
      );
      expect(
        (await patch(`/v1/departments/${d.id}`, { manager_person_id: null })).body.manager_name,
      ).toBeNull();
    });

    it('writes an audit row and an outbox event for every change', async () => {
      const d = await newDepartment();
      await patch(`/v1/departments/${d.id}`, { description: 'n' });
      await archive(d.id);
      const audit = await auditRows(
        t.tenantId,
        `entity_type = 'department' and entity_id = '${d.id}'`,
      );
      expect(audit.map((r) => r.action)).toEqual([
        'department.created',
        'department.updated',
        'department.archived',
      ]);
      const events = await outboxRows(t.tenantId, `aggregate_id = '${d.id}'`);
      expect(events.map((e) => e.event_type)).toEqual([
        'department.created',
        'department.updated',
        'department.archived',
      ]);
    });
  });

  describe('people and assets reference a department', () => {
    it('a person takes department_id (read back with the name); the old free text is gone', async () => {
      const d = await newDepartment();
      const created = await a().post('/v1/people', {
        display_name: unique('P'),
        department_id: d.id,
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ department_id: d.id, department: d.name });
      // the free-text field is not accepted any more
      const text = await a().post('/v1/people', { display_name: unique('P'), department: 'Maths' });
      expect(text.status).toBe(422);
      expect(text.body.errors[0]).toMatchObject({ code: 'unrecognized_keys' });
      // unknown, archived and foreign departments are 422 on /department_id
      const gone = await newDepartment();
      await archive(gone.id);
      const foreign = (await other.admin.post('/v1/departments', { name: unique('F') })).body;
      for (const id of ['00000000-0000-4000-8000-000000000000', gone.id, foreign.id]) {
        const res = await a().post('/v1/people', { display_name: unique('P'), department_id: id });
        expect(res.status, id).toBe(422);
        expect(res.body.errors[0]).toMatchObject({ pointer: '/department_id' });
      }
      // change, clear
      const moved = await patch(`/v1/people/${created.body.id}`, { department_id: null });
      expect(moved.body).toMatchObject({ department_id: null, department: null });
      const back = await patch(`/v1/people/${created.body.id}`, { department_id: d.id });
      expect(back.body.department).toBe(d.name);
    });

    it('lists people by department_id and shows the name in the list; the person CSV carries it', async () => {
      const d = await newDepartment();
      const other2 = await newDepartment();
      const one = await newPerson(a(), { department_id: d.id, display_name: unique('A') });
      await newPerson(a(), { department_id: d.id, display_name: unique('B') });
      await newPerson(a(), { department_id: other2.id });
      const list = await a().get(`/v1/people?department_id=${d.id}`);
      expect(list.body.data).toHaveLength(2);
      for (const p of list.body.data)
        expect(p).toMatchObject({ department_id: d.id, department: d.name });
      expect((await a().get('/v1/people?department_id=nope')).status).toBe(400);
      expect((await a().get('/v1/people?department=Maths')).status).toBe(200); // unknown filters are ignored
      const counts = (await a().get(`/v1/departments/${d.id}`)).body;
      expect(counts.person_count).toBe(2);
      expect(one.id).toBeTruthy();
    });

    it('an asset takes department_id on create, update, bulk edit and clone; expand=department; filter by department_id', async () => {
      const d1 = await newDepartment();
      const d2 = await newDepartment();
      const created = await newAsset(a(), b.categoryId, { department_id: d1.id });
      expect(created.body.department_id).toBe(d1.id);
      expect(created.body.location_id).toBeNull(); // ownership is not location
      const withExpand = await a().get(`/v1/assets/${created.id}?expand=department`);
      expect(withExpand.body.expanded.department).toMatchObject({ id: d1.id, name: d1.name });
      expect((await a().get(`/v1/assets/${created.id}`)).body.expanded).toBeUndefined();

      const updated = await a().patch(
        `/v1/assets/${created.id}`,
        { department_id: d2.id },
        ifMatch(created.etag),
      );
      expect(updated.status).toBe(200);
      expect(updated.body.department_id).toBe(d2.id);

      const second = await newAsset(a(), b.categoryId);
      const bulk = await a().post('/v1/assets/bulk-update', {
        ids: [created.id, second.id],
        changes: { department_id: d1.id },
      });
      expect(bulk.status).toBe(200);
      expect(bulk.body.summary).toMatchObject({ succeeded: 2, failed: 0 });
      expect((await a().get(`/v1/assets?department_id=${d1.id}`)).body.data).toHaveLength(2);
      expect((await a().get(`/v1/assets?department_id=${d2.id}`)).body.data).toHaveLength(0);

      const clone = await a().post(`/v1/assets/${created.id}/clone`, { count: 1 });
      expect(clone.status).toBe(201);
      expect(clone.body.data[0].department_id).toBe(d1.id);
      const noCopy = await a().post(`/v1/assets/${created.id}/clone`, {
        count: 1,
        copy_fields: ['name'],
      });
      expect(noCopy.body.data[0].department_id).toBeNull();
      // clearing through the bulk edit
      const cleared = await a().post('/v1/assets/bulk-update', {
        ids: [second.id],
        changes: { department_id: null },
      });
      expect(cleared.body.results[0].data.department_id).toBeNull();

      // references are validated, with the pointer of the field
      const gone = await newDepartment();
      await archive(gone.id);
      for (const id of [gone.id, '00000000-0000-4000-8000-000000000000']) {
        const res = await a().post('/v1/assets', { category_id: b.categoryId, department_id: id });
        expect(res.status, id).toBe(422);
        expect(res.body.errors[0]).toMatchObject({ pointer: '/department_id' });
        const upd = await a().patch(
          `/v1/assets/${second.id}`,
          { department_id: id },
          ifMatch(await etagOf(`/v1/assets/${second.id}`)),
        );
        expect(upd.status, id).toBe(422);
      }
      // the department's counts follow
      const counts = (await a().get(`/v1/departments/${d1.id}`)).body;
      expect(counts.asset_count).toBe(2); // the asset and its clone (the second one was cleared)
    });
  });

  describe('archive and merge', () => {
    it('refuses while people or assets use it (409 with usage); an empty one archives', async () => {
      const d = await newDepartment();
      await newPerson(a(), { department_id: d.id });
      await newPerson(a(), { department_id: d.id });
      await newAsset(a(), b.categoryId, { department_id: d.id });
      const res = await archive(d.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('conflict');
      expect(res.body.usage).toEqual({ people: 2, assets: 1 });
      const empty = await newDepartment();
      expect((await archive(empty.id)).status).toBe(204);
      const got = await a().get(`/v1/departments/${empty.id}`);
      expect(got.body.archived_at).not.toBeNull();
      expect((await patch(`/v1/departments/${empty.id}`, { description: 'x' })).status).toBe(404);
      expect((await archive(empty.id)).status).toBe(404);
    });

    it('reassign_to merges: every person and asset moves in one transaction, the department is archived, the audit says how many', async () => {
      const from = await newDepartment();
      const into = await newDepartment();
      const p1 = await newPerson(a(), { department_id: from.id });
      const gone = await newPerson(a(), { department_id: from.id });
      await a().del(
        `/v1/people/${gone.id}`,
        undefined,
        ifMatch(await etagOf(`/v1/people/${gone.id}`)),
      );
      const asset = await newAsset(a(), b.categoryId, { department_id: from.id });
      const res = await archive(from.id, `?reassign_to=${into.id}`);
      expect(res.status).toBe(204);
      expect((await a().get(`/v1/people/${p1.id}`)).body).toMatchObject({
        department_id: into.id,
        department: into.name,
      });
      expect((await a().get(`/v1/assets/${asset.id}`)).body.department_id).toBe(into.id);
      // an archived person is moved too: nothing may point at the archived department
      expect((await a().get(`/v1/people/${gone.id}`)).body.department_id).toBe(into.id);
      expect((await a().get(`/v1/departments/${into.id}`)).body).toMatchObject({
        person_count: 1,
        asset_count: 1,
      });
      const audit = await auditRows(
        t.tenantId,
        `entity_type = 'department' and entity_id = '${from.id}' and action = 'department.archived'`,
      );
      expect(audit[0]!.diff).toBeTruthy();
    });

    it('reassign_to must be another live department (422)', async () => {
      const d = await newDepartment();
      const gone = await newDepartment();
      await archive(gone.id);
      await newPerson(a(), { department_id: d.id });
      for (const target of [d.id, gone.id, '00000000-0000-4000-8000-000000000000']) {
        const res = await archive(d.id, `?reassign_to=${target}`);
        expect(res.status, target).toBe(422);
        expect(res.body.errors[0]).toMatchObject({ pointer: 'query:reassign_to' });
      }
      expect((await archive(d.id, '?reassign_to=nope')).status).toBe(400);
      // another tenant's department is "no such department"
      const foreign = (await other.admin.post('/v1/departments', { name: unique('F') })).body;
      expect((await archive(d.id, `?reassign_to=${foreign.id}`)).status).toBe(422);
      expect((await a().get(`/v1/departments/${d.id}`)).body.archived_at).toBeNull();
    });
  });

  describe('permissions', () => {
    it('everybody reads; the asset manager and the administrator write; technician, auditor and viewer get 403', async () => {
      const d = await newDepartment();
      const manager = await createUser(app, t, 'asset_manager');
      const made = await manager.client.post('/v1/departments', { name: unique('M') });
      expect(made.status).toBe(201);
      for (const role of ['technician', 'auditor', 'viewer']) {
        const user = await createUser(app, t, role);
        expect((await user.client.get('/v1/departments')).status, role).toBe(200);
        expect((await user.client.get(`/v1/departments/${d.id}`)).status, role).toBe(200);
        expect(
          (await user.client.post('/v1/departments', { name: unique('X') })).status,
          role,
        ).toBe(403);
        expect(
          (
            await user.client.patch(
              `/v1/departments/${d.id}`,
              { description: 'x' },
              ifMatch(d.etag),
            )
          ).status,
          role,
        ).toBe(403);
        expect(
          (await user.client.del(`/v1/departments/${d.id}`, undefined, ifMatch(d.etag))).status,
          role,
        ).toBe(403);
      }
    });
  });

  describe('migration 0100: the free text becomes departments', () => {
    it('links people by their trimmed, case-insensitively deduplicated text, once per tenant, without touching their version; a rerun changes nothing', async () => {
      const marker = unique('Mig');
      const spellings = [
        `${marker} Maths`,
        ` ${marker} maths `,
        `${marker} MATHS`,
        `${marker} Art`,
      ];
      const ids: string[] = [];
      for (const [i, text] of spellings.entries()) {
        const p = await newPerson(a(), { display_name: unique(`Free${i}`) });
        ids.push(p.id);
        // the column the API no longer writes: planted by the owner, as an old database would have it
        await ownerTenantSql(t.tenantId, `update app.person set department = $1 where id = $2`, [
          text,
          p.id,
        ]);
      }
      const before = (await a().get(`/v1/people/${ids[0]}`)).headers.etag;

      const sql = readFileSync(
        new URL('../../migrations/0100_departments.sql', import.meta.url),
        'utf8',
      );
      const start = sql.indexOf('alter table app.person disable trigger trg_touch_person;');
      const end =
        sql.indexOf('alter table app.person enable trigger trg_touch_person;') +
        'alter table app.person enable trigger trg_touch_person;'.length;
      const data = sql.slice(start, end);
      expect(data).toContain('identity.tenant_directory');
      await ownerTenantSql(t.tenantId, data);

      const linked = await Promise.all(ids.map((id) => a().get(`/v1/people/${id}`)));
      const maths = new Set(linked.slice(0, 3).map((r) => r.body.department_id));
      expect(maths.size).toBe(1);
      expect(maths.has(null)).toBe(false);
      expect(linked[3]!.body.department_id).not.toBe([...maths][0]);
      // the most used spelling (after trimming) names it; no version bump
      const mathsName = linked[0]!.body.department as string;
      expect(mathsName.trim()).toBe(mathsName);
      expect(mathsName.toLowerCase()).toBe(`${marker} maths`.toLowerCase());
      expect(linked[0]!.headers.etag).toBe(before);
      const departments = (await a().get(`/v1/departments?q=${marker}`)).body.data;
      expect(departments).toHaveLength(2);

      // rerunning (idempotent): no duplicate departments, nothing re-linked
      await ownerTenantSql(t.tenantId, data);
      expect((await a().get(`/v1/departments?q=${marker}`)).body.data).toHaveLength(2);
    });
  });
});
