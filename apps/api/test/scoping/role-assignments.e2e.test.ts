import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type ImportHarness,
  type TenantFixture,
  createTenant,
  ifMatch,
  newTenancy,
  ownerTenantSql,
  startImportApp,
  unique,
} from '../importer/support.js';
import { createScopedUser, createUserWith } from './support.js';

/**
 * M2-USR-04 (ED-27): role assignments are added and removed one at a time
 * (`POST /v1/users/{id}/role-assignments`, `DELETE /v1/users/{id}/role-assignments/{assignment_id}`).
 * The rules of ED-26 hold: nobody grants wider than they hold, a location-scoped grant never gives the
 * org-only permissions; and every change revokes the target's sessions and is audited.
 */
describe.skipIf(!dbEnabled)(`add and remove role assignments (${mode})`, () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let t: TenantFixture;
  const admin = () => t.admin;
  const marker = unique('ra').replace(/-/g, '');
  let siteIn: string;
  let roomIn: string;
  let siteOut: string;

  beforeAll(async () => {
    ih = await startImportApp();
    t = await createTenant(ih.h.app, tenancy, 'roleassign');
    siteIn = (await admin().post('/v1/locations', { name: `${marker} In`, kind: 'site' })).body.id;
    roomIn = (
      await admin().post('/v1/locations', {
        name: `${marker} Room`,
        kind: 'room',
        parent_id: siteIn,
      })
    ).body.id;
    siteOut = (await admin().post('/v1/locations', { name: `${marker} Out`, kind: 'site' })).body
      .id;
  });
  afterAll(async () => {
    await ih.h.close();
    await tenancy.onModuleDestroy();
  });

  /** The user with its current ETag. */
  const load = async (client: TenantFixture['admin'], id: string) => {
    const res = await client.get(`/v1/users/${id}`);
    expect(res.status).toBe(200);
    return { user: res.body, etag: res.headers.etag as string };
  };
  const add = async (
    client: TenantFixture['admin'],
    id: string,
    body: Record<string, unknown>,
    etag?: string,
  ) =>
    client.post(
      `/v1/users/${id}/role-assignments`,
      body,
      ifMatch(etag ?? (await load(client, id)).etag),
    );
  const remove = async (
    client: TenantFixture['admin'],
    id: string,
    assignmentId: string,
    etag?: string,
  ) =>
    client.del(
      `/v1/users/${id}/role-assignments/${assignmentId}`,
      undefined,
      ifMatch(etag ?? (await load(client, id)).etag),
    );
  /** The audit rows of an action on a user, oldest first; `meta` is what the entry recorded besides the diff. */
  const auditOf = async (action: string, entityId: string) =>
    (
      await ownerTenantSql(
        t.tenantId,
        `select action, actor_type, actor_user_id, diff from app.audit_log
          where entity_id = $1::uuid and action = $2 order by at, id`,
        [entityId, action],
      )
    ).rows.map((r) => ({ ...r, meta: r.diff?.meta }));
  const newViewer = (label: string) =>
    createUserWith(ih.h.app, t, [{ role_id: t.roles.viewer! }], label);

  it('adds a limited assignment and removes it again; the response carries the user and a new ETag', async () => {
    const u = await newViewer('addrm');
    const before = await load(admin(), u.id);
    expect(before.user.role_assignments).toHaveLength(1);

    const added = await add(admin(), u.id, {
      role_id: t.roles.technician,
      scope_type: 'location',
      location_id: siteIn,
    });
    expect(added.status).toBe(201);
    expect(added.headers.etag).not.toBe(before.etag);
    expect(added.body.id).toBe(u.id);
    expect(added.body.role_assignments).toHaveLength(2);
    const limited = added.body.role_assignments.find(
      (a: { scope_type: string }) => a.scope_type === 'location',
    );
    expect(limited).toMatchObject({
      role_id: t.roles.technician,
      scope_type: 'location',
      location_id: siteIn,
    });
    expect(typeof limited.id).toBe('string');
    // the stored state is what the response says
    expect((await load(admin(), u.id)).user.role_assignments).toHaveLength(2);
    const audited = await auditOf('user.role_assigned', u.id);
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      actor_type: 'user',
      actor_user_id: expect.any(String),
      meta: {
        assignment_id: limited.id,
        role_id: t.roles.technician,
        scope_type: 'location',
        scope_location_id: siteIn,
      },
    });

    const removed = await remove(admin(), u.id, limited.id, added.headers.etag as string);
    expect(removed.status).toBe(200);
    expect(removed.headers.etag).not.toBe(added.headers.etag);
    expect(removed.body.role_assignments).toHaveLength(1);
    expect(removed.body.role_assignments[0].role_id).toBe(t.roles.viewer);
    expect(await auditOf('user.role_removed', u.id)).toHaveLength(1);
    expect((await auditOf('user.role_removed', u.id))[0]!.meta).toMatchObject({
      assignment_id: limited.id,
      scope_type: 'location',
      scope_location_id: siteIn,
    });
  });

  it('an org-wide assignment can be added too; the new assignment works for its holder', async () => {
    const u = await createScopedUser(ih.h.app, t, 'viewer', [siteIn], 'wide');
    const added = await add(admin(), u.id, { role_id: t.roles.technician });
    expect(added.status).toBe(201);
    expect(
      added.body.role_assignments.map((a: { scope_type: string }) => a.scope_type).sort(),
    ).toEqual(['location', 'tenant']);
  });

  it('needs If-Match: 428 without, 412 with a stale one; nothing changes', async () => {
    const u = await newViewer('etag');
    const { etag } = await load(admin(), u.id);
    const none = await admin().post(`/v1/users/${u.id}/role-assignments`, {
      role_id: t.roles.technician,
    });
    expect(none.status).toBe(428);
    const first = await add(admin(), u.id, { role_id: t.roles.technician }, etag);
    expect(first.status).toBe(201);
    const stale = await add(admin(), u.id, { role_id: t.roles.auditor }, etag);
    expect(stale.status).toBe(412);
    const noneDel = await admin().del(
      `/v1/users/${u.id}/role-assignments/${first.body.role_assignments[0].id}`,
    );
    expect(noneDel.status).toBe(428);
    const staleDel = await remove(admin(), u.id, first.body.role_assignments[0].id, etag);
    expect(staleDel.status).toBe(412);
    expect((await load(admin(), u.id)).user.role_assignments).toHaveLength(2);
  });

  it('refuses a bad assignment at the field, and the same assignment twice', async () => {
    const u = await newViewer('bad');
    const noLocation = await add(admin(), u.id, {
      role_id: t.roles.technician,
      scope_type: 'location',
    });
    expect(noLocation.status).toBe(422);
    expect(noLocation.body.errors[0]).toMatchObject({ pointer: '/location_id', code: 'invalid' });
    const unknownLocation = await add(admin(), u.id, {
      role_id: t.roles.technician,
      scope_type: 'location',
      location_id: randomUUID(),
    });
    expect(unknownLocation.status).toBe(422);
    expect(unknownLocation.body.errors[0]).toMatchObject({
      pointer: '/location_id',
      code: 'not-found',
    });
    const unknownRole = await add(admin(), u.id, { role_id: randomUUID() });
    expect(unknownRole.status).toBe(422);
    expect(unknownRole.body.errors[0]).toMatchObject({ pointer: '/role_id', code: 'not-found' });
    const tenantWithLocation = await add(admin(), u.id, {
      role_id: t.roles.technician,
      scope_type: 'tenant',
      location_id: siteIn,
    });
    expect(tenantWithLocation.status).toBe(422);

    expect((await add(admin(), u.id, { role_id: t.roles.technician })).status).toBe(201);
    const twice = await add(admin(), u.id, { role_id: t.roles.technician });
    expect(twice.status).toBe(409);
    // the same role at a location is another assignment
    const limited = { role_id: t.roles.technician, scope_type: 'location', location_id: roomIn };
    expect((await add(admin(), u.id, limited)).status).toBe(201);
    expect((await add(admin(), u.id, limited)).status).toBe(409);
    expect((await load(admin(), u.id)).user.role_assignments).toHaveLength(3);
  });

  it('unknown or archived users and foreign assignments are 404; a viewer cannot manage users', async () => {
    const u = await newViewer('nf1');
    const other = await newViewer('nf2');
    const otherAssignment = (await load(admin(), other.id)).user.role_assignments[0].id;
    expect((await add(admin(), randomUUID(), { role_id: t.roles.viewer }, 'W/"1"')).status).toBe(
      404,
    );
    const foreign = await remove(admin(), u.id, otherAssignment);
    expect(foreign.status).toBe(404);
    expect((await remove(admin(), u.id, randomUUID())).status).toBe(404);
    // a viewer has no user:manage
    expect((await add(u.client, other.id, { role_id: t.roles.viewer }, 'W/"1"')).status).toBe(403);
    expect((await remove(u.client, other.id, otherAssignment, 'W/"1"')).status).toBe(403);
    // an archived user is gone
    const archived = await newViewer('arch');
    const tag = (await load(admin(), archived.id)).etag;
    expect((await admin().del(`/v1/users/${archived.id}`, undefined, ifMatch(tag))).status).toBe(
      204,
    );
    expect((await add(admin(), archived.id, { role_id: t.roles.technician }, 'W/"1"')).status).toBe(
      404,
    );
  });

  it('revokes the sessions of the target on add and on remove, not the editor’s own', async () => {
    const u = await newViewer('sess1');
    expect((await u.client.get('/v1/auth/me')).status).toBe(200);
    const added = await add(admin(), u.id, { role_id: t.roles.technician });
    expect(added.status).toBe(201);
    expect((await auditOf('user.role_assigned', u.id))[0]!.meta).toMatchObject({
      sessions_revoked: 1,
    });
    expect((await u.client.get('/v1/auth/me')).status).toBe(401);
    expect((await admin().get('/v1/auth/me')).status).toBe(200);

    const v = await newViewer('sess2');
    const withTwo = await add(admin(), v.id, { role_id: t.roles.technician });
    expect((await v.client.get('/v1/auth/me')).status).toBe(401);
    const drop = withTwo.body.role_assignments.find(
      (a: { role_id: string }) => a.role_id === t.roles.technician,
    );
    expect((await remove(admin(), v.id, drop.id, withTwo.headers.etag as string)).status).toBe(200);
    expect((await auditOf('user.role_removed', v.id))[0]!.meta).toMatchObject({
      sessions_revoked: 0,
    });
  });

  it('removing an assignment signs the target out', async () => {
    // an administrator and a second one, who is demoted to a viewer by removing the admin assignment
    const second = await createUserWith(
      ih.h.app,
      t,
      [{ role_id: t.roles.tenant_admin! }, { role_id: t.roles.viewer! }],
      'second-admin',
    );
    expect((await second.client.get('/v1/auth/me')).status).toBe(200);
    const adminAssignment = (await load(admin(), second.id)).user.role_assignments.find(
      (a: { role_id: string }) => a.role_id === t.roles.tenant_admin,
    );
    const removed = await remove(admin(), second.id, adminAssignment.id);
    expect(removed.status).toBe(200);
    expect((await auditOf('user.role_removed', second.id))[0]!.meta).toMatchObject({
      sessions_revoked: 1,
    });
    expect((await second.client.get('/v1/auth/me')).status).toBe(401);
  });

  describe('guards', () => {
    it('the only assignment of a user cannot be removed (409): disable or archive instead', async () => {
      const u = await newViewer('only');
      const { user, etag } = await load(admin(), u.id);
      const res = await remove(admin(), u.id, user.role_assignments[0].id, etag);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('conflict');
      const after = await load(admin(), u.id);
      expect(after.user.role_assignments).toHaveLength(1);
      expect(after.etag).toBe(etag);
      expect(await auditOf('user.role_removed', u.id)).toHaveLength(0);
    });

    it('the last active administrator keeps the administrator assignment (409)', async () => {
      // the tenant administrator is the only one: give it a second role, then try to drop the admin one
      const me = await load(admin(), (await admin().get('/v1/auth/me')).body.user.id);
      const adminAssignment = me.user.role_assignments[0];
      const withViewer = await add(admin(), me.user.id, { role_id: t.roles.viewer }, me.etag);
      expect(withViewer.status).toBe(201);
      const res = await remove(
        admin(),
        me.user.id,
        adminAssignment.id,
        withViewer.headers.etag as string,
      );
      expect(res.status).toBe(409);
      expect(res.body.detail).toMatch(/last active administrator/i);
      expect((await load(admin(), me.user.id)).user.role_assignments).toHaveLength(2);
    });

    it('an administrator cannot remove their own last administrator access, even when others exist', async () => {
      const other = await createUserWith(
        ih.h.app,
        t,
        [{ role_id: t.roles.tenant_admin! }, { role_id: t.roles.viewer! }],
        'other-admin',
      );
      // another active administrator exists, so removing it from the first admin is allowed...
      const first = await load(admin(), (await admin().get('/v1/auth/me')).body.user.id);
      const firstAdmin = first.user.role_assignments.find(
        (a: { role_id: string }) => a.role_id === t.roles.tenant_admin,
      );
      // ...but not by the administrator themselves
      const own = await remove(admin(), first.user.id, firstAdmin.id);
      expect(own.status).toBe(409);
      expect(
        (await load(admin(), first.user.id)).user.role_assignments.map(
          (a: { role_id: string }) => a.role_id,
        ),
      ).toContain(t.roles.tenant_admin);
      // the other administrator does it for them, and the second is then the last one
      const byOther = await other.client.get('/v1/auth/me');
      expect(byOther.status).toBe(200);
      const viaOther = await remove(other.client, first.user.id, firstAdmin.id);
      expect(viaOther.status).toBe(200);
      const lastAdminAssignment = (await load(other.client, other.id)).user.role_assignments.find(
        (a: { role_id: string }) => a.role_id === t.roles.tenant_admin,
      );
      const lastOne = await remove(other.client, other.id, lastAdminAssignment.id);
      expect(lastOne.status).toBe(409);
      // restore a second administrator for the tests that follow
      const restore = await add(other.client, first.user.id, { role_id: t.roles.tenant_admin });
      expect(restore.status).toBe(201);
      // the first administrator's sessions were revoked by the changes: sign in again
      expect((await admin().get('/v1/auth/me')).status).toBe(401);
      expect((await admin().login(t.adminEmail, t.adminPassword)).status).toBe(200);
    });

    it('editing yourself keeps your own session', async () => {
      const mgr = await createUserWith(
        ih.h.app,
        t,
        [{ role_id: t.roles.tenant_admin! }],
        'self-edit',
      );
      const added = await add(mgr.client, mgr.id, { role_id: t.roles.viewer });
      expect(added.status).toBe(201);
      expect((await mgr.client.get('/v1/auth/me')).status).toBe(200);
      const viewerAssignment = added.body.role_assignments.find(
        (a: { role_id: string }) => a.role_id === t.roles.viewer,
      );
      const removed = await remove(
        mgr.client,
        mgr.id,
        viewerAssignment.id,
        added.headers.etag as string,
      );
      expect(removed.status).toBe(200);
      expect((await mgr.client.get('/v1/auth/me')).status).toBe(200);
    });
  });

  describe('nobody grants wider than they hold (ED-26), and a scoped grant never gives the org-only permissions', () => {
    async function customRole(key: string, permissions: string[]): Promise<string> {
      const id = randomUUID();
      await ownerTenantSql(
        t.tenantId,
        'insert into app.role (id, tenant_id, key, name, permissions) values ($1, $2, $3, $4, $5)',
        [id, t.tenantId, `${key}_${marker.slice(-6)}`.toLowerCase(), key, permissions],
      );
      return id;
    }

    it('a user manager who is a technician at one site only cannot add the technician role wider', async () => {
      const userAdmin = await customRole('useradmin', ['user:read', 'user:manage', 'role:read']);
      const grantor = await createUserWith(
        ih.h.app,
        t,
        [
          { role_id: userAdmin },
          { role_id: t.roles.technician!, scope_type: 'location', location_id: siteIn },
        ],
        'grantor',
      );
      const target = await newViewer('escalated');
      const grant = (assignment: Record<string, unknown>, id = target.id) =>
        add(grantor.client, id, { role_id: t.roles.technician, ...assignment });
      expect((await grant({ scope_type: 'tenant' })).status).toBe(403);
      expect((await grant({ scope_type: 'location', location_id: siteOut })).status).toBe(403);
      // a role with more than they hold at all
      expect((await add(grantor.client, target.id, { role_id: t.roles.tenant_admin })).status).toBe(
        403,
      );
      // not to themselves either
      expect((await grant({ scope_type: 'tenant' }, grantor.id)).status).toBe(403);
      // inside their own subtree it works, and a sub-location counts
      expect((await grant({ scope_type: 'location', location_id: roomIn })).status).toBe(201);
      expect(
        (await load(admin(), target.id)).user.role_assignments.filter(
          (a: { scope_type: string }) => a.scope_type === 'location',
        ),
      ).toHaveLength(1);
      // they cannot touch a user who holds more than they do
      const adminUser = (await admin().get('/v1/auth/me')).body.user.id;
      const adminAssignments = (await load(admin(), adminUser)).user.role_assignments;
      const attempt = await remove(grantor.client, adminUser, adminAssignments[0].id);
      expect(attempt.status).toBe(403);
    });

    it('a location administrator (Administrator limited to a site) cannot manage users at all', async () => {
      const locAdmin = await createScopedUser(ih.h.app, t, 'tenant_admin', [siteIn], 'locadmin');
      const target = await newViewer('byscoped');
      const { etag, user } = await load(admin(), target.id);
      expect(
        (
          await locAdmin.client.post(
            `/v1/users/${target.id}/role-assignments`,
            { role_id: t.roles.viewer },
            ifMatch(etag),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await locAdmin.client.del(
            `/v1/users/${target.id}/role-assignments/${user.role_assignments[0].id}`,
            undefined,
            ifMatch(etag),
          )
        ).status,
      ).toBe(403);
    });

    it('an Administrator assignment added at a location gives its holder no org-only permission', async () => {
      const u = await newViewer('adminat');
      const added = await add(admin(), u.id, {
        role_id: t.roles.tenant_admin,
        scope_type: 'location',
        location_id: siteIn,
      });
      expect(added.status).toBe(201);
      // the add signed the holder out: they sign in again and hold the limited permissions only
      const client = u.client;
      const login = await client.login(u.email, u.password);
      expect(login.status).toBe(200);
      const me = (await client.get('/v1/auth/me')).body;
      expect(me.permissions).toContain('asset:update');
      expect(me.permissions).not.toContain('user:manage');
      expect(me.permissions).not.toContain('audit:read');
      expect((await client.get('/v1/users?limit=5')).status).toBe(403);
    });
  });
});
