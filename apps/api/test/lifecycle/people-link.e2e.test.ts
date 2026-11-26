import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type App,
  type Basics,
  type Json,
  type TenantFixture,
  auditRows,
  basics,
  contractViolations,
  createTenant,
  createUser,
  key,
  newAsset,
  newPerson,
  newTenancy,
  outboxRows,
  ownerTenantSql,
  startRegistryApp,
  unique,
} from './support.js';

/**
 * M2-USR-03 (ED-22): `POST` / `DELETE /v1/people/{id}/link-user`. A login account always has a
 * person (ED-15); linking REPLACES the system-made placeholder with the chosen person (history of
 * both is kept), unlinking leaves the person without a login and gives the login a new placeholder.
 */
describe.skipIf(!dbEnabled)(`link and unlink a person and a login account (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  let b: Basics;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'plink');
    other = await createTenant(app, tenancy, 'plink2');
    b = await basics(t);
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  /** A login account (invited) and its system-made placeholder person. */
  async function newLogin(
    label = 'Login',
  ): Promise<{ id: string; email: string; personId: string }> {
    const email = `${unique(label).toLowerCase()}@plink.example`;
    const res = await a().post('/v1/users', {
      email,
      display_name: unique(label),
      role_assignments: [{ role_id: t.roles.viewer }],
    });
    expect(res.status, res.raw).toBe(201);
    expect(res.body.person_id).toBeTruthy();
    return { id: res.body.id, email, personId: res.body.person_id };
  }
  const user = async (id: string) => (await a().get(`/v1/users/${id}`)).body as Json;
  const person = async (id: string) => (await a().get(`/v1/people/${id}`)).body as Json;
  const link = (personId: string, userId: string, ifMatch?: string) =>
    a().post(
      `/v1/people/${personId}/link-user`,
      { user_id: userId },
      ifMatch ? { headers: { 'if-match': ifMatch } } : undefined,
    );

  it('links a person that has history to a login, replacing the placeholder; both histories stay', async () => {
    const login = await newLogin();
    const pupil = await newPerson(a(), { display_name: unique('Pupil'), kind: 'student' });
    const asset = await newAsset(a(), b.categoryId);
    expect(
      (await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: pupil.id }, key())).status,
    ).toBe(201);

    const res = await link(pupil.id, login.id);
    expect(res.status, res.raw).toBe(200);
    expect(res.body).toMatchObject({ id: pupil.id, user_id: login.id, assets_held: 1 });
    expect(res.headers.etag).toBeTruthy();

    // the login now points at the chosen person; the placeholder is archived and detached
    expect((await user(login.id)).person_id).toBe(pupil.id);
    expect(await person(login.personId)).toMatchObject({ user_id: null });
    expect((await person(login.personId)).archived_at).toBeTruthy();
    // the pupil still holds the laptop (custody and history untouched)
    const held = await a().get(`/v1/people/${pupil.id}/assignments`);
    expect(held.body.data).toHaveLength(1);
    expect(held.body.data[0].asset_id).toBe(asset.id);
    // has_login filter and the people list see it
    const logins = await a().get(
      `/v1/people?q=${encodeURIComponent(pupil.body.display_name)}&has_login=true`,
    );
    expect(logins.body.data.map((p: Json) => p.id)).toEqual([pupil.id]);

    // audit and outbox, in the same change
    const audit = (
      await auditRows(t.tenantId, `action = 'person.user_linked' and entity_id = '${pupil.id}'`)
    )[0]!;
    expect(audit.diff).toMatchObject({ after: { user_id: login.id } });
    expect(audit.diff?.meta).toMatchObject({
      user_id: login.id,
      replaced_person_id: login.personId,
    });
    expect(
      await outboxRows(
        t.tenantId,
        `event_type = 'person.user_linked' and aggregate_id = '${pupil.id}'`,
      ),
    ).toHaveLength(1);
  });

  it('linking the pair that is already linked is a no-op (200, no second audit row)', async () => {
    const login = await newLogin();
    const p = await newPerson(a());
    expect((await link(p.id, login.id)).status).toBe(200);
    const again = await link(p.id, login.id);
    expect(again.status, again.raw).toBe(200);
    expect(
      await auditRows(t.tenantId, `action = 'person.user_linked' and entity_id = '${p.id}'`),
    ).toHaveLength(1);
  });

  it('refuses with 409 when the person has a login, when the login has a chosen person, and while the placeholder holds assets', async () => {
    const first = await newLogin();
    const second = await newLogin();
    const p = await newPerson(a());
    expect((await link(p.id, first.id)).status).toBe(200);

    // one login per person
    const taken = await link(p.id, second.id);
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('person-already-linked');

    // one person per login: `first` now has a chosen person (p), another person cannot replace it
    const q = await newPerson(a());
    const clash = await link(q.id, first.id);
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('login-already-linked');

    // a placeholder that holds an asset is not replaced silently
    const holder = await newLogin();
    const asset = await newAsset(a(), b.categoryId);
    await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: holder.personId }, key());
    const busy = await link(q.id, holder.id);
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('login-person-in-use');
    expect(busy.body.usage).toEqual({ open_assignments: 1 });
    // nothing changed
    expect((await user(holder.id)).person_id).toBe(holder.personId);
    expect((await person(q.id)).user_id).toBeNull();
    // after the asset is back, it works
    await a().post(`/v1/assets/${asset.id}/checkin`, {}, key());
    expect((await link(q.id, holder.id)).status).toBe(200);
  });

  it('validates the account (422 on /user_id) and the person (404, archived)', async () => {
    const p = await newPerson(a());
    const unknown = await link(p.id, '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d99');
    expect(unknown.status).toBe(422);
    expect(unknown.body.errors[0].pointer).toBe('/user_id');
    // an account of another tenant does not exist here
    const foreign = await link(p.id, (await other.admin.get('/v1/auth/me')).body.user.id);
    expect(foreign.status).toBe(422);
    // an archived account
    const gone = await newLogin();
    expect(
      (
        await a().del(`/v1/users/${gone.id}`, undefined, {
          headers: { 'if-match': (await a().get(`/v1/users/${gone.id}`)).headers.etag as string },
        })
      ).status,
    ).toBe(204);
    const archived = await link(p.id, gone.id);
    expect(archived.status).toBe(422);
    // missing / archived person, bad body
    expect((await link('0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d98', (await newLogin()).id)).status).toBe(
      404,
    );
    expect((await a().post(`/v1/people/${p.id}/link-user`, {})).status).toBe(422);
    expect((await a().post(`/v1/people/${p.id}/link-user`, { user_id: 'x' })).status).toBe(422);
  });

  it('honours If-Match when it is sent', async () => {
    const login = await newLogin();
    const p = await newPerson(a());
    const stale = await link(p.id, login.id, 'W/"99"');
    expect(stale.status).toBe(412);
    const etag = (await a().get(`/v1/people/${p.id}`)).headers.etag as string;
    expect((await link(p.id, login.id, etag)).status).toBe(200);
  });

  it('unlinks: the person keeps everything, the login gets a fresh placeholder; a second unlink is 409', async () => {
    const login = await newLogin('Unlink');
    const p = await newPerson(a());
    const asset = await newAsset(a(), b.categoryId);
    expect((await link(p.id, login.id)).status).toBe(200);
    // the person takes over the account's email (the placeholder that had it is archived)
    const etag0 = (await a().get(`/v1/people/${p.id}`)).headers.etag as string;
    expect(
      (
        await a().patch(
          `/v1/people/${p.id}`,
          { email: login.email },
          { headers: { 'if-match': etag0 } },
        )
      ).status,
    ).toBe(200);
    await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: p.id }, key());

    const res = await a().del(`/v1/people/${p.id}/link-user`);
    expect(res.status, res.raw).toBe(200);
    expect(res.body).toMatchObject({ id: p.id, user_id: null, assets_held: 1 });
    expect(res.headers.etag).toBeTruthy();

    // the login is not left without a person: a new placeholder, with the account's name (the email
    // stays with the person that has it)
    const now = await user(login.id);
    expect(now.person_id).toBeTruthy();
    expect(now.person_id).not.toBe(p.id);
    expect(now.person_id).not.toBe(login.personId);
    const placeholder = await person(now.person_id);
    expect(placeholder).toMatchObject({
      user_id: login.id,
      email: null,
      kind: 'employee',
      is_login_placeholder: true,
    });
    // the unlinked person is a person of its own now, not a placeholder
    expect(res.body.is_login_placeholder).toBe(false);
    expect(placeholder.archived_at).toBeNull();
    // and it can be replaced again (it is system-made)
    const q = await newPerson(a());
    expect((await link(q.id, login.id)).status).toBe(200);

    const again = await a().del(`/v1/people/${p.id}/link-user`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('conflict');
    const audit = (
      await auditRows(t.tenantId, `action = 'person.user_unlinked' and entity_id = '${p.id}'`)
    )[0]!;
    expect(audit.diff?.meta).toMatchObject({ user_id: login.id, new_person_id: now.person_id });
  });

  it("refuses to unlink the login's own automatic record (409, ED-33): nothing changes, linking still replaces it", async () => {
    const login = await newLogin('Auto');
    const auto = await person(login.personId);
    expect(auto).toMatchObject({ user_id: login.id, is_login_placeholder: true });

    const res = await a().del(`/v1/people/${login.personId}/link-user`);
    expect(res.status, res.raw).toBe(409);
    expect(res.body.code).toBe('conflict');
    expect(res.body.detail).toBe(
      `This is the automatic record of the login ${login.email}; there is nothing to unlink. To attach the login to a real person, open that person and use Link to a login.`,
    );
    // nothing changed: same person, still the login's, no new record, no audit row
    expect((await user(login.id)).person_id).toBe(login.personId);
    expect(await person(login.personId)).toMatchObject({ user_id: login.id, archived_at: null });
    expect(
      await auditRows(
        t.tenantId,
        `action = 'person.user_unlinked' and entity_id = '${login.personId}'`,
      ),
    ).toHaveLength(0);
    // a person without a login is not a placeholder
    const p = await newPerson(a());
    expect((await person(p.id)).is_login_placeholder).toBe(false);
    // and linking a real person still replaces the automatic record
    expect((await link(p.id, login.id)).status).toBe(200);
    expect(await person(p.id)).toMatchObject({ user_id: login.id, is_login_placeholder: false });
    expect((await person(login.personId)).archived_at).not.toBeNull();
  });

  it('a person with a login cannot be archived until it is unlinked; a department manager follows the link', async () => {
    const login = await newLogin();
    const p = await newPerson(a());
    // the department is headed by the login's placeholder person
    const dept = await a().post('/v1/departments', {
      name: unique('Dept'),
      manager_person_id: login.personId,
    });
    expect(dept.status, dept.raw).toBe(201);
    expect((await link(p.id, login.id)).status).toBe(200);
    expect((await a().get(`/v1/departments/${dept.body.id}`)).body.manager_person_id).toBe(p.id);

    const etag = () =>
      a()
        .get(`/v1/people/${p.id}`)
        .then((r) => r.headers.etag as string);
    const blocked = await a().del(`/v1/people/${p.id}`, undefined, {
      headers: { 'if-match': await etag() },
    });
    expect(blocked.status).toBe(409);
    expect((await a().del(`/v1/people/${p.id}/link-user`)).status).toBe(200);
    expect(
      (await a().del(`/v1/people/${p.id}`, undefined, { headers: { 'if-match': await etag() } }))
        .status,
    ).toBe(204);
  });

  it('is Administrators only (user:manage) and tenant-scoped', async () => {
    const login = await newLogin();
    const p = await newPerson(a());
    for (const roleKey of ['asset_manager', 'technician', 'auditor', 'viewer']) {
      const who = await createUser(app, t, roleKey);
      const res = await who.client.post(`/v1/people/${p.id}/link-user`, { user_id: login.id });
      expect(res.status, roleKey).toBe(403);
      expect((await who.client.del(`/v1/people/${p.id}/link-user`)).status, roleKey).toBe(403);
    }
    // another tenant's admin cannot see this person
    const foreign = await other.admin.post(`/v1/people/${p.id}/link-user`, { user_id: login.id });
    expect(foreign.status).toBe(404);
    expect((await other.admin.del(`/v1/people/${p.id}/link-user`)).status).toBe(404);
    const row = await ownerTenantSql(t.tenantId, 'select user_id from app.person where id = $1', [
      p.id,
    ]);
    expect(row.rows[0].user_id).toBeNull();
  });

  it('the users list and /v1/auth/me carry person_id', async () => {
    const login = await newLogin();
    const list = await a().get(`/v1/users?q=${encodeURIComponent(login.email)}`);
    expect(list.body.data[0].person_id).toBe(login.personId);
    const me = await a().get('/v1/auth/me');
    expect(me.body.user.person_id).toBeTruthy();
    const mine = await a().get(`/v1/people?q=${t.adminEmail}&has_login=true`);
    expect(mine.body.data[0].id).toBe(me.body.user.person_id);
  });
});
