import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './env.js';

const dbUrl = 'postgres://app:dev@localhost:6432/app';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({ DATABASE_URL: dbUrl });
    expect(config).toMatchObject({
      APP_ROLE: 'api',
      PORT: 3000,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'info',
      DB_POOL_MAX: 10,
      GIT_SHA: 'dev',
    });
  });

  it('coerces numbers and treats empty strings as unset', () => {
    const config = loadConfig({ DATABASE_URL: dbUrl, PORT: '8080', LOG_LEVEL: '' });
    expect(config.PORT).toBe(8080);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('requires DATABASE_URL for the api role', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('requires MIGRATOR_DATABASE_URL (not DATABASE_URL) for the migrate role', () => {
    expect(() => loadConfig({ APP_ROLE: 'migrate', DATABASE_URL: dbUrl })).toThrow(
      /MIGRATOR_DATABASE_URL/,
    );
    expect(
      loadConfig({ APP_ROLE: 'migrate', MIGRATOR_DATABASE_URL: 'postgres://m:dev@db:5432/app' })
        .APP_ROLE,
    ).toBe('migrate');
  });

  it('rejects an unknown role and a non-postgres URL', () => {
    expect(() => loadConfig({ APP_ROLE: 'nope', DATABASE_URL: dbUrl })).toThrow(/APP_ROLE/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
  });
});

describe('SESSION_COOKIE_SECURE', () => {
  it('defaults to true', () => {
    expect(loadConfig({ DATABASE_URL: dbUrl }).SESSION_COOKIE_SECURE).toBe(true);
  });

  it('can be turned off in development and test', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(
        loadConfig({ DATABASE_URL: dbUrl, NODE_ENV, SESSION_COOKIE_SECURE: 'false' })
          .SESSION_COOKIE_SECURE,
      ).toBe(false);
    }
  });

  it('is refused when false and NODE_ENV=production', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: dbUrl, NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }),
    ).toThrow(/SESSION_COOKIE_SECURE.*production/);
    expect(
      loadConfig({ DATABASE_URL: dbUrl, NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'true' })
        .SESSION_COOKIE_SECURE,
    ).toBe(true);
  });
});
