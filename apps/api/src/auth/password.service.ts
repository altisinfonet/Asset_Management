import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import type { FieldError } from '../platform/index.js';
import { BREACHED_PASSWORD_LIST } from './data/breached-passwords.js';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
/** `Algorithm.Argon2id` (a `const enum` in the package typings, so the literal is used). */
const ARGON2ID = 2;

export type PasswordViolation = 'too-short' | 'too-long' | 'breached';

/** NFKC-normalised, so the same visible password always hashes the same (policy: NFKC, no trimming). */
export const normalisePassword = (password: string): string => password.normalize('NFKC');

/**
 * Passwords (M1-AUTH-02): argon2id with OWASP-minimum parameters (m=19 MiB, t=2, p=1, configurable),
 * a length-only policy (12-128 code points, no composition rules) and a breached-password check
 * against the bundled list, plus an optional online k-anonymity provider.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private local?: Set<string>;
  private dummyHash?: Promise<string>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private options() {
    return {
      algorithm: ARGON2ID,
      memoryCost: this.config.ARGON2_MEMORY_KIB,
      timeCost: this.config.ARGON2_TIME_COST,
      parallelism: this.config.ARGON2_PARALLELISM,
    } as const;
  }

  async hash(password: string): Promise<string> {
    return argon2Hash(normalisePassword(password), this.options());
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await argon2Verify(passwordHash, normalisePassword(password));
    } catch {
      return false; // a malformed stored hash never authenticates
    }
  }

  /**
   * Burns the same CPU as a real verification against a hash made with the CURRENT parameters, for
   * unknown accounts (timing parity). Always returns false.
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= argon2Hash('dummy-password-for-timing-parity', this.options());
    await argon2Verify(await this.dummyHash, normalisePassword(password)).catch(() => false);
    return false;
  }

  /** The documented policy (`GET /v1/auth/password-policy`). */
  policy() {
    const sources: Array<'local_list' | 'online_k_anonymity'> = ['local_list'];
    if (this.config.BREACHED_PASSWORD_ONLINE) sources.push('online_k_anonymity');
    return {
      min_length: PASSWORD_MIN_LENGTH,
      max_length: PASSWORD_MAX_LENGTH,
      composition_rules: false,
      breached_check: { enabled: true, sources },
      rejection_codes: ['too-short', 'too-long', 'breached'] as PasswordViolation[],
    };
  }

  /** First violation of the policy, or null when the password is acceptable. */
  async validate(password: string): Promise<PasswordViolation | null> {
    const normalised = normalisePassword(password);
    const length = [...normalised].length;
    if (length < PASSWORD_MIN_LENGTH) return 'too-short';
    if (length > PASSWORD_MAX_LENGTH) return 'too-long';
    if (await this.isBreached(normalised)) return 'breached';
    return null;
  }

  /** `errors[]` entries for a 422 (pointer `/password`). */
  static fieldError(violation: PasswordViolation): FieldError {
    const message = {
      'too-short': `The password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      'too-long': `The password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
      breached:
        'This password appears in a list of breached or commonly used passwords. Choose another.',
    }[violation];
    return { pointer: '/password', message, code: violation };
  }

  isBreachedLocally(normalisedPassword: string): boolean {
    this.local ??= new Set(BREACHED_PASSWORD_LIST.split('\n'));
    return this.local.has(normalisedPassword.toLowerCase());
  }

  private async isBreached(normalisedPassword: string): Promise<boolean> {
    if (this.isBreachedLocally(normalisedPassword)) return true;
    if (!this.config.BREACHED_PASSWORD_ONLINE) return false;
    return this.isBreachedOnline(normalisedPassword);
  }

  /**
   * Have I Been Pwned range API: only the first 5 hex characters of the SHA-1 leave the server. A
   * network failure never blocks a password change (fail open, logged).
   */
  private async isBreachedOnline(password: string): Promise<boolean> {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const response = await fetch(`${this.config.BREACHED_PASSWORD_API_URL}/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) return false;
      const body = await response.text();
      return body.split(/\r?\n/).some((line) => {
        const [candidate, count] = line.split(':');
        return candidate === suffix && Number(count) > 0;
      });
    } catch (err) {
      this.logger.warn(`online breached-password check unavailable: ${String(err)}`);
      return false;
    }
  }
}
