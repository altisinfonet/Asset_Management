import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { healthResponseSchema, versionResponseSchema } from '@assettracker/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';

/**
 * Real database required: set DATABASE_URL (runtime role, ideally through PgBouncer in
 * transaction mode). In CI this points at the pgbouncer service container.
 */
const databaseUrl = process.env.DATABASE_URL;

async function start(url: string): Promise<NestFastifyApplication> {
  const app = await createApiApp(
    loadConfig({ NODE_ENV: 'test', DATABASE_URL: url, LOG_LEVEL: 'silent', GIT_SHA: 'e2e' }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe.skipIf(!databaseUrl)('GET /v1/health (real database)', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await start(databaseUrl!);
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports ok with the database check passing', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = healthResponseSchema.parse(res.json());
    expect(body.status).toBe('ok');
    expect(body.checks.db.status).toBe('ok');
  });

  it('serves /v1/version', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/version' });
    expect(res.statusCode).toBe(200);
    expect(versionResponseSchema.parse(res.json())).toMatchObject({
      name: '@assettracker/api',
      commit: 'e2e',
      role: 'api',
    });
  });

  it('echoes a request id header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/version',
      headers: { 'x-request-id': 'req-123' },
    });
    expect(res.headers['x-request-id']).toBe('req-123');
  });
});

describe('GET /v1/health (database unreachable)', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    // Port 1 refuses connections immediately.
    app = await start('postgres://app:dev@127.0.0.1:1/app');
  });
  afterAll(async () => {
    await app.close();
  });

  it('answers 503 with a degraded body instead of crashing', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(503);
    const body = healthResponseSchema.parse(res.json());
    expect(body.status).toBe('degraded');
    expect(body.checks.db.status).toBe('error');
  });

  it('still serves /v1/version', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/version' });
    expect(res.statusCode).toBe(200);
  });
});
