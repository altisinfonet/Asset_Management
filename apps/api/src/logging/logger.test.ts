import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env.js';
import { runWithRequestContext } from '../context/request-context.js';
import { REDACTED_LOG_FIELDS, createLogger } from './logger.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = createLogger(
    loadConfig({ DATABASE_URL: 'postgres://u:p@h:5432/d', LOG_LEVEL: 'trace' }),
    stream,
  );
  return { logger, output: () => lines.join('') };
}

describe('structured logging (M1-OPS-01)', () => {
  it('emits one JSON object per line with service, role and commit', () => {
    const { logger, output } = capture();
    logger.info({ a: 1 }, 'hello');
    const line = JSON.parse(output().trim());
    expect(line).toMatchObject({ msg: 'hello', a: 1, service: 'assettracker-api', role: 'api' });
    expect(line.time).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('adds request_id, tenant_id and actor_id from the ambient context', () => {
    const { logger, output } = capture();
    runWithRequestContext(
      { requestId: 'req-1', tenantId: '0190aaaa-0000-7000-8000-00000000000a', actorId: 'act-1' },
      () => logger.info('inside'),
    );
    logger.info('outside');
    const [inside, outside] = output()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(inside).toMatchObject({
      request_id: 'req-1',
      tenant_id: '0190aaaa-0000-7000-8000-00000000000a',
      actor_id: 'act-1',
    });
    expect(outside.request_id).toBeUndefined();
    expect(outside.tenant_id).toBeUndefined();
  });

  it('REDACTION: passwords, tokens, keys and secrets never appear, at any nesting level', () => {
    const { logger, output } = capture();
    const secretValue = 'SUPER-SECRET-VALUE-123';
    for (const field of REDACTED_LOG_FIELDS) {
      logger.info({ [field]: secretValue }, `top ${field}`);
      logger.info({ body: { [field]: secretValue } }, `nested ${field}`);
      logger.info({ req: { body: { user: { [field]: secretValue } } } }, `deep ${field}`);
    }
    logger.info(
      {
        req: {
          headers: {
            authorization: `Bearer ${secretValue}`,
            cookie: `sid=${secretValue}`,
            'x-api-key': secretValue,
          },
        },
      },
      'headers',
    );
    const text = output();
    expect(text).not.toContain(secretValue);
    expect(text).toContain('[REDACTED]');
    expect(text.trim().split('\n')).toHaveLength(REDACTED_LOG_FIELDS.length * 3 + 1);
  });

  it('keeps non-sensitive fields', () => {
    const { logger, output } = capture();
    logger.info({ assetTag: 'LT-001', body: { name: 'Laptop' } }, 'ok');
    expect(output()).toContain('LT-001');
    expect(output()).toContain('Laptop');
  });
});
