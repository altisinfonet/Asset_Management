import 'reflect-metadata';
import { afterAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { dbEnabled, env } from '../support/db.js';
import { TestPortsModule } from '../support/test-ports.js';

/**
 * TRUST_PROXY: the client address Fastify resolves (what per-IP throttling, security events and
 * audit rows use) honours X-Forwarded-For only from the configured proxies.
 */
describe.skipIf(!dbEnabled)('TRUST_PROXY', () => {
  const apps: Array<{ close(): Promise<void> }> = [];
  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  async function resolvedIp(trustProxy: string | undefined, forwardedFor: string) {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: env.databaseUrl!,
      LOG_LEVEL: 'silent',
      ...(trustProxy === undefined ? {} : { TRUST_PROXY: trustProxy }),
    });
    const app = await createApiApp(config, [TestPortsModule]);
    apps.push(app);
    let seen: string | undefined;
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', async (request) => {
        seen = request.ip;
      });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.inject({
      method: 'GET',
      url: '/v1/auth/password-policy',
      headers: { 'x-forwarded-for': forwardedFor },
    });
    return seen;
  }

  it('ignores X-Forwarded-For by default (a client cannot pick its own throttling bucket)', async () => {
    expect(await resolvedIp(undefined, '203.0.113.9')).toBe('127.0.0.1');
  });

  it('honours it from a trusted proxy address and ignores it from anyone else', async () => {
    expect(await resolvedIp('127.0.0.1', '203.0.113.9')).toBe('203.0.113.9');
    expect(await resolvedIp('10.0.0.0/8', '203.0.113.9')).toBe('127.0.0.1');
  });

  it('with a hop count takes the address that many proxies back', async () => {
    expect(await resolvedIp('1', '198.51.100.7, 203.0.113.9')).toBe('203.0.113.9');
  });
});
