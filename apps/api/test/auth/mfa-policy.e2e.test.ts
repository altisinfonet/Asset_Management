import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mode } from '../support/db.js';
import {
  type App,
  type TenantFixture,
  contractViolations,
  createTenant,
  createUser,
  newTenancy,
  startRegistryApp,
} from '../lifecycle/support.js';
import { dbEnabled, enrolMfa, setMfaPolicy } from './support.js';

/**
 * M2-AUTH-01: `GET /v1/auth/me` tells the client whether the organisation enforces two-step
 * verification and whether that applies to the caller, so the Security page can hide "Turn off"
 * instead of explaining the policy after a 403.
 */
describe.skipIf(!dbEnabled)(`mfa policy in /auth/me (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'mfapolicy');
    other = await createTenant(app, tenancy, 'mfapolicy2');
  });
  // a failed case must not leave a policy behind that limits the next one
  afterEach(() => setMfaPolicy(t.tenantId, 'off'));
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const policy = async (client: TenantFixture['admin']) =>
    (await client.get('/v1/auth/me')).body.mfa_policy;

  it('is off by default for everybody', async () => {
    const viewer = await createUser(app, t, 'viewer');
    expect(await policy(t.admin)).toEqual({ required: false, scope: 'off' });
    expect(await policy(viewer.client)).toEqual({ required: false, scope: 'off' });
  });

  it('"admins" applies to roles that hold * or user:manage, "all" to everybody', async () => {
    const viewer = await createUser(app, t, 'viewer');
    const manager = await createUser(app, t, 'asset_manager');
    await setMfaPolicy(t.tenantId, 'admins');
    expect(await policy(t.admin)).toEqual({ required: true, scope: 'admins' });
    expect(await policy(viewer.client)).toEqual({ required: false, scope: 'admins' });
    expect(await policy(manager.client)).toEqual({ required: false, scope: 'admins' });
    await setMfaPolicy(t.tenantId, 'all');
    expect(await policy(viewer.client)).toEqual({ required: true, scope: 'all' });
    expect(await policy(manager.client)).toEqual({ required: true, scope: 'all' });
    await setMfaPolicy(t.tenantId, 'off');
    expect(await policy(t.admin)).toEqual({ required: false, scope: 'off' });
  });

  it("is the policy of the caller's own organisation", async () => {
    await setMfaPolicy(t.tenantId, 'all');
    expect(await policy(other.admin)).toEqual({ required: false, scope: 'off' });
    await setMfaPolicy(t.tenantId, 'off');
  });

  it('never "required" for an API key, but the scope is still shown', async () => {
    const key = await t.admin.post('/v1/api-keys', { name: 'k', scopes: ['asset:read'] });
    await setMfaPolicy(t.tenantId, 'all');
    const me = await t.admin.clone().get('/v1/auth/me', {
      headers: { authorization: `Bearer ${key.body.secret}` },
      cookie: false,
    });
    expect(me.status).toBe(200);
    expect(me.body.mfa_policy).toEqual({ required: false, scope: 'all' });
    await setMfaPolicy(t.tenantId, 'off');
  });

  it('agrees with what "Turn off" does: required means the disable is refused by policy', async () => {
    const viewer = await createUser(app, t, 'viewer');
    await enrolMfa(viewer.client);
    await setMfaPolicy(t.tenantId, 'all');
    expect((await viewer.client.get('/v1/auth/me')).body.mfa_policy.required).toBe(true);
    const refused = await viewer.client.del('/v1/auth/mfa', { password: viewer.password });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('mfa-required-by-policy');
    await setMfaPolicy(t.tenantId, 'off');
    expect((await viewer.client.get('/v1/auth/me')).body.mfa_policy.required).toBe(false);
    expect((await viewer.client.del('/v1/auth/mfa', { password: viewer.password })).status).toBe(
      204,
    );
  });
});
