import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { SECRET_BOX, type SecretBox } from '../ports/index.js';
import { asBytes, type Tx } from '../tenancy/index.js';
import { authProblem } from './problems.js';
import { base32Encode, generateTotpSecret, matchTotp, otpauthUri } from './totp.js';

export const RECOVERY_CODE_COUNT = 10;
/** Unambiguous alphabet (no 0/O/1/I/L): 16 characters = 80 bits per recovery code. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const hashRecoveryCode = (code: string): Buffer =>
  createHash('sha256').update(code.toUpperCase().replace(/[\s-]/g, '')).digest();

function newRecoveryCode(): string {
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]!);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

/**
 * TOTP second factor (M1-AUTH-04): enrolment (secret envelope-encrypted through SECRET_BOX),
 * verification with replay protection, recovery codes (10, stored hashed), removal. Methods take the
 * caller's tenant transaction so every change commits together with its audit entry.
 */
@Injectable()
export class MfaService {
  constructor(
    @Inject(SECRET_BOX) private readonly secretBox: SecretBox,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Binds the ciphertext to its owner: copied to another user or tenant it no longer decrypts. */
  private context(tenantId: string, userId: string): string {
    return `mfa-totp:${tenantId}:${userId}`;
  }

  /** The user has an ACTIVE (confirmed) TOTP factor. */
  async hasActiveFactor(trx: Tx, userId: string): Promise<boolean> {
    return (
      (await trx.mfa_factor.count({
        where: { user_id: userId, type: 'totp', confirmed_at: { not: null } },
      })) > 0
    );
  }

  /** Creates (or replaces) the pending factor; returns what the QR code encodes. */
  async startEnrolment(
    trx: Tx,
    user: { id: string; tenantId: string; email: string },
  ): Promise<{ secret: string; provisioning_uri: string }> {
    if (await this.hasActiveFactor(trx, user.id)) throw authProblem.mfaAlreadyEnrolled();
    const secret = generateTotpSecret();
    const ciphertext = await this.secretBox.encrypt(secret, this.context(user.tenantId, user.id));
    await trx.mfa_factor.deleteMany({
      where: { user_id: user.id, type: 'totp', confirmed_at: null },
    });
    await trx.mfa_factor.create({
      data: {
        id: uuidv7(),
        tenant_id: user.tenantId,
        user_id: user.id,
        type: 'totp',
        label: 'Authenticator app',
        secret_encrypted: asBytes(ciphertext),
      },
    });
    return {
      secret: base32Encode(secret),
      provisioning_uri: otpauthUri({
        secret,
        account: user.email,
        issuer: this.config.TOTP_ISSUER,
      }),
    };
  }

  /**
   * Checks a TOTP code against the user's factor. A code of a step at or before the last accepted
   * one is rejected (replay inside the window). `pending` verifies the not-yet-active factor
   * (enrolment confirmation).
   */
  async verifyTotp(
    trx: Tx,
    user: { id: string; tenantId: string },
    code: string,
    which: 'active' | 'pending',
  ): Promise<boolean> {
    const factor = await trx.mfa_factor.findFirst({
      where: {
        user_id: user.id,
        type: 'totp',
        confirmed_at: which === 'active' ? { not: null } : null,
      },
      orderBy: { created_at: 'desc' },
    });
    if (!factor?.secret_encrypted) return false;
    const secret = await this.secretBox.decrypt(
      new Uint8Array(factor.secret_encrypted),
      this.context(user.tenantId, user.id),
    );
    const step = matchTotp(secret, code);
    if (step === null) return false;
    const claimed = await trx.mfa_factor.updateMany({
      where: {
        id: factor.id,
        OR: [{ last_used_step: null }, { last_used_step: { lt: BigInt(step) } }],
      },
      data: { last_used_step: BigInt(step), last_used_at: new Date() },
    });
    return claimed.count === 1;
  }

  /** Activates the pending factor and issues the recovery codes (returned once). */
  async activate(trx: Tx, user: { id: string; tenantId: string }): Promise<string[]> {
    await trx.mfa_factor.updateMany({
      where: { user_id: user.id, type: 'totp', confirmed_at: null },
      data: { confirmed_at: new Date() },
    });
    await trx.user_account.update({ where: { id: user.id }, data: { mfa_enabled: true } });
    return this.replaceRecoveryCodes(trx, user);
  }

  async hasPendingFactor(trx: Tx, userId: string): Promise<boolean> {
    return (
      (await trx.mfa_factor.count({
        where: { user_id: userId, type: 'totp', confirmed_at: null },
      })) > 0
    );
  }

  /** Deletes every recovery code (used or not) and creates ten new ones; returns them in clear, once. */
  async replaceRecoveryCodes(trx: Tx, user: { id: string; tenantId: string }): Promise<string[]> {
    await trx.mfa_recovery_code.deleteMany({ where: { user_id: user.id } });
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => newRecoveryCode());
    await trx.mfa_recovery_code.createMany({
      data: codes.map((c) => ({
        id: uuidv7(),
        tenant_id: user.tenantId,
        user_id: user.id,
        code_hash: asBytes(hashRecoveryCode(c)),
      })),
    });
    return codes;
  }

  /** Single use: true when the code existed and was unused (it is now spent). */
  async consumeRecoveryCode(
    trx: Tx,
    user: { id: string; tenantId: string },
    code: string,
  ): Promise<boolean> {
    const result = await trx.mfa_recovery_code.updateMany({
      where: {
        tenant_id: user.tenantId,
        user_id: user.id,
        code_hash: asBytes(hashRecoveryCode(code)),
        used_at: null,
      },
      data: { used_at: new Date() },
    });
    return result.count === 1;
  }

  /** Removes the factor and every recovery code (disable, admin reset). */
  async removeAll(trx: Tx, userId: string): Promise<void> {
    await trx.mfa_factor.deleteMany({ where: { user_id: userId } });
    await trx.mfa_recovery_code.deleteMany({ where: { user_id: userId } });
    await trx.user_account.update({ where: { id: userId }, data: { mfa_enabled: false } });
  }
}
