import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { HealthResponse, VersionResponse } from '@assettracker/schemas';
import type { FastifyReply } from 'fastify';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { loadMigrations } from '../db/migrator.js';
import { TenancyService } from '../tenancy/index.js';
import { getVersionInfo } from '../version.js';

/** `GET /readyz` body. */
export interface ReadyResponse {
  status: 'ready' | 'not_ready';
  checks: {
    db: { status: 'ok' | 'error'; error?: string };
    migrations: {
      status: 'ok' | 'error';
      applied?: number;
      expected?: number;
      pending?: string[];
      error?: string;
    };
  };
}

@Controller()
export class HealthController {
  private expectedMigrations?: Promise<string[]>;

  constructor(
    private readonly db: TenancyService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Liveness for the orchestrator: the process is up and the event loop answers. No dependencies. */
  @Get('healthz')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: the database answers AND every migration shipped with this build has been applied
   * (a new image started before `migrate` finished must not receive traffic). 503 when not ready.
   */
  @Get('readyz')
  async ready(
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, 'status'>,
  ): Promise<ReadyResponse> {
    const body: ReadyResponse = {
      status: 'ready',
      checks: { db: { status: 'ok' }, migrations: { status: 'ok' } },
    };
    try {
      const [applied, expected] = await Promise.all([this.db.appliedMigrations(), this.expected()]);
      const appliedSet = new Set(applied);
      const pending = expected.filter((id) => !appliedSet.has(id));
      body.checks.migrations = {
        status: pending.length === 0 ? 'ok' : 'error',
        applied: applied.length,
        expected: expected.length,
        ...(pending.length ? { pending } : {}),
      };
      if (pending.length) body.status = 'not_ready';
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown';
      body.checks.db = { status: 'error', error };
      body.checks.migrations = { status: 'error', error: 'not checked: database unavailable' };
      body.status = 'not_ready';
    }
    if (body.status !== 'ready') void reply?.status(503);
    return body;
  }

  /** Liveness plus a DB round trip (through PgBouncer when DATABASE_URL points at it). */
  @Get('health')
  async health(
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, 'status'>,
  ): Promise<HealthResponse> {
    const uptimeSeconds = Math.round(process.uptime() * 100) / 100;
    try {
      const { latencyMs } = await this.db.ping();
      return { status: 'ok', checks: { db: { status: 'ok', latencyMs } }, uptimeSeconds };
    } catch (err) {
      // 503 with the same JSON shape so load balancers fail the target and humans see why.
      void reply?.status(503);
      return {
        status: 'degraded',
        checks: { db: { status: 'error', error: err instanceof Error ? err.message : 'unknown' } },
        uptimeSeconds,
      };
    }
  }

  @Get('version')
  version(): VersionResponse {
    return getVersionInfo(this.config);
  }

  private expected(): Promise<string[]> {
    this.expectedMigrations ??= loadMigrations().then((all) => all.map((m) => m.id));
    return this.expectedMigrations;
  }
}
