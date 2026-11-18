import { hash } from '@node-rs/argon2';
import { uuidv7 } from '../ids/uuidv7.js';
import type { SecretBox } from '../ports/index.js';
import { asBytes, type TenancyService } from '../tenancy/index.js';
import { hashRecoveryCode, RECOVERY_CODE_COUNT } from './mfa.service.js';
import { base32Decode } from './totp.js';

/** Dev/demo only (the seed refuses production): everyone signs in with this password unless overridden. */
export const DEMO_PASSWORD = 'Demo-Passw0rd-2026';
/** The demo Owners' TOTP secret (base32): add it to any authenticator app, or compute codes from it in tests. */
export const DEMO_OWNER_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/** Demo tenants of the seed; each one's users are `<name>@<slug>.example`. */
export const DEMO_SLUGS = ['acme', 'globex'] as const;
const ARGON2ID = 2;

export interface DemoLoginsResult {
  password: string;
  totpSecret: string;
  /** Per tenant slug: the users that received a credential in this call (already-set ones are left alone). */
  credentialed: Record<string, string[]>;
  mfaEnrolled: string[];
}

/**
 * Gives the demo users of `seedDemoData` a way to sign in (M1-AUTH-04: "seed users include one
 * MFA-enrolled Owner for demos"): a password credential for every demo user, and a confirmed TOTP
 * factor (known secret, recovery codes generated and thrown away) for each tenant's Owner. Idempotent:
 * a user that already has a credential is untouched. Runs inside each tenant's transaction.
 */
export async function seedDemoLogins(
  tenancy: TenancyService,
  opts: { secretBox: SecretBox; password?: string; slugs?: readonly string[] },
): Promise<DemoLoginsResult> {
  const password = opts.password ?? DEMO_PASSWORD;
  const passwordHash = await hash(password.normalize('NFKC'), { algorithm: ARGON2ID });
  const result: DemoLoginsResult = {
    password,
    totpSecret: DEMO_OWNER_TOTP_SECRET,
    credentialed: {},
    mfaEnrolled: [],
  };

  const tenants = await tenancy.withPreTenantTx((trx) =>
    trx.tenant_directory.findMany({ where: { slug: { in: [...(opts.slugs ?? DEMO_SLUGS)] } } }),
  );
  for (const tenant of tenants) {
    const domain = `${tenant.slug}.example`;
    await tenancy.withTenantTx({ tenantId: tenant.tenant_id }, async (trx) => {
      const users = await trx.user_account.findMany({
        where: { email: { endsWith: `@${domain}` }, archived_at: null },
      });
      for (const user of users) {
        if (user.status !== 'active') continue;
        const has = await trx.credential.count({ where: { user_id: user.id } });
        if (has === 0) {
          await trx.credential.create({
            data: { tenant_id: tenant.tenant_id, user_id: user.id, password_hash: passwordHash },
          });
          (result.credentialed[tenant.slug] ??= []).push(user.email);
        }
        if (user.email === `owner@${domain}` && !user.mfa_enabled) {
          const secret = base32Decode(DEMO_OWNER_TOTP_SECRET);
          const ciphertext = await opts.secretBox.encrypt(
            secret,
            `mfa-totp:${tenant.tenant_id}:${user.id}`,
          );
          await trx.mfa_factor.deleteMany({ where: { user_id: user.id } });
          await trx.mfa_factor.create({
            data: {
              id: uuidv7(),
              tenant_id: tenant.tenant_id,
              user_id: user.id,
              type: 'totp',
              label: 'Demo authenticator',
              secret_encrypted: asBytes(ciphertext),
              confirmed_at: new Date(),
            },
          });
          await trx.mfa_recovery_code.deleteMany({ where: { user_id: user.id } });
          await trx.mfa_recovery_code.createMany({
            data: Array.from({ length: RECOVERY_CODE_COUNT }, (_, i) => ({
              id: uuidv7(),
              tenant_id: tenant.tenant_id,
              user_id: user.id,
              code_hash: asBytes(hashRecoveryCode(`DEMO-${tenant.slug}-${i}-${uuidv7()}`)),
            })),
          });
          await trx.user_account.update({ where: { id: user.id }, data: { mfa_enabled: true } });
          result.mfaEnrolled.push(user.email);
        }
      }
    });
  }
  return result;
}
