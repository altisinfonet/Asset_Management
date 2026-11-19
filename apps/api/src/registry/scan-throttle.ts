import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type AuthContext, ThrottleService } from '../auth/index.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { ApiProblem } from '../platform/index.js';

/**
 * Enumeration resistance for `GET /v1/scan/resolve` (M2-TAG-01). The `label_code` is 128 random bits
 * and a tag is guessable by design, so a caller who is signed in could still probe codes. Only
 * MISSES count: a caller whose lookups keep failing (`SCAN_RESOLVE_MAX_MISSES` per throttle window,
 * per principal) is answered `429 too-many-requests` with `Retry-After` for the rest of the window,
 * before any lookup happens, so a blocked caller learns nothing more, not even hit versus miss.
 * Normal scanning (hits) is never limited. Counters live in the shared throttle table, so every API
 * replica applies the same limit.
 */
@Injectable()
export class ScanResolveThrottle {
  private readonly max: number;

  constructor(
    private readonly throttle: ThrottleService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.max = config.SCAN_RESOLVE_MAX_MISSES;
  }

  private bucket(auth: AuthContext): string {
    return createHash('sha256')
      .update(`scan-miss:${auth.tenantId}:${auth.principalId}`)
      .digest('hex')
      .slice(0, 32);
  }

  /** Throws 429 when this caller already used up its misses in the current window. */
  async assertAllowed(auth: AuthContext): Promise<void> {
    const retryAfter = await this.throttle.blockedFor(this.bucket(auth), this.max);
    if (retryAfter > 0) {
      throw new ApiProblem({
        code: 'too-many-requests',
        detail: 'Too many codes that do not match an asset. Try again later.',
        headers: { 'Retry-After': String(retryAfter) },
      });
    }
  }

  async recordMiss(auth: AuthContext): Promise<void> {
    await this.throttle.hit(this.bucket(auth));
  }
}
