import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/auth/auth.service.js';
import { generateMasterKey } from '../../src/crypto/index.js';
import {
  Client,
  createTenant,
  dbEnabled,
  enrolMfa,
  newTenancy,
  ownerTenantSql,
  startApp,
  type TenantFixture,
} from './support.js';

/**
 * Auth against the REAL platform ports (no capturing fakes): every auth mail must be queued through
 * `QueuedMailSender` INSIDE a tenant transaction (ADR 0004), i.e. as an encrypted `app.mail_outbox`
 * row, and the audit rows and the TOTP secret go through the real writer and SecretBox. A mail sent
 * outside `withTenantTx` would throw `NoTenantTransactionError` and fail these requests.
 */
describe.skipIf(!dbEnabled)('auth with the platform ports', () => {
  const tenancy = newTenancy();
  let app: NestFastifyApplication;
  let T: TenantFixture;

  const queued = async (template: string, tenantId = T.tenantId): Promise<number> => {
    const r = await ownerTenantSql(
      tenantId,
      `select count(*)::int as n from app.mail_outbox where template = $1`,
      [template],
    );
    return r.rows[0].n as number;
  };

  beforeAll(async () => {
    ({ app } = await startApp({ MASTER_KEY: generateMasterKey() }, { realPorts: true }));
    T = await createTenant(app, tenancy, 'RealPorts');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
  });

  it('queues the invitation mail when a user is created with send_invite and again on resend', async () => {
    const email = `real-${Date.now()}@${T.slug}.example`;
    const created = await T.admin.post('/v1/users', {
      email,
      display_name: 'Real Invitee',
      role_assignments: [{ role_id: T.roles.technician }],
    });
    expect(created.status).toBe(201);
    expect(await queued('auth.invitation')).toBe(1);

    const resent = await T.admin.post(`/v1/users/${created.body.id}/invitation/resend`, {});
    expect(resent.status).toBe(204);
    expect(await queued('auth.invitation')).toBe(2);
  });

  it('rolls the mail back with the request: a rejected create queues nothing', async () => {
    const before = await queued('auth.invitation');
    const dup = await T.admin.post('/v1/users', {
      email: T.adminEmail,
      display_name: 'Dup',
      role_assignments: [{ role_id: T.roles.technician }],
    });
    expect(dup.status).toBe(409);
    expect(await queued('auth.invitation')).toBe(before);
  });

  it('queues the password-reset mail (tenant resolved first, mail inside the tenant tx)', async () => {
    const before = await queued('auth.password-reset');
    const res = await new Client(app).post('/v1/auth/password/forgot', { email: T.adminEmail });
    expect(res.status).toBe(202);
    await app.get(AuthService).drain();
    expect(await queued('auth.password-reset')).toBe(before + 1);
  });

  it('audits the actor type: a user session writes actor_type user, an API key writes api_key', async () => {
    const email = `actor-${Date.now()}@${T.slug}.example`;
    const byUser = await T.admin.post('/v1/users', {
      email,
      display_name: 'By user',
      role_assignments: [{ role_id: T.roles.viewer }],
    });
    expect(byUser.status).toBe(201);

    const key = await T.admin.post('/v1/api-keys', { name: 'actor', scopes: ['user:manage'] });
    expect(key.status).toBe(201);
    const byKey = await new Client(app).post(
      `/v1/users/${byUser.body.id}/invitation/resend`,
      {},
      {
        headers: { authorization: `Bearer ${key.body.secret}` },
        cookie: false,
        csrf: false,
      },
    );
    expect(byKey.status, byKey.raw).toBe(204);

    const rows = await ownerTenantSql(
      T.tenantId,
      `select action, actor_type, actor_user_id, actor_ref from app.audit_log
        where entity_id = $1::uuid and action in ('user.created', 'invitation.resent')`,
      [byUser.body.id],
    );
    const row = (action: string) => rows.rows.find((r) => r.action === action);
    expect(row('user.created')).toMatchObject({ actor_type: 'user', actor_ref: null });
    expect(row('user.created').actor_user_id).not.toBeNull();
    expect(row('invitation.resent')).toMatchObject({
      actor_type: 'api_key',
      actor_user_id: null,
      actor_ref: key.body.id,
    });
  });

  it('queues the mfa-enabled mail and stores the TOTP secret through the real SecretBox', async () => {
    const before = await queued('auth.mfa-enabled');
    const client = new Client(app);
    const login = await client.login(T.adminEmail, T.adminPassword);
    expect(login.status).toBe(200);
    await enrolMfa(client);
    expect(await queued('auth.mfa-enabled')).toBe(before + 1);
    // The TOTP secret is a SecretBox envelope, never the raw base32 secret.
    const factor = await ownerTenantSql(
      T.tenantId,
      `select count(*)::int as n from identity.mfa_factor where secret_encrypted is not null and confirmed_at is not null`,
    );
    expect(factor.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});
