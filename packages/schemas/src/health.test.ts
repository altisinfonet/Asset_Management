import { describe, expect, it } from 'vitest';
import { healthResponseSchema, versionResponseSchema } from './health.js';

describe('health schemas', () => {
  it('accepts a healthy response', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      checks: { db: { status: 'ok', latencyMs: 2 } },
      uptimeSeconds: 12.5,
    });
    expect(parsed.status).toBe('ok');
  });

  it('rejects an unknown status', () => {
    expect(() =>
      healthResponseSchema.parse({
        status: 'weird',
        checks: { db: { status: 'ok' } },
        uptimeSeconds: 0,
      }),
    ).toThrow();
  });

  it('parses a version response', () => {
    expect(
      versionResponseSchema.parse({ name: 'api', version: '0.0.0', commit: 'dev', role: 'api' }),
    ).toMatchObject({ name: 'api' });
  });
});
