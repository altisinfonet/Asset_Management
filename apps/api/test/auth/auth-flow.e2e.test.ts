import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/auth/auth.service.js';
import { BUILTIN_ROLES } from '../../src/auth/permissions.js';
import {
  Client,
  codeAt,
  COOKIE,
  createTenant,
  createUser,
  dbEnabled,
  enrolMfa,
  env,
  freshIp,
  mailsTo,
  newPassword,
  newTenancy,
  startApp,
  testPorts,
  withClient,
  type TenantFixture,
} from './support.js';

/**
 * M1-AUTH-01..07 happy paths and contract shapes against the real stack (real PostgreSQL, direct or
 * through PgBouncer): bootstrap -> invitation -> login -> me -> MFA -> sessions -> reset -> users.
 */
describe.skipIf(!dbEnabled)('auth flows', () => {
  const tenancy = newTenancy();
  let app: NestFastifyApplication;
  let T: TenantFixture;

  beforeAll(async () => {
    ({ app } = await startApp());
    T = await createTenant(app, tenancy, 'Flow');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
  });

  it('serves the public password policy', async () => {
    const res = await new Client(app).get('/v1/auth/password-policy');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      min_length: 12,
      max_length: 128,
      composition_rules: false,
      breached_check: { enabled: true, sources: ['local_list'] },
      rejection_codes: ['too-short', 'too-long', 'breached'],
    });
  });

  describe('invitation and login', () => {
    it('shows the invitation, accepts it once, and signs the user in', async () => {
      const email = `inv-${Date.now()}@${T.slug}.example`;
      const before = testPorts.mail.sent.length;
      const created = await T.admin.post('/v1/users', {
        email,
        display_name: 'Invitee',
        role_assignments: [{ role_id: T.roles.technician }],
      });
      expect(created.status).toBe(201);
      expect(created.headers.etag).toBe('W/"1"');
      expect(created.headers.location).toBe(`/v1/users/${created.body.id}`);
      expect(created.body).toMatchObject({ status: 'invited', email, mfa_enabled: false });

      const mail = testPorts.mail.sent.slice(before).find((m) => m.to === email)!;
      expect(mail.template).toBe('auth.invitation');
      const token = mail.data.token as string;
      expect(mail.data.link).toBe(`http://web.test/invitation?token=${encodeURIComponent(token)}`);

      const anon = new Client(app);
      const info = await anon.get(`/v1/auth/invitations/${token}`);
      expect(info.status).toBe(200);
      expect(info.body).toMatchObject({
        email,
        display_name: 'Invitee',
        tenant_name: T.name,
        role_name: 'Technician',
        mfa_enrolment_required: false,
      });
      expect(info.headers['cache-control']).toBe('no-store');

      const weak = await anon.post('/v1/auth/invitations/accept', {
        token,
        password: 'short',
        display_name: 'Invitee',
      });
      expect(weak.status).toBe(422);
      expect(weak.body.code).toBe('validation');
      expect(weak.body.errors[0]).toMatchObject({ pointer: '/password', code: 'too-short' });

      const accept = await anon.post('/v1/auth/invitations/accept', {
        token,
        password: newPassword(),
        display_name: 'Invitee Renamed',
      });
      expect(accept.status).toBe(200);
      expect(accept.body.status).toBe('authenticated');
      expect(accept.body.csrf_token).toBeTruthy();
      expect(accept.body.user).toMatchObject({
        email,
        display_name: 'Invitee Renamed',
        status: 'active',
      });
      expect(accept.headers['set-cookie']).toContain(`${COOKIE}=`);

      // The token is spent: the same link is now a 404, and so is the accept.
      expect((await anon.get(`/v1/auth/invitations/${token}`)).status).toBe(404);
      const replay = await new Client(app).post('/v1/auth/invitations/accept', {
        token,
        password: newPassword(),
        display_name: 'X',
      });
      expect(replay.status).toBe(404);
      expect(replay.body.code).toBe('invitation-not-found');
    });

    it('logs in, serves /me with the documented shape, and logs out', async () => {
      const u = await createUser(app, T, 'asset_manager');
      const c = new Client(app);
      const login = await c.login(u.email, u.password);
      expect(login.status).toBe(200);
      expect(login.body).toMatchObject({ status: 'authenticated', user: { email: u.email } });
      const setCookie = String(login.headers['set-cookie']);
      expect(setCookie).toMatch(/^__Host-at_session=[A-Za-z0-9_-]{40,}/);
      expect(setCookie).toMatch(/HttpOnly/);
      expect(setCookie).toMatch(/Secure/);
      expect(setCookie).toMatch(/SameSite=Lax/);
      expect(setCookie).toMatch(/Path=\//);
      expect(setCookie).not.toMatch(/Domain=/i);

      const me = await c.get('/v1/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe(u.email);
      expect(me.body.tenant).toMatchObject({
        id: T.tenantId,
        branding: { logo_url: null, accent_color: null },
      });
      expect(me.body.default_company_id).toBeTruthy();
      expect(me.body.auth).toMatchObject({
        method: 'session',
        mfa_verified: false,
        api_key_id: null,
      });
      expect(me.body.mfa_enrolment_required).toBe(false);
      expect(me.body.csrf_token).toBe(login.body.csrf_token);
      expect(me.body.permissions).toContain('search:read');
      expect(me.body.permissions).toContain('user:read');
      expect(me.body.permissions).not.toContain('user:manage');
      expect(Date.parse(me.body.session.idle_expires_at)).toBeLessThanOrEqual(
        Date.parse(me.body.session.absolute_expires_at),
      );
      expect(me.body.role_assignments).toHaveLength(1);

      const out = await c.post('/v1/auth/logout');
      expect(out.status).toBe(204);
      expect(String(out.headers['set-cookie'])).toMatch(/Max-Age=0/);
      // The cookie jar forgot it; replaying the old cookie value is 401 session-expired.
      const gone = await c.get('/v1/auth/me', {
        cookie: login.headers['set-cookie']!.toString().split(';')[0],
      });
      expect(gone.status).toBe(401);
      expect(gone.body.code).toBe('session-expired');
      expect(testPorts.audit.actions(T.tenantId)).toEqual(
        expect.arrayContaining(['auth.login.succeeded', 'auth.logout']),
      );
    });

    it('returns a tenant chooser when the email exists in several tenants, then signs in with tenant_slug', async () => {
      const email = `shared-${Date.now()}@multi.example`;
      const T2 = await createTenant(app, tenancy, 'Flow2', { adminEmail: email });
      const T3 = await createTenant(app, tenancy, 'Flow3', { adminEmail: email });
      const c = new Client(app);
      const first = await c.login(email, T2.adminPassword);
      // Only tenants whose password matches are offered (nothing is revealed before proving the password).
      expect(first.status).toBe(200);
      expect(first.body).toEqual({
        status: 'authenticated',
        csrf_token: expect.any(String),
        user: expect.anything(),
      });

      // Same password in both tenants: the chooser appears, listing both.
      const pw = newPassword();
      for (const t of [T2, T3]) {
        const reset = await t.admin.post('/v1/auth/password/forgot', { email });
        expect(reset.status).toBe(202);
      }
      await app.get(AuthService).drain();
      for (const mail of mailsTo(email, 'auth.password-reset').slice(-2)) {
        const r = await new Client(app).post('/v1/auth/password/reset', {
          token: mail.data.token,
          password: pw,
        });
        expect(r.status).toBe(204);
      }
      const chooser = await new Client(app).login(email, pw);
      expect(chooser.status).toBe(200);
      expect(chooser.body.status).toBe('tenant_selection_required');
      expect(chooser.body.tenants.map((t: { slug: string }) => t.slug).sort()).toEqual(
        [T2.slug, T3.slug].sort(),
      );
      expect(chooser.body.tenants[0]).toEqual({
        slug: expect.any(String),
        name: expect.any(String),
      });
      expect(chooser.headers['set-cookie']).toBeUndefined();

      const picked = await new Client(app).login(email, pw, { tenant_slug: T3.slug });
      expect(picked.body.status).toBe('authenticated');
      const me = await (async () => {
        const c2 = new Client(app);
        await c2.login(email, pw, { tenant_slug: T3.slug });
        return c2.get('/v1/auth/me');
      })();
      expect(me.body.tenant.id).toBe(T3.tenantId);
    });
  });

  describe('MFA (TOTP)', () => {
    it('enrols, shows recovery codes once, challenges at login and verifies', async () => {
      const u = await createUser(app, T, 'technician', 'mfa');
      const c = u.client;

      const enrol = await c.post('/v1/auth/mfa/enrol', {});
      expect(enrol.status).toBe(200);
      expect(enrol.body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(enrol.body.provisioning_uri).toMatch(
        /^otpauth:\/\/totp\/Asset%20Tracker:.+\?secret=[A-Z2-7]{32}&issuer=Asset\+Tracker/,
      );
      expect(enrol.headers['cache-control']).toBe('no-store');

      // Not active yet: login is still password-only.
      const bad = await c.post('/v1/auth/mfa/enrol/confirm', { code: '000000' });
      expect(bad.status).toBe(422);
      expect(bad.body.code).toBe('mfa-invalid-code');
      expect(bad.body.errors[0].pointer).toBe('/code');

      const { secret, recoveryCodes } = await enrolMfa(c);
      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);
      expect(mailsTo(u.email, 'auth.mfa-enabled')).toHaveLength(1);
      // The rotated session is MFA verified.
      const me = await c.get('/v1/auth/me');
      expect(me.body.auth.mfa_verified).toBe(true);
      expect(me.body.user.mfa_enabled).toBe(true);
      expect((await c.post('/v1/auth/mfa/enrol', {})).body.code).toBe('mfa-already-enrolled');

      // Login now requires the second factor.
      const c2 = new Client(app);
      const step1 = await c2.login(u.email, u.password);
      expect(step1.body.status).toBe('mfa_required');
      expect(step1.body.mfa.methods).toEqual(['totp', 'recovery_code']);
      expect(step1.headers['set-cookie']).toBeUndefined();
      expect((await c2.get('/v1/auth/me')).status).toBe(401);

      const wrong = await c2.post('/v1/auth/mfa/verify', {
        challenge_id: step1.body.mfa.challenge_id,
        method: 'totp',
        code: '123456',
      });
      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe('mfa-invalid-code');

      // The enrolment used this step's code; the next step is still in the window and unused.
      const ok = await c2.post('/v1/auth/mfa/verify', {
        challenge_id: step1.body.mfa.challenge_id,
        method: 'totp',
        code: codeAt(secret, 1),
      });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('authenticated');
      c2.csrf = ok.body.csrf_token;
      expect((await c2.get('/v1/auth/me')).body.auth.mfa_verified).toBe(true);

      // A recovery code works once.
      const c3 = new Client(app);
      const s3 = await c3.login(u.email, u.password);
      const rec = await c3.post('/v1/auth/mfa/verify', {
        challenge_id: s3.body.mfa.challenge_id,
        method: 'recovery_code',
        code: recoveryCodes[0]!.toLowerCase(),
      });
      expect(rec.status).toBe(200);
      const c4 = new Client(app);
      const s4 = await c4.login(u.email, u.password);
      const again = await c4.post('/v1/auth/mfa/verify', {
        challenge_id: s4.body.mfa.challenge_id,
        method: 'recovery_code',
        code: recoveryCodes[0]!,
      });
      expect(again.status).toBe(401);
      expect(again.body.code).toBe('mfa-invalid-code');
    });

    it('needs re-authentication to regenerate recovery codes and to disable MFA', async () => {
      const u = await createUser(app, T, 'viewer', 'reauth');
      const c = u.client;
      const { secret, recoveryCodes } = await enrolMfa(c);

      const noBody = await c.post('/v1/auth/mfa/recovery-codes/regenerate', {});
      expect(noBody.status).toBe(422);
      const wrongPw = await c.post('/v1/auth/mfa/recovery-codes/regenerate', {
        password: 'nope-nope-nope-nope',
      });
      expect(wrongPw.status).toBe(403);
      expect(wrongPw.body.code).toBe('reauth-failed');

      const regen = await c.post('/v1/auth/mfa/recovery-codes/regenerate', {
        password: u.password,
      });
      expect(regen.status).toBe(200);
      expect(regen.body.recovery_codes).toHaveLength(10);
      expect(regen.body.recovery_codes).not.toContain(recoveryCodes[0]);
      // Old codes are dead.
      const c2 = new Client(app);
      const s = await c2.login(u.email, u.password);
      const old = await c2.post('/v1/auth/mfa/verify', {
        challenge_id: s.body.mfa.challenge_id,
        method: 'recovery_code',
        code: recoveryCodes[1]!,
      });
      expect(old.status).toBe(401);

      // Disable with a TOTP code instead of the password.
      const other = await c.post('/v1/auth/mfa/recovery-codes/regenerate', {
        totp_code: codeAt(secret, 1),
      });
      expect(other.status).toBe(200);
      const wrongTotp = await c.del('/v1/auth/mfa', { totp_code: '111111' });
      expect(wrongTotp.status).toBe(403);
      expect(wrongTotp.body.code).toBe('reauth-failed');
      const off = await c.del('/v1/auth/mfa', { password: u.password });
      expect(off.status).toBe(204);
      expect(testPorts.audit.actions(T.tenantId)).toContain('auth.mfa.disabled');
      expect((await c.get('/v1/auth/me')).body.user.mfa_enabled).toBe(false);
      expect((await c.del('/v1/auth/mfa', { password: u.password })).status).toBe(409);
      // Back to password-only login.
      expect((await new Client(app).login(u.email, u.password)).body.status).toBe('authenticated');
    });
  });

  describe('sessions', () => {
    it('lists devices, revokes one, refuses to revoke the current one, revokes all others', async () => {
      const u = await createUser(app, T, 'viewer', 'sess');
      const second = new Client(app, '10.9.9.9');
      await second.login(u.email, u.password);
      const third = new Client(app);
      await third.login(u.email, u.password);

      const list = await u.client.get('/v1/auth/sessions');
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(3);
      expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({
        id: expect.any(String),
        created_at: expect.any(String),
        last_seen_at: expect.any(String),
        user_agent: expect.anything(),
      });
      const current = list.body.data.find((s: { current: boolean }) => s.current);
      const cannot = await u.client.del(`/v1/auth/sessions/${current.id}`);
      expect(cannot.status).toBe(409);
      expect(cannot.body.code).toBe('cannot-revoke-current');
      expect((await u.client.del(`/v1/auth/sessions/${crypto.randomUUID()}`)).status).toBe(404);

      const other = list.body.data.find(
        (s: { current: boolean; ip: string }) => !s.current && s.ip === '10.9.9.9',
      );
      expect((await u.client.del(`/v1/auth/sessions/${other.id}`)).status).toBe(204);
      const dead = await second.get('/v1/auth/me');
      expect(dead.status).toBe(401);
      expect(dead.body.code).toBe('session-expired');

      expect((await u.client.del('/v1/auth/sessions')).status).toBe(204);
      expect((await third.get('/v1/auth/me')).status).toBe(401);
      expect((await u.client.get('/v1/auth/me')).status).toBe(200);
    });
  });

  describe('password reset', () => {
    it('never reveals whether the email exists and revokes every session on reset', async () => {
      const u = await createUser(app, T, 'viewer', 'reset');
      const a = new Client(app);
      await a.login(u.email, u.password);

      const known = await new Client(app).post('/v1/auth/password/forgot', { email: u.email });
      const unknown = await new Client(app).post('/v1/auth/password/forgot', {
        email: `nobody-${Date.now()}@nowhere.example`,
      });
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(known.raw).toBe(unknown.raw);
      await app.get(AuthService).drain();
      const mails = mailsTo(u.email, 'auth.password-reset');
      expect(mails).toHaveLength(1);
      expect(mailsTo(`nobody-${Date.now()}@nowhere.example`)).toHaveLength(0);

      const token = mails[0]!.data.token as string;
      const weak = await new Client(app).post('/v1/auth/password/reset', {
        token,
        password: 'aaaaaaaaaaaaaaaa',
      });
      expect(weak.status).toBe(422);
      const newPw = newPassword();
      const done = await new Client(app).post('/v1/auth/password/reset', {
        token,
        password: newPw,
      });
      expect(done.status).toBe(204);
      const replay = await new Client(app).post('/v1/auth/password/reset', {
        token,
        password: newPassword(),
      });
      expect(replay.status).toBe(404);
      expect(replay.body.code).toBe('token-invalid');

      // Every session died; the new password works, the old one does not.
      expect((await a.get('/v1/auth/me')).status).toBe(401);
      expect((await u.client.get('/v1/auth/me')).status).toBe(401);
      expect((await new Client(app).login(u.email, u.password)).status).toBe(401);
      expect((await new Client(app).login(u.email, newPw)).status).toBe(200);
    });
  });

  describe('user management', () => {
    it('creates, lists, reads, updates (If-Match) and archives users', async () => {
      const email = `crud-${Date.now()}@${T.slug}.example`;
      const created = await T.admin.post('/v1/users', {
        email,
        display_name: 'Crud',
        role_assignments: [{ role_id: T.roles.viewer }],
        send_invite: false,
        status: 'disabled',
      });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('disabled');
      const id = created.body.id as string;

      const dup = await T.admin.post('/v1/users', {
        email: email.toUpperCase(),
        display_name: 'Dup',
        role_assignments: [{ role_id: T.roles.viewer }],
        send_invite: false,
      });
      expect(dup.status).toBe(409);

      const list = await T.admin.get(
        `/v1/users?q=${encodeURIComponent('crud-')}&include_total=true`,
      );
      expect(list.status).toBe(200);
      expect(list.body.data.map((u: { id: string }) => u.id)).toContain(id);
      expect(list.body.page.total).toBeGreaterThanOrEqual(1);

      const got = await T.admin.get(`/v1/users/${id}`);
      expect(got.status).toBe(200);
      expect(got.headers.etag).toBe('W/"1"');

      const noMatch = await T.admin.patch(`/v1/users/${id}`, { display_name: 'New' });
      expect(noMatch.status).toBe(428);
      const stale = await T.admin.patch(
        `/v1/users/${id}`,
        { display_name: 'New' },
        { headers: { 'if-match': 'W/"99"' } },
      );
      expect(stale.status).toBe(412);
      const upd = await T.admin.patch(
        `/v1/users/${id}`,
        { display_name: 'New Name', locale: 'de' },
        { headers: { 'if-match': got.headers.etag as string } },
      );
      expect(upd.status).toBe(200);
      expect(upd.body).toMatchObject({ display_name: 'New Name', locale: 'de' });
      expect(upd.headers.etag).toBe('W/"2"');

      const del = await T.admin.del(`/v1/users/${id}`, undefined, {
        headers: { 'if-match': upd.headers.etag as string },
      });
      expect(del.status).toBe(204);
      expect(
        (await T.admin.get(`/v1/users?q=${encodeURIComponent('crud-')}`)).body.data.map(
          (u: { id: string }) => u.id,
        ),
      ).not.toContain(id);
      const archived = await T.admin.get(
        `/v1/users?archived=only&q=${encodeURIComponent('crud-')}`,
      );
      expect(archived.body.data[0].archived_at).toBeTruthy();
    });

    it('resends and revokes invitations (revoke archives the never-activated account)', async () => {
      const email = `resend-${Date.now()}@${T.slug}.example`;
      const created = await T.admin.post('/v1/users', {
        email,
        display_name: 'Resend',
        role_assignments: [{ role_id: T.roles.viewer }],
      });
      const id = created.body.id as string;
      const first = mailsTo(email, 'auth.invitation')[0]!.data.token as string;

      expect((await T.admin.post(`/v1/users/${id}/invitation/resend`)).status).toBe(204);
      const second = mailsTo(email, 'auth.invitation')[1]!.data.token as string;
      expect(second).not.toBe(first);
      expect((await new Client(app).get(`/v1/auth/invitations/${first}`)).status).toBe(404); // old link is dead
      expect((await new Client(app).get(`/v1/auth/invitations/${second}`)).status).toBe(200);

      expect((await T.admin.del(`/v1/users/${id}/invitation`)).status).toBe(204);
      const gone = await new Client(app).get(`/v1/auth/invitations/${second}`);
      expect(gone.status).toBe(404);
      expect(gone.body.code).toBe('invitation-not-found');
      const after = await T.admin.get(`/v1/users/${id}`);
      expect(after.body.archived_at).toBeTruthy();
      expect((await T.admin.post(`/v1/users/${id}/invitation/resend`)).status).toBe(404);
      // The address is free again.
      expect(
        (
          await T.admin.post('/v1/users', {
            email,
            display_name: 'Again',
            role_assignments: [{ role_id: T.roles.viewer }],
          })
        ).status,
      ).toBe(201);
    });

    it('answers 410 for an expired invitation and resend recovers from it', async () => {
      const email = `expired-${Date.now()}@${T.slug}.example`;
      const created = await T.admin.post('/v1/users', {
        email,
        display_name: 'Late',
        role_assignments: [{ role_id: T.roles.viewer }],
      });
      const token = mailsTo(email, 'auth.invitation')[0]!.data.token as string;
      // Age both the invitation and its token (RLS needs the tenant set in the same transaction).
      await withClient(env.migratorUrl!, async (c) => {
        await c.query('begin');
        await c.query(`select set_config('app.tenant_id', $1, true)`, [T.tenantId]);
        await c.query(
          `update app.invitation set expires_at = now() - interval '1 minute' where user_id = $1`,
          [created.body.id],
        );
        await c.query(
          `update identity.invitation_token set expires_at = now() - interval '1 minute' where invitation_id in (select id from app.invitation where user_id = $1)`,
          [created.body.id],
        );
        await c.query('commit');
      });
      const info = await new Client(app).get(`/v1/auth/invitations/${token}`);
      expect(info.status).toBe(410);
      expect(info.body.code).toBe('invitation-expired');
      const accept = await new Client(app).post('/v1/auth/invitations/accept', {
        token,
        password: newPassword(),
        display_name: 'Late',
      });
      expect(accept.status).toBe(410);
      expect((await T.admin.post(`/v1/users/${created.body.id}/invitation/resend`)).status).toBe(
        204,
      );
      const fresh = mailsTo(email, 'auth.invitation')[1]!.data.token as string;
      expect((await new Client(app).get(`/v1/auth/invitations/${fresh}`)).status).toBe(200);
    });

    it('revokes sessions on role change and deactivation, and audits both', async () => {
      const u = await createUser(app, T, 'viewer', 'revoke');
      const target = await T.admin.get(`/v1/users/${u.id}`);
      const change = await T.admin.patch(
        `/v1/users/${u.id}`,
        { role_assignments: [{ role_id: T.roles.technician }] },
        { headers: { 'if-match': target.headers.etag as string } },
      );
      expect(change.status).toBe(200);
      expect(change.body.role_assignments[0].role_id).toBe(T.roles.technician);
      expect((await u.client.get('/v1/auth/me')).status).toBe(401);
      expect(testPorts.audit.actions(T.tenantId)).toContain('user.role_changed');

      const c = new Client(app);
      await c.login(u.email, u.password);
      expect((await c.get('/v1/auth/me')).body.permissions).toContain('asset:checkout');
      const fresh = await T.admin.get(`/v1/users/${u.id}`);
      const off = await T.admin.patch(
        `/v1/users/${u.id}`,
        { status: 'disabled' },
        { headers: { 'if-match': fresh.headers.etag as string } },
      );
      expect(off.status).toBe(200);
      expect((await c.get('/v1/auth/me')).status).toBe(401);
      const denied = await new Client(app).login(u.email, u.password);
      expect(denied.status).toBe(401);
      expect(testPorts.audit.actions(T.tenantId)).toContain('user.updated');

      // Reactivating works because the account has a credential.
      const again = await T.admin.get(`/v1/users/${u.id}`);
      const on = await T.admin.patch(
        `/v1/users/${u.id}`,
        { status: 'active' },
        { headers: { 'if-match': again.headers.etag as string } },
      );
      expect(on.status).toBe(200);
      expect((await new Client(app).login(u.email, u.password)).status).toBe(200);
    });

    it('lets an admin list and revoke a user session and reset a user MFA', async () => {
      const u = await createUser(app, T, 'viewer', 'adm');
      await enrolMfa(u.client);
      const sessions = await T.admin.get(`/v1/users/${u.id}/sessions`);
      expect(sessions.status).toBe(200);
      expect(sessions.body.data).toHaveLength(1);
      expect(sessions.body.data[0].current).toBe(false);
      expect(
        (await T.admin.del(`/v1/users/${u.id}/sessions/${sessions.body.data[0].id}`)).status,
      ).toBe(204);
      expect((await u.client.get('/v1/auth/me')).status).toBe(401);

      expect((await T.admin.del(`/v1/users/${u.id}/mfa`)).status).toBe(204);
      const login = await new Client(app).login(u.email, u.password);
      expect(login.body.status).toBe('authenticated');
      const adminSelf = await T.admin.get('/v1/auth/me');
      expect((await T.admin.del(`/v1/users/${adminSelf.body.user.id}/mfa`)).status).toBe(409);
      expect(testPorts.audit.actions(T.tenantId)).toEqual(
        expect.arrayContaining(['auth.mfa.reset', 'session.revoked']),
      );
    });

    it('lists the built-in roles', async () => {
      const roles = await T.admin.get('/v1/roles');
      expect(roles.status).toBe(200);
      expect(roles.body.data.map((r: { key: string }) => r.key).sort()).toEqual(
        BUILTIN_ROLES.map((r) => r.key).sort(),
      );
      const companies = await T.admin.get('/v1/companies');
      expect(companies.status).toBe(200);
      expect(companies.body.data).toEqual([
        { id: expect.any(String), name: T.name, code: null, is_default: true },
      ]);
    });
  });

  describe('API keys', () => {
    it('creates a scoped key, authenticates with it, and revokes it', async () => {
      const created = await T.admin.post('/v1/api-keys', {
        name: 'ci',
        scopes: ['asset:read', 'user:read'],
      });
      expect(created.status).toBe(201);
      expect(created.body.secret).toMatch(/^[A-Za-z0-9]{12}\.[A-Za-z0-9_-]{43}$/);
      expect(created.body).not.toHaveProperty('key_hash');

      const key = new Client(app);
      const bearer = {
        headers: { authorization: `Bearer ${created.body.secret}` },
        cookie: false,
      } as const;
      const me = await key.get('/v1/auth/me', bearer);
      expect(me.status).toBe(200);
      expect(me.body.auth).toMatchObject({
        method: 'api_key',
        api_key_id: created.body.id,
        scopes: ['asset:read', 'user:read'],
      });
      expect(me.body.session).toBeNull();
      expect(me.body.permissions).toEqual(['asset:read', 'user:read']);

      expect((await key.get('/v1/users', bearer)).status).toBe(200);
      // user:manage is not in the key's scopes, whatever its creator can do.
      expect(
        (
          await key.post(
            '/v1/users',
            {
              email: 'x@y.example',
              display_name: 'x',
              role_assignments: [{ role_id: T.roles.viewer }],
            },
            { ...bearer, csrf: false },
          )
        ).status,
      ).toBe(403);
      // Browser-session-only operations refuse a key.
      expect((await key.get('/v1/auth/sessions', bearer)).status).toBe(403);
      // No CSRF header needed for a bearer key (it is not ambient).
      expect((await key.post('/v1/auth/logout', undefined, bearer)).status).toBe(204);

      const tooBroad = await T.admin.post('/v1/api-keys', {
        name: 'bad',
        scopes: ['nonsense:thing'],
      });
      expect(tooBroad.status).toBe(422);
      const viewer = await createUser(app, T, 'viewer', 'keyviewer');
      expect(
        (await viewer.client.post('/v1/api-keys', { name: 'n', scopes: ['asset:read'] })).status,
      ).toBe(403);

      expect(
        (await T.admin.get('/v1/api-keys')).body.data.map((k: { id: string }) => k.id),
      ).toContain(created.body.id);
      expect((await T.admin.del(`/v1/api-keys/${created.body.id}`)).status).toBe(204);
      const revoked = await key.get('/v1/auth/me', bearer);
      expect(revoked.status).toBe(401);
      expect((await T.admin.del(`/v1/api-keys/${created.body.id}`)).status).toBe(409);
    });
  });

  it('rejects a body with unknown fields and a missing credential with problem+json', async () => {
    const res = await new Client(app).post('/v1/auth/login', {
      email: 'a@b.example',
      password: 'x',
      extra: 1,
    });
    expect(res.status).toBe(422);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ code: 'validation', status: 422 });
    const anon = await new Client(app, freshIp()).get('/v1/users');
    expect(anon.status).toBe(401);
    expect(anon.body.code).toBe('unauthorized');
  });
});
