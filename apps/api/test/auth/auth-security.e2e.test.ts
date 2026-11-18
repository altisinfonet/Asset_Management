import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/auth/auth.service.js';
import {
  Client,
  codeAt,
  COOKIE,
  createTenant,
  createUser,
  dbEnabled,
  enrolMfa,
  freshIp,
  mailsTo,
  mailToken,
  newPassword,
  newTenancy,
  ownerSql,
  ownerTenantSql,
  setMfaPolicy,
  startApp,
  testPorts,
  uniq,
  type TenantFixture,
} from './support.js';

/**
 * M1-AUTH-08: the auth security suite. Each block is one attack from the backlog or the OWASP ASVS L2
 * authentication/session chapters (docs/engineering/auth-security.md links every item to a test here).
 * Real PostgreSQL, real guard, real cookies; no mocks of the code under test.
 */
describe.skipIf(!dbEnabled)('auth security', () => {
  const tenancy = newTenancy();
  let app: NestFastifyApplication;
  let A: TenantFixture;
  let B: TenantFixture;

  beforeAll(async () => {
    ({ app } = await startApp());
    A = await createTenant(app, tenancy, 'SecA');
    B = await createTenant(app, tenancy, 'SecB');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
  });

  const sessionRow = async (token: string) =>
    (
      await ownerSql(`select * from identity.session where token_hash = $1`, [
        createHash('sha256').update(token).digest(),
      ])
    ).rows[0];

  // ---------------------------------------------------------------------------------- enumeration

  describe('account enumeration resistance', () => {
    it('answers an unknown email and a wrong password identically', async () => {
      const u = await createUser(app, A, 'viewer', 'enum');
      const wrong = await new Client(app).login(u.email, 'wrong-password-wrong');
      const unknown = await new Client(app).login(
        `nobody-${uniq()}@nowhere.example`,
        'wrong-password-wrong',
      );
      const wrongSlug = await new Client(app).login(u.email, u.password, { tenant_slug: B.slug });
      for (const res of [wrong, unknown, wrongSlug]) {
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('invalid-credentials');
      }
      const shape = (b: Record<string, unknown>) => ({
        ...b,
        request_id: undefined,
        instance: undefined,
      });
      expect(shape(unknown.body)).toEqual(shape(wrong.body));
      expect(shape(wrongSlug.body)).toEqual(shape(wrong.body));
      expect(unknown.headers['set-cookie']).toBeUndefined();
      // A disabled account is indistinguishable too.
      const target = await A.admin.get(`/v1/users/${u.id}`);
      await A.admin.patch(
        `/v1/users/${u.id}`,
        { status: 'disabled' },
        { headers: { 'if-match': target.headers.etag as string } },
      );
      const disabled = await new Client(app).login(u.email, u.password);
      expect(shape(disabled.body)).toEqual(shape(wrong.body));
    });

    it('spends the same time on an unknown email as on a wrong password (production argon2 cost)', async () => {
      const slow = await startApp({ ARGON2_MEMORY_KIB: '19456', ARGON2_TIME_COST: '2' });
      try {
        const T = await createTenant(slow.app, tenancy, 'Timing');
        const email = T.adminEmail;
        const time = async (fn: () => Promise<unknown>) => {
          const t0 = performance.now();
          await fn();
          return performance.now() - t0;
        };
        const samples = { known: [] as number[], unknown: [] as number[] };
        await new Client(slow.app).login(email, 'warm-up-warm-up-1'); // dummy hash + pools warm
        for (let i = 0; i < 6; i++) {
          samples.known.push(
            await time(() => new Client(slow.app).login(email, 'wrong-password-1234')),
          );
          samples.unknown.push(
            await time(() =>
              new Client(slow.app).login(
                `ghost-${i}-${uniq()}@nowhere.example`,
                'wrong-password-1234',
              ),
            ),
          );
        }
        const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
        const known = median(samples.known);
        const unknown = median(samples.unknown);
        // Both paths run exactly one argon2 verification (tens of ms); the rest is noise.
        expect(known).toBeGreaterThan(10);
        expect(unknown / known).toBeGreaterThan(0.6);
        expect(unknown / known).toBeLessThan(1.6);
      } finally {
        await slow.app.close();
      }
    }, 60_000);

    it('password reset requests answer the same for known and unknown emails, in similar time', async () => {
      const u = await createUser(app, A, 'viewer', 'enumreset');
      const time = async (email: string) => {
        const t0 = performance.now();
        const res = await new Client(app).post('/v1/auth/password/forgot', { email });
        return { ms: performance.now() - t0, res };
      };
      const known = await time(u.email);
      const unknown = await time(`ghost-${uniq()}@nowhere.example`);
      expect(known.res.status).toBe(202);
      expect(unknown.res.status).toBe(202);
      expect(known.res.raw).toBe(unknown.res.raw);
      expect(Math.abs(known.ms - unknown.ms)).toBeLessThan(250);
      await app.get(AuthService).drain();
    });

    it('answers unknown, revoked and spent invitation tokens identically', async () => {
      const created = await A.admin.post('/v1/users', {
        email: `inv-enum-${uniq()}@${A.slug}.example`,
        display_name: 'x',
        role_assignments: [{ role_id: A.roles.viewer }],
      });
      const token = mailToken(mailsTo(created.body.email, 'auth.invitation')[0]!);
      await A.admin.del(`/v1/users/${created.body.id}/invitation`);
      const revoked = await new Client(app).get(`/v1/auth/invitations/${token}`);
      const unknown = await new Client(app).get(`/v1/auth/invitations/${'z'.repeat(43)}`);
      expect(revoked.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect({ ...revoked.body, request_id: 0, instance: 0 }).toEqual({
        ...unknown.body,
        request_id: 0,
        instance: 0,
      });
    });
  });

  // ------------------------------------------------------------------------------------ lockout

  describe('throttling and lockout', () => {
    it('locks an account after repeated failures, even for the correct password, with Retry-After', async () => {
      const u = await createUser(app, A, 'viewer', 'lock');
      const c = new Client(app);
      for (let i = 0; i < 5; i++) {
        expect((await c.login(u.email, 'wrong-password-wrong')).status).toBe(401);
      }
      const locked = await c.login(u.email, u.password);
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('account-locked');
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(locked.headers['retry-after'])).toBeLessThanOrEqual(15 * 60);
      // Another client (another IP) is locked out of the same account too: it is per account, not per IP.
      expect((await new Client(app).login(u.email, u.password)).status).toBe(429);

      // An unknown email is locked in exactly the same way (the lock itself reveals nothing).
      const ghost = `ghost-${uniq()}@nowhere.example`;
      for (let i = 0; i < 5; i++) await c.login(ghost, 'wrong-password-wrong');
      const ghostLocked = await c.login(ghost, 'wrong-password-wrong');
      expect(ghostLocked.status).toBe(429);
      expect(ghostLocked.body.code).toBe('account-locked');

      const events = await ownerSql(
        `select event_type, detail::text as detail from identity.security_event where subject = $1 order by at`,
        [u.email.toLowerCase()],
      );
      expect(events.rows.map((r) => r.event_type)).toEqual(
        expect.arrayContaining(['login_failed', 'account_locked']),
      );
      expect(JSON.stringify(events.rows)).not.toContain('wrong-password');

      // The window passing ends the lock (simulated by clearing the counter).
      await ownerSql(`delete from identity.auth_throttle where bucket like 'login:acct:%'`);
      expect((await new Client(app).login(u.email, u.password)).status).toBe(200);
    });

    it('throttles by IP across accounts (429 too-many-requests with Retry-After)', async () => {
      const strict = await startApp({ LOGIN_MAX_FAILURES_PER_IP: '4' });
      try {
        const c = new Client(strict.app);
        for (let i = 0; i < 4; i++) {
          expect(
            (await c.login(`ip-${i}-${uniq()}@nowhere.example`, 'wrong-password-wrong')).status,
          ).toBe(401);
        }
        const blocked = await c.login(`ip-x-${uniq()}@nowhere.example`, 'wrong-password-wrong');
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe('too-many-requests');
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
        // A different address is unaffected.
        expect(
          (
            await new Client(strict.app).login(
              `other-${uniq()}@nowhere.example`,
              'wrong-password-wrong',
            )
          ).status,
        ).toBe(401);
      } finally {
        await strict.app.close();
      }
    });

    it('throttles password reset requests per email', async () => {
      const email = `ghost-${uniq()}@nowhere.example`;
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++)
        statuses.push((await new Client(app).post('/v1/auth/password/forgot', { email })).status);
      expect(statuses.slice(0, 3)).toEqual([202, 202, 202]);
      const limited = await new Client(app).post('/v1/auth/password/forgot', { email });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('counts failed re-authentication toward the same lockout', async () => {
      const u = await createUser(app, A, 'viewer', 'reauthlock');
      await enrolMfa(u.client);
      for (let i = 0; i < 5; i++) {
        expect(
          (await u.client.del('/v1/auth/mfa', { password: 'wrong-password-wrong' })).body.code,
        ).toBe('reauth-failed');
      }
      const locked = await u.client.del('/v1/auth/mfa', { password: u.password });
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('account-locked');
    });
  });

  // -------------------------------------------------------------------------------- fixation

  describe('session fixation and cookie hygiene', () => {
    it('ignores a planted cookie and issues a new, different id at login', async () => {
      const u = await createUser(app, A, 'viewer', 'fix');
      const planted = 'A'.repeat(43);
      const c = new Client(app);
      const res = await c.login(u.email, u.password, undefined);
      const login = await new Client(app).request('POST', '/v1/auth/login', {
        body: { email: u.email, password: u.password },
        cookie: planted,
      });
      expect(login.status).toBe(200);
      const issued = String(login.headers['set-cookie']).split(';')[0]!.split('=')[1]!;
      expect(issued).not.toBe(planted);
      expect(issued).not.toBe(c.token);
      // The planted id never became a session.
      expect((await new Client(app).get('/v1/auth/me', { cookie: planted })).status).toBe(401);
      expect(res.status).toBe(200);
      // Each login is its own session.
      const rows = await ownerSql(
        `select count(*)::int as n from identity.session where user_id = $1`,
        [u.id],
      );
      expect(rows.rows[0].n).toBeGreaterThanOrEqual(3);
    });

    it('rotates the session id (and kills the old one) when MFA is enrolled', async () => {
      const u = await createUser(app, A, 'viewer', 'rotate');
      const before = u.client.token!;
      const stolen = u.client.clone();
      await enrolMfa(u.client);
      expect(u.client.token).not.toBe(before);
      expect((await stolen.get('/v1/auth/me')).status).toBe(401); // the pre-enrolment cookie is dead
      expect((await u.client.get('/v1/auth/me')).status).toBe(200);
      // Rotation does not extend the absolute lifetime.
      const a = (await u.client.get('/v1/auth/me')).body.session.absolute_expires_at;
      expect(Date.parse(a)).toBeLessThanOrEqual(Date.now() + 12 * 3600_000 + 5000);
    });

    it('sets __Host- cookies with HttpOnly, Secure, SameSite=Lax, Path=/ and no Domain; stores only a hash', async () => {
      const u = await createUser(app, A, 'viewer', 'flags');
      const c = new Client(app);
      const res = await c.login(u.email, u.password);
      const header = String(res.headers['set-cookie']);
      expect(header).toMatch(/^__Host-at_session=/);
      for (const attr of [
        /;\s*HttpOnly/,
        /;\s*Secure/,
        /;\s*SameSite=Lax/,
        /;\s*Path=\//,
        /;\s*Max-Age=\d+/,
      ]) {
        expect(header).toMatch(attr);
      }
      expect(header).not.toMatch(/Domain=/i);
      const token = c.token!;
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits, opaque
      const row = await sessionRow(token);
      expect(row.token_hash).toEqual(createHash('sha256').update(token).digest());
      expect(Buffer.from(row.token_hash).toString('utf8')).not.toContain(token);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  // --------------------------------------------------------------------------------------- CSRF

  describe('CSRF', () => {
    it('rejects cookie-authenticated mutations without a valid token', async () => {
      const u = await createUser(app, A, 'asset_manager', 'csrf');
      const c = u.client;
      const body = { name: 'ci', scopes: ['asset:read'] };
      const none = await c.post('/v1/auth/mfa/enrol', {}, { csrf: false });
      expect(none.status).toBe(403);
      expect(none.body.code).toBe('csrf-invalid');
      const wrong = await c.post('/v1/auth/mfa/enrol', {}, { csrf: 'x'.repeat(43) });
      expect(wrong.body.code).toBe('csrf-invalid');
      // Another session's token does not work either.
      const other = await createUser(app, A, 'viewer', 'csrf2');
      const crossed = await c.post('/v1/auth/mfa/enrol', {}, { csrf: other.client.csrf });
      expect(crossed.body.code).toBe('csrf-invalid');
      expect((await c.del('/v1/auth/sessions', undefined, { csrf: false })).body.code).toBe(
        'csrf-invalid',
      );
      expect((await c.post('/v1/auth/logout', undefined, { csrf: false })).status).toBe(403);
      // Reads need no token; the right token works.
      expect((await c.get('/v1/auth/me')).status).toBe(200);
      expect((await c.post('/v1/auth/mfa/enrol', {})).status).toBe(200);
      expect(body).toBeTruthy();
      const events = await ownerSql(
        `select count(*)::int as n from identity.security_event where event_type = 'csrf_rejected'`,
      );
      expect(events.rows[0].n).toBeGreaterThan(0);
    });

    it('does not require a CSRF token for public endpoints', async () => {
      const u = await createUser(app, A, 'viewer', 'csrfpublic');
      expect((await new Client(app).login(u.email, u.password)).status).toBe(200);
    });
  });

  // ----------------------------------------------------------------------- expired / revoked

  describe('expired and revoked sessions', () => {
    it('rejects unknown, revoked, idle-expired and absolutely expired sessions with 401 session-expired', async () => {
      const u = await createUser(app, A, 'viewer', 'expire');
      const mk = async () => {
        const c = new Client(app);
        await c.login(u.email, u.password);
        return c;
      };
      expect((await new Client(app).get('/v1/auth/me', { cookie: 'B'.repeat(43) })).body.code).toBe(
        'session-expired',
      );

      const idle = await mk();
      await ownerSql(
        `update identity.session set idle_expires_at = now() - interval '1 second' where token_hash = $1`,
        [createHash('sha256').update(idle.token!).digest()],
      );
      const r1 = await idle.get('/v1/auth/me');
      expect(r1.status).toBe(401);
      expect(r1.body.code).toBe('session-expired');

      const abs = await mk();
      await ownerSql(
        `update identity.session set idle_expires_at = now() - interval '2 seconds', expires_at = now() - interval '1 second' where token_hash = $1`,
        [createHash('sha256').update(abs.token!).digest()],
      );
      expect((await abs.get('/v1/auth/me')).body.code).toBe('session-expired');

      const revoked = await mk();
      await ownerSql(`update identity.session set revoked_at = now() where token_hash = $1`, [
        createHash('sha256').update(revoked.token!).digest(),
      ]);
      expect((await revoked.get('/v1/auth/me')).body.code).toBe('session-expired');
    });

    it('slides the idle timeout forward on activity but never past the absolute limit', async () => {
      const u = await createUser(app, A, 'viewer', 'slide');
      const c = new Client(app);
      await c.login(u.email, u.password);
      const hash = createHash('sha256').update(c.token!).digest();
      await ownerSql(
        `update identity.session set last_seen_at = now() - interval '5 minutes', idle_expires_at = now() + interval '1 minute' where token_hash = $1`,
        [hash],
      );
      const me = await c.get('/v1/auth/me');
      const idle = Date.parse(me.body.session.idle_expires_at);
      expect(idle - Date.now()).toBeGreaterThan(25 * 60_000);
      const row = await sessionRow(c.token!);
      expect(new Date(row.idle_expires_at).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
      expect(new Date(row.idle_expires_at).getTime()).toBeLessThanOrEqual(
        new Date(row.expires_at).getTime(),
      );
      // Near the absolute limit the idle time is capped by it.
      await ownerSql(
        `update identity.session set last_seen_at = now() - interval '5 minutes', idle_expires_at = now() + interval '1 minute', expires_at = now() + interval '2 minutes' where token_hash = $1`,
        [hash],
      );
      const near = await c.get('/v1/auth/me');
      expect(Date.parse(near.body.session.idle_expires_at)).toBeLessThanOrEqual(
        Date.parse(near.body.session.absolute_expires_at),
      );
    });

    it('refuses a session whose tenant was suspended', async () => {
      const S = await createTenant(app, tenancy, 'Susp');
      expect((await S.admin.get('/v1/auth/me')).status).toBe(200);
      await ownerSql(
        `update identity.tenant_directory set status = 'suspended' where tenant_id = $1`,
        [S.tenantId],
      );
      const res = await S.admin.get('/v1/auth/me');
      expect(res.status).toBe(403);
      const login = await new Client(app).login(S.adminEmail, S.adminPassword);
      expect(login.status).toBe(403);
      await ownerSql(
        `update identity.tenant_directory set status = 'active' where tenant_id = $1`,
        [S.tenantId],
      );
    });
  });

  // --------------------------------------------------------------------------- cross-tenant

  describe('cross-tenant access', () => {
    it("never exposes or touches another tenant's users, sessions, keys, invitations or roles", async () => {
      const bUser = await createUser(app, B, 'viewer', 'xt');
      const bSessions = await B.admin.get(`/v1/users/${bUser.id}/sessions`);
      const bSessionId = bSessions.body.data[0].id as string;
      const bKey = await B.admin.post('/v1/api-keys', { name: 'b', scopes: ['asset:read'] });
      const aUser = await createUser(app, A, 'viewer', 'xt-a');

      // Reads and writes by A on B's ids look exactly like missing ids.
      const notFound = async (res: Promise<{ status: number; body: { code: string } }>) => {
        const r = await res;
        expect([r.status, r.body.code]).toEqual([404, 'not-found']);
      };
      await notFound(A.admin.get(`/v1/users/${bUser.id}`));
      await notFound(
        A.admin.patch(
          `/v1/users/${bUser.id}`,
          { display_name: 'pwn' },
          { headers: { 'if-match': 'W/"1"' } },
        ),
      );
      await notFound(
        A.admin.del(`/v1/users/${bUser.id}`, undefined, { headers: { 'if-match': 'W/"1"' } }),
      );
      await notFound(A.admin.get(`/v1/users/${bUser.id}/sessions`));
      await notFound(A.admin.del(`/v1/users/${bUser.id}/sessions/${bSessionId}`));
      await notFound(A.admin.del(`/v1/users/${aUser.id}/sessions/${bSessionId}`)); // own user, foreign session id
      await notFound(A.admin.del(`/v1/users/${bUser.id}/mfa`));
      await notFound(A.admin.del(`/v1/auth/sessions/${bSessionId}`));
      await notFound(A.admin.del(`/v1/api-keys/${bKey.body.id}`));
      expect((await A.admin.post(`/v1/users/${bUser.id}/invitation/resend`)).status).toBe(404);
      expect((await A.admin.del(`/v1/users/${bUser.id}/invitation`)).status).toBe(404);
      // B's session is untouched.
      expect((await bUser.client.get('/v1/auth/me')).status).toBe(200);
      expect((await B.admin.get(`/v1/users/${bUser.id}`)).status).toBe(200);

      // B's role ids are not grantable in A.
      const grant = await A.admin.post('/v1/users', {
        email: `x-${uniq()}@${A.slug}.example`,
        display_name: 'x',
        role_assignments: [{ role_id: B.roles.tenant_admin }],
      });
      expect(grant.status).toBe(422);
      expect(grant.body.errors[0].pointer).toBe('/role_assignments/0/role_id');

      // Lists never contain the other tenant.
      const listed = await A.admin.get('/v1/users?limit=200');
      expect(listed.body.data.map((u: { id: string }) => u.id)).not.toContain(bUser.id);
      expect(
        (await A.admin.get('/v1/api-keys')).body.data.map((k: { id: string }) => k.id),
      ).not.toContain(bKey.body.id);
      // A's session list holds only A's sessions.
      const mine = await A.admin.get('/v1/auth/sessions');
      expect(mine.body.data.map((s: { id: string }) => s.id)).not.toContain(bSessionId);
    });

    it('takes the tenant only from the credential: ids in header, query and body change nothing', async () => {
      const bUser = await createUser(app, B, 'viewer', 'spoof');
      const spoof = {
        'x-tenant-id': B.tenantId,
        'x-test-tenant': B.tenantId,
        'x-tenant-slug': B.slug,
        'x-forwarded-host': `${B.slug}.example.test`,
      };
      const list = await A.admin.get(`/v1/users?limit=200&tenant_id=${B.tenantId}`, {
        headers: spoof,
      });
      expect(list.status).toBe(200);
      const ids = list.body.data.map((u: { id: string }) => u.id);
      expect(ids).not.toContain(bUser.id);
      const me = await A.admin.get(`/v1/auth/me?tenant_id=${B.tenantId}`, { headers: spoof });
      expect(me.body.tenant.id).toBe(A.tenantId);
      const created = await A.admin.post(
        '/v1/users',
        {
          email: `spoof-${uniq()}@${A.slug}.example`,
          display_name: 'S',
          role_assignments: [{ role_id: A.roles.viewer }],
          tenant_id: B.tenantId,
        },
        { headers: spoof },
      );
      expect(created.status).toBe(422); // strict body: unknown field
      const ok = await A.admin.post(
        '/v1/users',
        {
          email: `spoof2-${uniq()}@${A.slug}.example`,
          display_name: 'S',
          role_assignments: [{ role_id: A.roles.viewer }],
        },
        { headers: spoof },
      );
      expect(ok.status).toBe(201);
      const { rows } = await ownerTenantSql(
        A.tenantId,
        `select tenant_id from app.user_account where id = $1`,
        [ok.body.id],
      );
      expect(rows[0].tenant_id).toBe(A.tenantId);
    });

    it("refuses a credential used on another tenant's hostname", async () => {
      const hosted = await startApp({ TENANT_HOST_SUFFIX: 'tenants.test' });
      try {
        const T = await createTenant(hosted.app, tenancy, 'Host');
        const U = await createTenant(hosted.app, tenancy, 'Host2');
        const c = T.admin;
        expect(
          (await c.get('/v1/auth/me', { headers: { host: `${T.slug}.tenants.test` } })).status,
        ).toBe(200);
        const wrong = await c.get('/v1/auth/me', { headers: { host: `${U.slug}.tenants.test` } });
        expect(wrong.status).toBe(403);
        expect(wrong.body.code).toBe('forbidden');
        // A host outside the tenant namespace (an IP, localhost, the API host) is no hint at all.
        expect(
          (await c.get('/v1/auth/me', { headers: { host: 'api.assettracker.test' } })).status,
        ).toBe(200);

        // A vanity host picks the tenant at login; a conflicting tenant_slug is refused.
        const login = await new Client(hosted.app).request('POST', '/v1/auth/login', {
          body: { email: T.adminEmail, password: T.adminPassword },
          headers: { host: `${T.slug}.tenants.test` },
        });
        expect(login.body.status).toBe('authenticated');
        const otherHost = await new Client(hosted.app).request('POST', '/v1/auth/login', {
          body: { email: T.adminEmail, password: T.adminPassword },
          headers: { host: `${U.slug}.tenants.test` },
        });
        expect(otherHost.status).toBe(401); // the account does not exist in that tenant
        const conflict = await new Client(hosted.app).request('POST', '/v1/auth/login', {
          body: { email: T.adminEmail, password: T.adminPassword, tenant_slug: T.slug },
          headers: { host: `${U.slug}.tenants.test` },
        });
        expect(conflict.status).toBe(403);
      } finally {
        await hosted.app.close();
      }
    });
  });

  // ------------------------------------------------------------------------------ MFA bypass

  describe('MFA bypass attempts', () => {
    const mfaUser = async () => {
      const u = await createUser(app, A, 'viewer', 'bypass');
      const { secret, recoveryCodes } = await enrolMfa(u.client);
      const c = new Client(app);
      const step1 = await c.login(u.email, u.password);
      return { u, secret, recoveryCodes, c, challenge: step1.body.mfa.challenge_id as string };
    };

    it('gives no session before the second factor, and the challenge id is not a credential', async () => {
      const { c, challenge } = await mfaUser();
      expect(c.cookie).toBeUndefined();
      expect((await c.get('/v1/auth/me')).status).toBe(401);
      expect((await c.get('/v1/auth/me', { cookie: challenge })).status).toBe(401);
      expect(
        (
          await c.get('/v1/auth/me', {
            headers: { authorization: `Bearer ${challenge}` },
            cookie: false,
          })
        ).status,
      ).toBe(401);
      expect((await c.get('/v1/users', { cookie: challenge })).status).toBe(401);
    });

    it('rejects a replayed or wrong TOTP code, spent challenges, expired challenges and exhausted attempts', async () => {
      const { u, secret, c, challenge } = await mfaUser();
      const verify = (id: string, code: string, method = 'totp') =>
        c.post('/v1/auth/mfa/verify', { challenge_id: id, method, code });

      // A code from the step already used (at enrolment) is a replay.
      const replay = await verify(challenge, codeAt(secret, 0));
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('mfa-invalid-code');
      const good = await verify(challenge, codeAt(secret, 1));
      expect(good.status).toBe(200);
      // The challenge is single use.
      const spent = await verify(challenge, codeAt(secret, 1));
      expect(spent.status).toBe(401);
      expect(spent.body.code).toBe('mfa-challenge-expired');

      // The same code cannot be used twice in a row on a fresh challenge either.
      const c2 = new Client(app);
      const ch2 = (await c2.login(u.email, u.password)).body.mfa.challenge_id as string;
      const again = await c2.post('/v1/auth/mfa/verify', {
        challenge_id: ch2,
        method: 'totp',
        code: codeAt(secret, 1),
      });
      expect(again.status).toBe(401);

      // Attempts per challenge are bounded: after 5 wrong tries even the right code fails.
      await ownerSql(`delete from identity.auth_throttle where bucket like 'mfa:%'`);
      const ch3 = (await c2.login(u.email, u.password)).body.mfa.challenge_id as string;
      for (let i = 0; i < 5; i++) {
        expect(
          (
            await c2.post('/v1/auth/mfa/verify', {
              challenge_id: ch3,
              method: 'totp',
              code: '000000',
            })
          ).status,
        ).toBe(401);
      }
      await ownerSql(`delete from identity.auth_throttle where bucket like 'mfa:%'`);
      await ownerSql(`update identity.mfa_factor set last_used_step = null where user_id = $1`, [
        u.id,
      ]);
      const exhausted = await c2.post('/v1/auth/mfa/verify', {
        challenge_id: ch3,
        method: 'totp',
        code: codeAt(secret, 0),
      });
      expect(exhausted.status).toBe(401);
      expect(exhausted.body.code).toBe('mfa-challenge-expired');

      // Expired challenge.
      const ch4 = (await c2.login(u.email, u.password)).body.mfa.challenge_id as string;
      await ownerSql(
        `update identity.mfa_challenge set expires_at = now() - interval '1 second' where token_hash = $1`,
        [createHash('sha256').update(ch4).digest()],
      );
      const late = await c2.post('/v1/auth/mfa/verify', {
        challenge_id: ch4,
        method: 'totp',
        code: codeAt(secret, 0),
      });
      expect(late.body.code).toBe('mfa-challenge-expired');
      // Unknown challenge id.
      expect((await verify('q'.repeat(43), codeAt(secret, 0))).body.code).toBe(
        'mfa-challenge-expired',
      );
      // WebAuthn is not offered yet and never bypasses.
      const ch5 = (await c2.login(u.email, u.password)).body.mfa.challenge_id as string;
      expect(
        (
          await c2.post('/v1/auth/mfa/verify', {
            challenge_id: ch5,
            method: 'webauthn',
            code: '{}',
          })
        ).status,
      ).toBe(401);
    });

    it('throttles MFA guessing per account and answers 429 afterwards', async () => {
      const { u, c } = await mfaUser();
      for (let i = 0; i < 5; i++) {
        const ch = (await c.login(u.email, u.password)).body.mfa?.challenge_id;
        if (!ch) break;
        await c.post('/v1/auth/mfa/verify', { challenge_id: ch, method: 'totp', code: '000000' });
      }
      const ch = (await c.login(u.email, u.password)).body.mfa?.challenge_id as string | undefined;
      if (ch) {
        const res = await c.post('/v1/auth/mfa/verify', {
          challenge_id: ch,
          method: 'totp',
          code: '000000',
        });
        expect([401, 429]).toContain(res.status);
        if (res.status === 429) expect(res.body.code).toBe('account-locked');
      }
    });

    it('stores the TOTP secret encrypted, recovery codes hashed, the password argon2id-hashed', async () => {
      const u = await createUser(app, A, 'viewer', 'atrest');
      const { secret, recoveryCodes } = await enrolMfa(u.client);
      const factor = (
        await ownerSql(`select secret_encrypted from identity.mfa_factor where user_id = $1`, [
          u.id,
        ])
      ).rows[0];
      expect(Buffer.from(factor.secret_encrypted).includes(Buffer.from(secret))).toBe(false);
      const codes = (
        await ownerSql(`select code_hash from identity.mfa_recovery_code where user_id = $1`, [
          u.id,
        ])
      ).rows;
      expect(codes).toHaveLength(10);
      for (const code of recoveryCodes) {
        expect(codes.some((r) => Buffer.from(r.code_hash).toString('utf8').includes(code))).toBe(
          false,
        );
      }
      const cred = (
        await ownerSql(`select password_hash from identity.credential where user_id = $1`, [u.id])
      ).rows[0];
      expect(cred.password_hash).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
      expect(cred.password_hash).not.toContain(u.password);
    });
  });

  // ------------------------------------------------------------------- MFA enforcement (tenant)

  describe('tenant MFA enforcement', () => {
    it('limits a session until enrolment: only /me, logout and enrolment work, everything else is 403', async () => {
      const E = await createTenant(app, tenancy, 'Enforce');
      const viewer = await createUser(app, E, 'viewer', 'enf');
      await setMfaPolicy(E.tenantId, 'admins');

      // Admins are limited, viewers are not.
      const me = await E.admin.get('/v1/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.mfa_enrolment_required).toBe(true);
      expect((await viewer.client.get('/v1/auth/me')).body.mfa_enrolment_required).toBe(false);
      for (const url of ['/v1/users', '/v1/roles', '/v1/auth/sessions', '/v1/api-keys']) {
        const r = await E.admin.get(url);
        expect([r.status, r.body.code], url).toEqual([403, 'mfa-enrolment-required']);
      }
      expect(
        (
          await E.admin.post('/v1/users', {
            email: 'a@b.example',
            display_name: 'x',
            role_assignments: [{ role_id: E.roles.viewer }],
          })
        ).body.code,
      ).toBe('mfa-enrolment-required');
      expect((await viewer.client.get('/v1/roles')).status).toBe(403); // plain 403 (no permission), not the MFA code
      expect((await viewer.client.get('/v1/roles')).body.code).toBe('forbidden');

      // The invitation screen tells admins' invitees up front.
      const inv = await E.admin.post('/v1/users', {
        email: 'x@y.example',
        display_name: 'x',
        role_assignments: [{ role_id: E.roles.viewer }],
      });
      expect(inv.body.code).toBe('mfa-enrolment-required');

      // Enrolment lifts the limit.
      const { recoveryCodes } = await enrolMfa(E.admin);
      expect(recoveryCodes).toHaveLength(10);
      const after = await E.admin.get('/v1/auth/me');
      expect(after.body.mfa_enrolment_required).toBe(false);
      expect((await E.admin.get('/v1/users')).status).toBe(200);

      // Policy forbids turning it off again.
      const off = await E.admin.del('/v1/auth/mfa', { password: E.adminPassword });
      expect(off.status).toBe(403);
      expect(off.body.code).toBe('mfa-required-by-policy');
      // An admin reset forces re-enrolment at the next sign-in.
      const meId = after.body.user.id as string;
      const peer = await createUser(app, E, 'tenant_admin', 'peer');
      await enrolMfa(peer.client);
      expect((await E.admin.del(`/v1/users/${peer.id}/mfa`)).status).toBe(204);
      const relog = new Client(app);
      await relog.login(peer.email, peer.password);
      expect((await relog.get('/v1/auth/me')).body.mfa_enrolment_required).toBe(true);
      expect((await relog.get('/v1/users')).body.code).toBe('mfa-enrolment-required');
      expect(meId).toBeTruthy();
    });

    it('announces the MFA requirement on the invitation and limits a newly accepted admin', async () => {
      const E = await createTenant(app, tenancy, 'Enforce2');
      await setMfaPolicy(E.tenantId, 'all');
      const email = `adm-${uniq()}@${E.slug}.example`;
      // The creating admin is limited too under `all`: enrol first.
      await enrolMfa(E.admin);
      await E.admin.post('/v1/users', {
        email,
        display_name: 'N',
        role_assignments: [{ role_id: E.roles.viewer }],
      });
      const token = mailToken(mailsTo(email, 'auth.invitation')[0]!);
      const info = await new Client(app).get(`/v1/auth/invitations/${token}`);
      expect(info.body.mfa_enrolment_required).toBe(true);
      const c = new Client(app);
      const accepted = await c.post('/v1/auth/invitations/accept', {
        token,
        password: newPassword(),
        display_name: 'N',
      });
      c.csrf = accepted.body.csrf_token;
      const me = await c.get('/v1/auth/me');
      expect(me.body.mfa_enrolment_required).toBe(true);
      expect((await c.get('/v1/auth/sessions')).body.code).toBe('mfa-enrolment-required');
    });
  });

  // ---------------------------------------------------------------------------- reset / invitations

  describe('replayed and stale tokens', () => {
    it('expired reset tokens are 410 and leave the password unchanged; newer requests invalidate older links', async () => {
      const u = await createUser(app, A, 'viewer', 'tokens');
      await new Client(app).post('/v1/auth/password/forgot', { email: u.email });
      await app.get(AuthService).drain();
      const first = mailToken(mailsTo(u.email, 'auth.password-reset')[0]!);
      await ownerSql(
        `update identity.password_reset_token set expires_at = now() - interval '1 second' where user_id = $1`,
        [u.id],
      );
      const expired = await new Client(app).post('/v1/auth/password/reset', {
        token: first,
        password: newPassword(),
      });
      expect(expired.status).toBe(410);
      expect(expired.body.code).toBe('token-expired');
      expect((await new Client(app).login(u.email, u.password)).status).toBe(200);

      await new Client(app).post('/v1/auth/password/forgot', { email: u.email });
      await app.get(AuthService).drain();
      const second = mailToken(mailsTo(u.email, 'auth.password-reset')[1]!);
      await new Client(app).post('/v1/auth/password/forgot', { email: u.email });
      await app.get(AuthService).drain();
      const third = mailToken(mailsTo(u.email, 'auth.password-reset')[2]!);
      expect(
        (
          await new Client(app).post('/v1/auth/password/reset', {
            token: second,
            password: newPassword(),
          })
        ).body.code,
      ).toBe('token-invalid');
      expect(
        (
          await new Client(app).post('/v1/auth/password/reset', {
            token: third,
            password: newPassword(),
          })
        ).status,
      ).toBe(204);
      expect(
        (
          await new Client(app).post('/v1/auth/password/reset', {
            token: third,
            password: newPassword(),
          })
        ).status,
      ).toBe(404);
      // Garbage tokens are 404 too (same body as a spent one), and a reset token is not an invitation token.
      expect(
        (
          await new Client(app).post('/v1/auth/password/reset', {
            token: 'g'.repeat(43),
            password: newPassword(),
          })
        ).body.code,
      ).toBe('token-invalid');
      expect((await new Client(app).get(`/v1/auth/invitations/${third}`)).status).toBe(404);
    });

    it('stores reset and invitation tokens only as hashes', async () => {
      const u = await createUser(app, A, 'viewer', 'hashed');
      await new Client(app).post('/v1/auth/password/forgot', { email: u.email });
      await app.get(AuthService).drain();
      const token = mailToken(mailsTo(u.email, 'auth.password-reset')[0]!);
      const row = (
        await ownerSql(`select token_hash from identity.password_reset_token where user_id = $1`, [
          u.id,
        ])
      ).rows[0];
      expect(row.token_hash).toEqual(createHash('sha256').update(token).digest());
      const inv = (
        await ownerSql(
          `select count(*)::int as n from identity.invitation_token where token_hash = $1`,
          [Buffer.from(token)],
        )
      ).rows[0];
      expect(inv.n).toBe(0);
    });

    it('does not let a rejected password consume the invitation', async () => {
      const email = `rej-${uniq()}@${A.slug}.example`;
      await A.admin.post('/v1/users', {
        email,
        display_name: 'R',
        role_assignments: [{ role_id: A.roles.viewer }],
      });
      const token = mailToken(mailsTo(email, 'auth.invitation')[0]!);
      const bad = await new Client(app).post('/v1/auth/invitations/accept', {
        token,
        password: 'password1234',
        display_name: 'R',
      });
      expect(bad.status).toBe(422);
      expect(bad.body.errors[0].code).toBe('breached');
      expect(
        (
          await new Client(app).post('/v1/auth/invitations/accept', {
            token,
            password: 'x'.repeat(129),
            display_name: 'R',
          })
        ).body.errors[0].code,
      ).toBe('too-long');
      expect(
        (
          await new Client(app).post('/v1/auth/invitations/accept', {
            token,
            password: newPassword(),
            display_name: 'R',
          })
        ).status,
      ).toBe(200);
    });
  });

  // ------------------------------------------------------------------------------------ privileges

  describe('privilege escalation through the role endpoints', () => {
    it('denies user and API-key management to roles without the permission', async () => {
      for (const roleKey of ['asset_manager', 'technician', 'auditor', 'viewer']) {
        const u = await createUser(app, A, roleKey, `esc-${roleKey}`);
        const target = await A.admin.get(`/v1/users/${u.id}`);
        const body = {
          email: `e-${uniq()}@${A.slug}.example`,
          display_name: 'e',
          role_assignments: [{ role_id: A.roles.tenant_admin }],
        };
        expect((await u.client.post('/v1/users', body)).status, `${roleKey} create`).toBe(403);
        const self = await u.client.patch(
          `/v1/users/${u.id}`,
          { role_assignments: [{ role_id: A.roles.tenant_admin }] },
          { headers: { 'if-match': target.headers.etag as string } },
        );
        expect(self.status, `${roleKey} self-promote`).toBe(403);
        expect(
          (await u.client.post('/v1/api-keys', { name: 'k', scopes: ['asset:read'] })).status,
        ).toBe(403);
        expect((await u.client.del(`/v1/users/${u.id}/mfa`)).status).toBe(403);
        expect((await u.client.get(`/v1/users/${u.id}/sessions`)).status).toBe(403);
      }
    });

    it('stops a user manager from granting more than they hold or touching a more privileged user', async () => {
      // A custom role that can manage users but is not an administrator.
      const roleId = crypto.randomUUID();
      await ownerTenantSql(
        A.tenantId,
        `insert into app.role (id, tenant_id, key, name, permissions, is_builtin)
         values ($1, $2, $3, 'User manager', array['user:manage','user:read','role:read'], false)`,
        [roleId, A.tenantId, `user_manager_${uniq()}`],
      );
      const email = `mgr-${uniq()}@${A.slug}.example`;
      await A.admin.post('/v1/users', {
        email,
        display_name: 'Mgr',
        role_assignments: [{ role_id: roleId }],
      });
      const token = mailToken(mailsTo(email, 'auth.invitation')[0]!);
      const mgr = new Client(app);
      const accepted = await mgr.post('/v1/auth/invitations/accept', {
        token,
        password: newPassword(),
        display_name: 'Mgr',
      });
      mgr.csrf = accepted.body.csrf_token;
      const mgrId = accepted.body.user.id as string;

      // Cannot hand out the administrator role (more than they hold)...
      const grant = await mgr.post('/v1/users', {
        email: `g-${uniq()}@${A.slug}.example`,
        display_name: 'g',
        role_assignments: [{ role_id: A.roles.tenant_admin }],
      });
      expect(grant.status).toBe(403);
      // ...nor give themselves a technician role (permissions they lack).
      const me = await mgr.get(`/v1/users/${mgrId}`);
      const self = await mgr.patch(
        `/v1/users/${mgrId}`,
        { role_assignments: [{ role_id: roleId }, { role_id: A.roles.technician }] },
        { headers: { 'if-match': me.headers.etag as string } },
      );
      expect(self.status).toBe(403);
      // They can create a user with a subset of their own permissions (user:read + role:read only)...
      const adminId = (await A.admin.get('/v1/auth/me')).body.user.id as string;
      // ...but cannot touch an administrator: edit, archive, reset MFA, revoke sessions.
      const adm = await mgr.get(`/v1/users/${adminId}`);
      expect(
        (
          await mgr.patch(
            `/v1/users/${adminId}`,
            { display_name: 'pwned' },
            { headers: { 'if-match': adm.headers.etag as string } },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await mgr.del(`/v1/users/${adminId}`, undefined, {
            headers: { 'if-match': adm.headers.etag as string },
          })
        ).status,
      ).toBe(403);
      expect((await mgr.del(`/v1/users/${adminId}/mfa`)).status).toBe(403);
      expect((await mgr.get(`/v1/users/${adminId}/sessions`)).status).toBe(403);
      expect((await A.admin.get('/v1/auth/me')).status).toBe(200);
    });

    it('protects the last active administrator and the actor themselves', async () => {
      const L = await createTenant(app, tenancy, 'Last');
      const me = await L.admin.get('/v1/auth/me');
      const id = me.body.user.id as string;
      const cur = await L.admin.get(`/v1/users/${id}`);
      const etag = { headers: { 'if-match': cur.headers.etag as string } };
      for (const patch of [
        { status: 'disabled' },
        { role_assignments: [{ role_id: L.roles.viewer }] },
      ]) {
        const res = await L.admin.patch(`/v1/users/${id}`, patch, etag);
        expect(res.status, JSON.stringify(patch)).toBe(409);
        expect(res.body.code).toBe('conflict');
      }
      expect((await L.admin.del(`/v1/users/${id}`, undefined, etag)).status).toBe(409);
      // With a second administrator the first can step down.
      const second = await createUser(app, L, 'tenant_admin', 'second');
      const res = await L.admin.patch(
        `/v1/users/${id}`,
        { role_assignments: [{ role_id: L.roles.viewer }] },
        etag,
      );
      expect(res.status).toBe(200);
      // ...and now the second one is the last.
      const sCur = await second.client.get(`/v1/users/${second.id}`);
      const last = await second.client.patch(
        `/v1/users/${second.id}`,
        { status: 'disabled' },
        { headers: { 'if-match': sCur.headers.etag as string } },
      );
      expect(last.status).toBe(409);
    });

    it('rejects secret-bearing operations that carry an Idempotency-Key and unsupported scopes', async () => {
      const u = await createUser(app, A, 'viewer', 'idem');
      const res = await u.client.post(
        '/v1/auth/mfa/enrol',
        {},
        { headers: { 'idempotency-key': 'k'.repeat(16) } },
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('idempotency-key-invalid');
      const loc = await A.admin.post('/v1/users', {
        email: `loc-${uniq()}@${A.slug}.example`,
        display_name: 'l',
        role_assignments: [
          { role_id: A.roles.viewer, scope_type: 'location', location_id: crypto.randomUUID() },
        ],
      });
      expect(loc.status).toBe(422);
    });
  });

  it('writes audit entries for the security events inside the tenant transaction', () => {
    const actions = new Set(testPorts.audit.actions());
    for (const expected of [
      'auth.login.succeeded',
      'auth.mfa.enabled',
      'auth.mfa.reset',
      'auth.password.reset',
      'user.invited',
      'user.created',
      'invitation.accepted',
    ]) {
      expect(actions, expected).toContain(expected);
    }
    expect(freshIp()).toBeTruthy();
    expect(COOKIE).toBe('__Host-at_session');
  });
});
