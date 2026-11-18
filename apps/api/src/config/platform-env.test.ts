import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

const dbUrl = 'postgres://app:dev@localhost:6432/app';

describe('platform services configuration', () => {
  it('has safe defaults: polling 1 s, ops server on 9464, tracing off, a mail sender', () => {
    const config = loadConfig({ DATABASE_URL: dbUrl });
    expect(config).toMatchObject({
      JOBS_POLL_SECONDS: 1,
      JOBS_TENANT_CONCURRENCY: 2,
      OPS_PORT: 9464,
      OPS_ENABLED: true,
      MASTER_KEY_ID: 'mk1',
    });
    expect(config.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(config.MAIL_FROM).toMatch(/no-reply/);
  });

  it('keeps worker polling within 1-2 seconds (no LISTEN/NOTIFY behind the pooler)', () => {
    expect(() => loadConfig({ DATABASE_URL: dbUrl, JOBS_POLL_SECONDS: '30' })).toThrow(
      /JOBS_POLL_SECONDS/,
    );
    expect(loadConfig({ DATABASE_URL: dbUrl, JOBS_POLL_SECONDS: '2' }).JOBS_POLL_SECONDS).toBe(2);
  });

  it('the scheduler role needs the owner connection', () => {
    expect(() => loadConfig({ APP_ROLE: 'scheduler', DATABASE_URL: dbUrl })).toThrow(
      /MAINTENANCE_DATABASE_URL/,
    );
    expect(
      loadConfig({
        APP_ROLE: 'scheduler',
        DATABASE_URL: dbUrl,
        MAINTENANCE_DATABASE_URL: 'postgres://app_owner:dev@postgres:5432/app',
      }).APP_ROLE,
    ).toBe('scheduler');
  });
});
