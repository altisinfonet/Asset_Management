import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_OWNER_TOTP_SECRET,
  DEMO_PASSWORD,
  seedDemoLogins,
} from '../../src/auth/demo-credentials.js';
import { base32Decode } from '../../src/auth/totp.js';
import { bootstrapTenant, addUser } from '../../src/bootstrap/bootstrap-tenant.js';
import {
  Client,
  codeAt,
  dbEnabled,
  newTenancy,
  ownerTenantSql,
  startApp,
  testPorts,
  uniq,
} from './support.js';

/** M1-AUTH-04: "seed users include one MFA-enrolled Owner for demos". Uses its own tenant (`<slug>.example` users). */
describe.skipIf(!dbEnabled)('demo logins from the seed', () => {
  const tenancy = newTenancy();
  let app: NestFastifyApplication;
  beforeAll(async () => {
    ({ app } = await startApp());
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
  });

  it('gives every demo user a password, and the Owner an enrolled authenticator', async () => {
    const slug = `demo-${uniq()}`;
    const boot = await bootstrapTenant(tenancy, {
      name: 'Demo',
      slug,
      adminEmail: `owner@${slug}.example`,
      adminName: 'Demo Owner',
    });
    await tenancy.withTenantTx({ tenantId: boot.tenantId }, async (trx) => {
      await trx.user_account.updateMany({
        where: { email: `owner@${slug}.example` },
        data: { status: 'active' },
      });
      await addUser(trx, boot.tenantId, {
        email: `viewer@${slug}.example`,
        displayName: 'V',
        roleKey: 'viewer',
        status: 'active',
      });
    });

    const first = await seedDemoLogins(tenancy, { secretBox: testPorts.secretBox, slugs: [slug] });
    expect(first.credentialed[slug]?.sort()).toEqual([
      `owner@${slug}.example`,
      `viewer@${slug}.example`,
    ]);
    expect(first.mfaEnrolled).toEqual([`owner@${slug}.example`]);
    // Idempotent: nothing changes the second time.
    const second = await seedDemoLogins(tenancy, { secretBox: testPorts.secretBox, slugs: [slug] });
    expect(second.credentialed[slug]).toBeUndefined();
    expect(second.mfaEnrolled).toEqual([]);

    const viewer = new Client(app);
    expect((await viewer.login(`viewer@${slug}.example`, DEMO_PASSWORD)).body.status).toBe(
      'authenticated',
    );

    const owner = new Client(app);
    const step1 = await owner.login(`owner@${slug}.example`, DEMO_PASSWORD);
    expect(step1.body.status).toBe('mfa_required');
    const done = await owner.post('/v1/auth/mfa/verify', {
      challenge_id: step1.body.mfa.challenge_id,
      method: 'totp',
      code: codeAt(base32Decode(DEMO_OWNER_TOTP_SECRET), 0),
    });
    expect(done.body.status).toBe('authenticated');
    owner.csrf = done.body.csrf_token;
    const me = await owner.get('/v1/auth/me');
    expect(me.body.auth.mfa_verified).toBe(true);
    expect(me.body.permissions).toContain('*');
    const rows = await ownerTenantSql(
      boot.tenantId,
      `select mfa_enabled from app.user_account where email = $1`,
      [`owner@${slug}.example`],
    );
    expect(rows.rows[0].mfa_enabled).toBe(true);
  });
});
