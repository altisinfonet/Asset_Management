import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/env.js';
import type { TenancyService } from '../tenancy/index.js';
import { HealthController } from './health.controller.js';

const config = loadConfig({
  DATABASE_URL: 'postgres://app:dev@localhost:6432/app',
  GIT_SHA: 'abc1234',
});

const dbWith = (overrides: Partial<Record<'ping' | 'appliedMigrations', unknown>>) =>
  ({
    ping: async () => ({ latencyMs: 0 }),
    appliedMigrations: async () => [],
    ...overrides,
  }) as unknown as TenancyService;

const replyStub = () => ({ status: vi.fn() });

describe('HealthController', () => {
  it('returns ok with latency when the database answers', async () => {
    const controller = new HealthController(
      dbWith({ ping: async () => ({ latencyMs: 1.5 }) }),
      config,
    );
    const reply = replyStub();
    const body = await controller.health(reply);
    expect(body.status).toBe('ok');
    expect(body.checks.db).toEqual({ status: 'ok', latencyMs: 1.5 });
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('answers 503 with a degraded body when the database fails', async () => {
    const controller = new HealthController(
      dbWith({
        ping: async () => {
          throw new Error('connection refused');
        },
      }),
      config,
    );
    const reply = replyStub();
    const body = await controller.health(reply);
    expect(reply.status).toHaveBeenCalledWith(503);
    expect(body).toMatchObject({
      status: 'degraded',
      checks: { db: { status: 'error', error: 'connection refused' } },
    });
  });

  it('reports name, version and commit', () => {
    const controller = new HealthController(dbWith({}), config);
    expect(controller.version()).toMatchObject({
      name: '@assettracker/api',
      commit: 'abc1234',
      role: 'api',
    });
  });

  it('liveness needs no dependency', () => {
    const controller = new HealthController(dbWith({}), config);
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  describe('readiness', () => {
    const shipped = ['0001_init', '0002_schemas_and_helpers'];

    it('is not ready while shipped migrations are pending', async () => {
      const controller = new HealthController(
        dbWith({ appliedMigrations: async () => [...shipped, '0999_from_the_future'] }),
        config,
      );
      const reply = replyStub();
      const body = await controller.ready(reply);
      // The real directory ships more than two migrations, so a ledger with two is NOT ready.
      expect(body.status).toBe('not_ready');
      expect(body.checks.migrations.pending?.length).toBeGreaterThan(0);
      expect(reply.status).toHaveBeenCalledWith(503);
    });

    it('is ready when the ledger contains all shipped migrations', async () => {
      const { loadMigrations } = await import('../db/migrator.js');
      const all = (await loadMigrations()).map((m) => m.id);
      const controller = new HealthController(
        dbWith({ appliedMigrations: async () => all }),
        config,
      );
      const reply = replyStub();
      const body = await controller.ready(reply);
      expect(body).toMatchObject({
        status: 'ready',
        checks: {
          db: { status: 'ok' },
          migrations: { status: 'ok', applied: all.length, expected: all.length },
        },
      });
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('is not ready (503) when the database is unreachable', async () => {
      const controller = new HealthController(
        dbWith({
          appliedMigrations: async () => {
            throw new Error('connection refused');
          },
        }),
        config,
      );
      const reply = replyStub();
      const body = await controller.ready(reply);
      expect(body.status).toBe('not_ready');
      expect(body.checks.db).toEqual({ status: 'error', error: 'connection refused' });
      expect(reply.status).toHaveBeenCalledWith(503);
    });
  });
});
