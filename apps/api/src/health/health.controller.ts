import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse, VersionResponse } from '@assettracker/schemas';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { DbService } from '../db/db.service.js';
import { getVersionInfo } from '../version.js';

@Controller()
export class HealthController {
  constructor(
    private readonly db: DbService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Liveness plus a DB round trip (through PgBouncer when DATABASE_URL points at it). */
  @Get('health')
  async health(): Promise<HealthResponse> {
    const uptimeSeconds = Math.round(process.uptime() * 100) / 100;
    try {
      const { latencyMs } = await this.db.ping();
      return { status: 'ok', checks: { db: { status: 'ok', latencyMs } }, uptimeSeconds };
    } catch (err) {
      const body: HealthResponse = {
        status: 'degraded',
        checks: { db: { status: 'error', error: err instanceof Error ? err.message : 'unknown' } },
        uptimeSeconds,
      };
      // 503 with the same JSON shape so load balancers fail the target and humans see why.
      throw new ServiceUnavailableException(body);
    }
  }

  @Get('version')
  version(): VersionResponse {
    return getVersionInfo(this.config);
  }
}
