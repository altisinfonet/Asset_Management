import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  COOKIE,
  COOKIE_INSECURE,
  createTenant,
  createUser,
  dbEnabled,
  newTenancy,
  startApp,
  type TenantFixture,
} from './support.js';

/**
 * ED-30: with SESSION_COOKIE_SECURE=false (local development over plain HTTP from a LAN address) the
 * session cookie is `at_session` without `Secure`; the session, the CSRF check and logout work as usual,
 * and the cookie of the other mode is not accepted.
 */
describe.skipIf(!dbEnabled)('session cookie without Secure (SESSION_COOKIE_SECURE=false)', () => {
  const tenancy = newTenancy();
  let app: NestFastifyApplication;
  let T: TenantFixture;

  beforeAll(async () => {
    ({ app } = await startApp({ SESSION_COOKIE_SECURE: 'false' }));
    T = await createTenant(app, tenancy, 'PlainCookie');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
  });

  it('sets at_session with HttpOnly, SameSite=Lax, Path=/ and no Secure, no __Host- prefix, no Domain', async () => {
    const u = await createUser(app, T, 'viewer', 'plain');
    const c = new Client(app);
    const res = await c.login(u.email, u.password);
    expect(res.status).toBe(200);
    const header = String(res.headers['set-cookie']);
    expect(header).toMatch(/^at_session=[A-Za-z0-9_-]{40,}/);
    expect(header).not.toMatch(/__Host-/);
    expect(header).not.toMatch(/Secure/i);
    for (const attr of [/;\s*HttpOnly/, /;\s*SameSite=Lax/, /;\s*Path=\//, /;\s*Max-Age=\d+/]) {
      expect(header).toMatch(attr);
    }
    expect(header).not.toMatch(/Domain=/i);
    expect(c.cookieName).toBe(COOKIE_INSECURE);
  });

  it('keeps the session working: me, CSRF on mutations, logout clears the cookie', async () => {
    const u = await createUser(app, T, 'viewer', 'plain2');
    const c = new Client(app);
    await c.login(u.email, u.password);
    const me = await c.get('/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(u.email);

    // The CSRF token is still required on cookie-authenticated mutations.
    const noCsrf = await c.post('/v1/auth/logout', {}, { csrf: false });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.code).toBe('csrf-invalid');
    const out = await c.post('/v1/auth/logout');
    expect(out.status).toBe(204);
    const cleared = String(out.headers['set-cookie']);
    expect(cleared).toMatch(/^at_session=;/);
    expect(cleared).toMatch(/Max-Age=0/);
    expect(cleared).not.toMatch(/Secure/i);
    expect((await c.get('/v1/auth/me')).status).toBe(401);
  });

  it('accepts only the cookie name of the active mode', async () => {
    const u = await createUser(app, T, 'viewer', 'plain3');
    const token = u.client.token!;
    expect((await u.client.get('/v1/auth/me')).status).toBe(200);
    // the secure-mode name carrying a valid token is ignored: no credential, so 401
    const wrongName = await new Client(app).get('/v1/auth/me', { cookie: `${COOKIE}=${token}` });
    expect(wrongName.status).toBe(401);
  });
});
