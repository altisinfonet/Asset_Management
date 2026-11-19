import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type App,
  type TenantFixture,
  auditRows,
  contractViolations,
  basics,
  createTenant,
  createUser,
  ifMatch,
  keyed,
  newAsset,
  newLocation,
  newPerson,
  newTenancy,
  outboxRows,
  startRegistryApp,
  testPorts,
  unique,
  type Basics,
  type Resp,
} from './support.js';

/** M2-USR-01: people (assignable persons with or without a login, ED-01). */
describe.skipIf(!dbEnabled)(`people (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  let b: Basics;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'ppl');
    other = await createTenant(app, tenancy, 'ppl2');
    b = await basics(t);
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  it('every login account has one person row (created by the database), linked through user_id', async () => {
    const me = (await a().get('/v1/auth/me')).body.user;
    const mine = await a().get(`/v1/people?q=${t.adminEmail}&has_login=true`);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({
      user_id: me.id,
      email: t.adminEmail,
      kind: 'employee',
      status: 'active',
    });
    const tech = await createUser(app, t, 'technician');
    const person = (await a().get(`/v1/people?q=${tech.email}`)).body.data;
    expect(person).toHaveLength(1);
    expect(person[0]).toMatchObject({ user_id: tech.id, display_name: 'User technician' });
    // a rename of the account renames the person
    const user = await a().get(`/v1/users/${tech.id}`);
    const renamed = await a().patch(
      `/v1/users/${tech.id}`,
      { display_name: 'Renamed Tech' },
      ifMatch(user.headers.etag),
    );
    expect(renamed.status, renamed.raw).toBe(200);
    expect((await a().get(`/v1/people/${person[0].id}`)).body.display_name).toBe('Renamed Tech');
    // the other tenant has its own
    expect((await other.admin.get(`/v1/people?q=${tech.email}`)).body.data).toEqual([]);
  });

  it('creates a person without a login: fields, ETag, Location, audit, outbox; never sends mail', async () => {
    const mails = testPorts.mail.sent.length;
    const res = await a().post('/v1/people', {
      kind: 'student',
      display_name: 'Ada Lovelace',
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ADA@Students.Example',
      employee_ref: unique('S'),
      department: 'Year 5',
      job_title: null,
      phone: '+47 555 0100',
    });
    expect(res.status, res.raw).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'student',
      email: 'ada@students.example',
      status: 'active',
      user_id: null,
      assets_held: 0,
    });
    expect(res.headers.etag).toBe('W/"1"');
    expect(res.headers.location).toBe(`/v1/people/${res.body.id}`);
    expect(testPorts.mail.sent.length).toBe(mails); // persons never receive login emails
    const audit = await auditRows(
      t.tenantId,
      `entity_type = 'person' and entity_id = '${res.body.id}'`,
    );
    expect(audit.map((r) => r.action)).toEqual(['person.created']);
    expect((await outboxRows(t.tenantId, `aggregate_id = '${res.body.id}'`))[0]!.event_type).toBe(
      'person.created',
    );
    expect((await a().post('/v1/people', { display_name: '' })).status).toBe(422);
    expect(
      (await a().post('/v1/people', { display_name: 'X', email: 'not-an-email' })).status,
    ).toBe(422);
    expect((await a().post('/v1/people', { display_name: 'X', kind: 'alien' })).status).toBe(422);
    expect(
      (await a().post('/v1/people', { display_name: 'X', location_id: crypto.randomUUID() }))
        .status,
    ).toBe(422);
  });

  it('email and employee number are unique per tenant among live people; archiving frees them', async () => {
    const email = `${unique('dup')}@example.test`;
    const ref = unique('EMP');
    const first = await newPerson(a(), { email, employee_ref: ref });
    const sameEmail = await a().post('/v1/people', {
      display_name: 'Other',
      email: email.toUpperCase(),
    });
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.errors[0]).toMatchObject({ pointer: '/email', code: 'duplicate' });
    const sameRef = await a().post('/v1/people', { display_name: 'Other', employee_ref: ref });
    expect(sameRef.status).toBe(409);
    expect(sameRef.body.errors[0]).toMatchObject({ pointer: '/employee_ref' });
    // an update to somebody else's email conflicts too, but keeping your own is fine
    const second = await newPerson(a(), { email: `${unique('two')}@example.test` });
    const secondEtag = (await a().get(`/v1/people/${second.id}`)).headers.etag;
    expect(
      (await a().patch(`/v1/people/${second.id}`, { email }, ifMatch(secondEtag))).status,
    ).toBe(409);
    expect(
      (await a().patch(`/v1/people/${first.id}`, { email, notes: 'n' }, ifMatch('*'))).status,
    ).toBe(200);
    // the other tenant may use the same values
    expect(
      (await other.admin.post('/v1/people', { display_name: 'Same', email, employee_ref: ref }))
        .status,
    ).toBe(201);
    // archive frees them
    expect((await a().del(`/v1/people/${first.id}`, undefined, ifMatch('*'))).status).toBe(204);
    expect(
      (await a().post('/v1/people', { display_name: 'Reuse', email, employee_ref: ref })).status,
    ).toBe(201);
  });

  it('lists, searches, filters and pages people', async () => {
    const marker = unique('Qx');
    const loc = await newLocation(a());
    for (let i = 0; i < 5; i++) {
      await newPerson(a(), {
        display_name: `${marker} Person ${i}`,
        email: `${marker}.${i}@lists.example`.toLowerCase(),
        kind: i % 2 === 0 ? 'student' : 'contractor',
        department: i < 2 ? 'Maths' : 'Art',
        location_id: loc.id,
        employee_ref: `${marker}-${i}`,
      });
    }
    const q = (s: string) => a().get(`/v1/people?${s}`);
    expect((await q(`q=${marker}`)).body.data).toHaveLength(5);
    expect((await q(`q=${marker.toUpperCase()}`)).body.data).toHaveLength(5); // case-insensitive
    expect((await q(`q=${marker}.3@LISTS`)).body.data).toHaveLength(1); // by email
    expect((await q(`q=${marker}-4`)).body.data).toHaveLength(1); // by employee number
    expect((await q(`q=${marker}&kind=student`)).body.data).toHaveLength(3);
    expect((await q(`q=${marker}&kind=student,contractor`)).body.data).toHaveLength(5);
    expect((await q(`q=${marker}&department=Maths`)).body.data).toHaveLength(2);
    expect((await q(`location_id=${loc.id}&include_total=true`)).body.page.total).toBe(5);
    expect((await q(`employee_ref=${marker}-2`)).body.data).toHaveLength(1);
    expect((await q(`q=${marker}&has_login=false`)).body.data).toHaveLength(5);
    expect((await q(`q=${marker}&has_login=true`)).body.data).toHaveLength(0);
    expect((await q(`q=${marker}&status=inactive`)).body.data).toHaveLength(0);
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Resp = await q(
        `q=${marker}&limit=2&sort=-display_name${cursor ? `&cursor=${cursor}` : ''}`,
      );
      names.push(...page.body.data.map((p: { display_name: string }) => p.display_name));
      cursor = page.body.page.next_cursor;
    } while (cursor);
    expect(names).toEqual([...names].sort().reverse());
    expect(names).toHaveLength(5);
    expect((await q('kind=alien')).status).toBe(400);
    expect((await q('sort=salary')).status).toBe(400);
    // the search endpoint finds people and locations too, filtered by permission
    const search = await a().get(`/v1/search?q=${marker}&types=person,location`);
    expect(search.body.data.filter((r: { type: string }) => r.type === 'person')).toHaveLength(5);
    const loc2 = await newLocation(a(), { name: `${marker} Hall`, code: `${marker}-H` });
    const found = await a().get(`/v1/search?q=${marker}%20hall&types=location`);
    expect(found.body.data[0]).toMatchObject({ type: 'location', id: loc2.id });
    const noPersons = await other.admin.get(`/v1/search?q=${marker}&types=person`);
    expect(noPersons.body.data).toEqual([]);
  });

  it('a person created before the login account is linked to it by email (no second person)', async () => {
    const email = `${unique('later')}@link.example`;
    const early = await newPerson(a(), {
      display_name: 'Early Bird',
      email,
      employee_ref: unique('L'),
    });
    expect(early.body.user_id).toBeNull();
    const before = (await a().get('/v1/people?limit=200')).body.data.length;
    const user = await createUser(app, t, 'viewer', 'later');
    // createUser builds its own address; invite the matching one explicitly
    const invited = await a().post('/v1/users', {
      email,
      display_name: 'Early Bird Login',
      role_assignments: [{ role_id: t.roles.viewer }],
    });
    expect(invited.status, invited.raw).toBe(201);
    const linked = await a().get(`/v1/people/${early.id}`);
    expect(linked.body.user_id).toBe(invited.body.id);
    expect(linked.body.display_name).toBe('Early Bird'); // the person keeps its own data
    const after = (await a().get('/v1/people?limit=200')).body.data.length;
    expect(after).toBe(before + 1); // only `user` (createUser) added a person
    expect(user.id).toBeTruthy();
  });

  it('deactivating a person who holds assets is refused unless forced with a reason; inactive people get nothing', async () => {
    const person = await newPerson(a());
    const asset = await newAsset(a(), b.categoryId);
    const out = await a().post(
      `/v1/assets/${asset.id}/checkout`,
      { person_id: person.id },
      keyed(),
    );
    expect(out.status, out.raw).toBe(201);
    const etag = () =>
      a()
        .get(`/v1/people/${person.id}`)
        .then((r) => String(r.headers.etag));
    expect((await a().get(`/v1/people/${person.id}`)).body.assets_held).toBe(1);

    const refused = await a().patch(
      `/v1/people/${person.id}`,
      { status: 'inactive' },
      ifMatch(await etag()),
    );
    expect(refused.status).toBe(409);
    expect(refused.body.usage).toEqual({ open_assignments: 1 });
    const noReason = await a().patch(
      `/v1/people/${person.id}`,
      { status: 'inactive', force: true },
      ifMatch(await etag()),
    );
    expect(noReason.status).toBe(422);
    expect(noReason.body.errors[0]).toMatchObject({ pointer: '/reason' });
    const forced = await a().patch(
      `/v1/people/${person.id}`,
      { status: 'inactive', force: true, reason: 'left the school, equipment on its way back' },
      ifMatch(await etag()),
    );
    expect(forced.status, forced.raw).toBe(200);
    expect(forced.body.status).toBe('inactive');
    expect(forced.body).not.toHaveProperty('force');
    const audit = await auditRows(
      t.tenantId,
      `entity_type = 'person' and entity_id = '${person.id}' and action = 'person.updated'`,
    );
    expect(audit.at(-1)!.diff?.meta).toMatchObject({
      forced_deactivation: true,
      reason: 'left the school, equipment on its way back',
      open_assignments: 1,
    });
    // the custody stays open; an inactive person cannot receive more
    expect((await a().get(`/v1/assets/${asset.id}`)).body.current_assignment).toMatchObject({
      target_id: person.id,
    });
    const second = await newAsset(a(), b.categoryId);
    const denied = await a().post(
      `/v1/assets/${second.id}/checkout`,
      { person_id: person.id },
      keyed(),
    );
    expect(denied.status).toBe(422);
    expect(denied.body.errors[0]).toMatchObject({ pointer: '/person_id', code: 'inactive' });
    // a person without custody deactivates freely, and can be reactivated
    const idle = await newPerson(a());
    const idleOff = await a().patch(`/v1/people/${idle.id}`, { status: 'inactive' }, ifMatch('*'));
    expect(idleOff.status).toBe(200);
    expect(
      (await a().patch(`/v1/people/${idle.id}`, { status: 'active' }, ifMatch('*'))).body.status,
    ).toBe('active');
  });

  it('archiving: refused while the person holds assets or has a login account; ETag rules apply', async () => {
    const person = await newPerson(a());
    const asset = await newAsset(a(), b.categoryId);
    await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed());
    const blocked = await a().del(`/v1/people/${person.id}`, undefined, ifMatch('*'));
    expect(blocked.status).toBe(409);
    expect(blocked.body.usage).toMatchObject({ open_assignments: 1 });
    expect((await a().del(`/v1/people/${person.id}`)).status).toBe(428);
    await a().post(`/v1/assets/${asset.id}/checkin`, {}, keyed());
    expect((await a().del(`/v1/people/${person.id}`, undefined, ifMatch('W/"99"'))).status).toBe(
      412,
    );
    expect((await a().del(`/v1/people/${person.id}`, undefined, ifMatch('*'))).status).toBe(204);
    expect((await a().get(`/v1/people/${person.id}`)).body.archived_at).toBeTruthy();
    expect((await a().get(`/v1/people?q=${person.body.display_name}`)).body.data).toEqual([]);
    expect((await a().patch(`/v1/people/${person.id}`, { notes: 'x' }, ifMatch('*'))).status).toBe(
      404,
    );
    // the login person cannot be archived
    const me = (await a().get(`/v1/people?q=${t.adminEmail}`)).body.data[0];
    const own = await a().del(`/v1/people/${me.id}`, undefined, ifMatch('*'));
    expect(own.status).toBe(409);
    expect(own.body.usage).toMatchObject({ login_accounts: 1 });
  });

  it('shows what a person holds (open / closed / all) with the asset tag, and their custody history', async () => {
    const person = await newPerson(a());
    const x = await newAsset(a(), b.categoryId, { name: 'Laptop X' });
    const y = await newAsset(a(), b.categoryId);
    await a().post(
      `/v1/assets/${x.id}/checkout`,
      {
        person_id: person.id,
        expected_return: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
      },
      keyed(),
    );
    await a().post(`/v1/assets/${y.id}/checkout`, { person_id: person.id }, keyed());
    await a().post(`/v1/assets/${y.id}/checkin`, { note: 'screen cracked' }, keyed());
    const open = await a().get(`/v1/people/${person.id}/assignments`);
    expect(open.body.data).toHaveLength(1);
    expect(open.body.data[0]).toMatchObject({
      asset_id: x.id,
      asset_name: 'Laptop X',
      person_id: person.id,
      quantity_returned: 0,
      overdue: false,
    });
    expect(open.body.data[0].asset_tag).toBe(x.body.asset_tag);
    expect(
      (await a().get(`/v1/people/${person.id}/assignments?state=closed`)).body.data,
    ).toHaveLength(1);
    const all = await a().get(`/v1/people/${person.id}/assignments?state=all&limit=1`);
    expect(all.body.data).toHaveLength(1);
    expect(all.body.page.has_more).toBe(true);
    const next = await a().get(
      `/v1/people/${person.id}/assignments?state=all&limit=1&cursor=${all.body.page.next_cursor}`,
    );
    expect(next.body.data[0].id).not.toBe(all.body.data[0].id);
    expect(
      (
        await a().get(
          `/v1/people/${person.id}/assignments?state=open&cursor=${all.body.page.next_cursor}`,
        )
      ).body.code,
    ).toBe('invalid-cursor');
    expect((await a().get(`/v1/people/${person.id}/assignments?state=weird`)).status).toBe(400);
    const history = await a().get(`/v1/people/${person.id}/history`);
    expect(history.body.data.map((h: { event_type: string }) => h.event_type)).toEqual([
      'checked_in',
      'checked_out',
      'checked_out',
    ]);
    expect(history.body.data[0]).toMatchObject({ asset_id: y.id, asset_tag: y.body.asset_tag });
    expect((await a().get(`/v1/people/${crypto.randomUUID()}/history`)).status).toBe(404);
    expect(
      (await a().get(`/v1/assets?assigned_person_id=${person.id}`)).body.data.map(
        (r: { id: string }) => r.id,
      ),
    ).toEqual([x.id]);
    expect((await other.admin.get(`/v1/people/${person.id}/assignments`)).status).toBe(404);
  });

  it('only person:manage writes; viewers read', async () => {
    const viewer = await createUser(app, t, 'viewer');
    const tech = await createUser(app, t, 'technician');
    expect((await viewer.client.get('/v1/people')).status).toBe(200);
    for (const c of [viewer.client, tech.client]) {
      expect((await c.post('/v1/people', { display_name: unique('X') })).status).toBe(403);
    }
  });
});
