import { describe, expect, it } from 'vitest';
import { REDACTED, diffRecords, isSensitiveKey, redactSensitive } from './redact.js';

describe('audit redaction', () => {
  it('redacts passwords, secrets, tokens, TOTP and recovery codes at any depth, whatever the spelling', () => {
    const out = redactSensitive({
      email: 'a@example.com',
      password: 'hunter2',
      passwordHash: '$argon2id$...',
      new_password: 'x',
      totpSecret: 'JBSWY3DP',
      TOTP_CODE: '123456',
      recoveryCodes: ['a-b', 'c-d'],
      api_key: 'ak_live_123',
      apiKey: 'ak_live_456',
      nested: { refreshToken: 'r', deeper: [{ clientSecret: 's', keep: 1 }] },
      Authorization: 'Bearer abc',
      'Set-Cookie': 'sid=1',
    });
    expect(out).toEqual({
      email: 'a@example.com',
      password: REDACTED,
      passwordHash: REDACTED,
      new_password: REDACTED,
      totpSecret: REDACTED,
      TOTP_CODE: REDACTED,
      recoveryCodes: REDACTED,
      api_key: REDACTED,
      apiKey: REDACTED,
      nested: { refreshToken: REDACTED, deeper: [{ clientSecret: REDACTED, keep: 1 }] },
      Authorization: REDACTED,
      'Set-Cookie': REDACTED,
    });
    expect(JSON.stringify(out)).not.toMatch(/hunter2|JBSWY3DP|ak_live|Bearer abc/);
  });

  it('does not touch ordinary fields and does not mutate its input', () => {
    const input = {
      name: 'Laptop',
      serial: 'SN-1',
      password: 'p',
      when: new Date('2026-01-02T03:04:05Z'),
    };
    const copy = structuredClone(input);
    const out = redactSensitive(input);
    expect(input).toEqual(copy);
    expect(out.name).toBe('Laptop');
    expect(out.when).toBe('2026-01-02T03:04:05.000Z');
    expect(isSensitiveKey('assigned_to')).toBe(false);
    expect(isSensitiveKey('purchase_price')).toBe(false);
  });

  it('truncates absurdly long strings', () => {
    expect((redactSensitive({ notes: 'x'.repeat(5000) }).notes as string).length).toBeLessThan(
      2100,
    );
  });

  describe('diffRecords', () => {
    it('creates carry the whole record after, deletes the whole record before', () => {
      expect(diffRecords(null, { name: 'A', password: 'p' })).toEqual({
        before: null,
        after: { name: 'A', password: REDACTED },
      });
      expect(diffRecords({ name: 'A' }, undefined)).toEqual({ before: { name: 'A' }, after: null });
    });

    it('updates carry only the changed fields on both sides, redacted', () => {
      const d = diffRecords(
        { name: 'A', status: 'in_stock', password: 'old', tags: ['a'], meta: { x: 1, y: 2 } },
        { name: 'A', status: 'deployed', password: 'new', tags: ['a'], meta: { y: 2, x: 1 } },
      );
      expect(d).toEqual({
        before: { status: 'in_stock', password: REDACTED },
        after: { status: 'deployed', password: REDACTED },
      });
    });
  });
});
