import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env.js';
import type { TenancyService } from '../tenancy/tenancy.service.js';
import { HealthController } from './health.controller.js';

const config = loadConfig({
  DATABASE_URL: 'postgres://app:dev@localhost:6432/app',
  GIT_SHA: 'abc1234',
});

const dbWith = (ping: TenancyService['ping']) => ({ ping }) as unknown as TenancyService;

describe('HealthController', () => {
  it('returns ok with latency when the database answers', async () => {
    const controller = new HealthController(
      dbWith(async () => ({ latencyMs: 1.5 })),
      config,
    );
    const body = await controller.health();
    expect(body.status).toBe('ok');
    expect(body.checks.db).toEqual({ status: 'ok', latencyMs: 1.5 });
  });

  it('throws 503 with a degraded body when the database fails', async () => {
    const controller = new HealthController(
      dbWith(async () => {
        throw new Error('connection refused');
      }),
      config,
    );
    const err = await controller.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
      status: 'degraded',
      checks: { db: { status: 'error', error: 'connection refused' } },
    });
  });

  it('reports name, version and commit', () => {
    const controller = new HealthController(
      dbWith(async () => ({ latencyMs: 0 })),
      config,
    );
    expect(controller.version()).toMatchObject({
      name: '@assettracker/api',
      commit: 'abc1234',
      role: 'api',
    });
  });
});
