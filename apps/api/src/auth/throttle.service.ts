import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { TenancyService } from '../tenancy/index.js';

/** Hash used in bucket names, so the throttle table never holds an email address. */
export const bucketKey = (value: string): string =>
  createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32);

/**
 * Fixed-window counters in `identity.auth_throttle` (M1-AUTH-02). The backlog names Redis; there is
 * no Redis in the M1 stack, so the counters live in PostgreSQL behind this one service and Redis can
 * replace it without touching callers. Used for failed logins per account and per IP, MFA attempts,
 * password-reset requests and invitation lookups. A window is `AUTH_THROTTLE_WINDOW_MINUTES`; the
 * lockout lasts until the window ends.
 */
@Injectable()
export class ThrottleService {
  private readonly windowMs: number;

  constructor(
    private readonly tenancy: TenancyService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.windowMs = config.AUTH_THROTTLE_WINDOW_MINUTES * 60_000;
  }

  private window(now = Date.now()): { start: Date; endsInSeconds: number } {
    const start = Math.floor(now / this.windowMs) * this.windowMs;
    return {
      start: new Date(start),
      endsInSeconds: Math.ceil((start + this.windowMs - now) / 1000),
    };
  }

  /** Seconds until the bucket may be used again, or 0 when it is under `max` in this window. */
  async blockedFor(bucket: string, max: number): Promise<number> {
    const { start, endsInSeconds } = this.window();
    const rows = await this.tenancy.withPreTenantTx(
      (trx) =>
        trx.$queryRaw<Array<{ hits: number }>>`
        select hits from identity.auth_throttle where bucket = ${bucket} and window_start = ${start}`,
    );
    return (rows[0]?.hits ?? 0) >= max ? endsInSeconds : 0;
  }

  /** Counts one event (a failure, a request) in the current window; returns the new count. */
  async hit(bucket: string): Promise<number> {
    const { start } = this.window();
    const rows = await this.tenancy.withPreTenantTx(async (trx) => {
      const result = await trx.$queryRaw<Array<{ hits: number }>>`
        insert into identity.auth_throttle (bucket, window_start, hits) values (${bucket}, ${start}, 1)
        on conflict (bucket, window_start) do update set hits = identity.auth_throttle.hits + 1
        returning hits`;
      // Opportunistic cleanup of long-dead windows (about 1 in 200 writes).
      if (Math.random() < 0.005) {
        await trx.$executeRaw`delete from identity.auth_throttle where window_start < now() - interval '2 days'`;
      }
      return result;
    });
    return rows[0]?.hits ?? 1;
  }

  /** Clears a bucket (successful login). */
  async reset(bucket: string): Promise<void> {
    await this.tenancy.withPreTenantTx(
      (trx) => trx.$executeRaw`delete from identity.auth_throttle where bucket = ${bucket}`,
    );
  }
}
