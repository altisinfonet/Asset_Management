import { describe, expect, it } from 'vitest';
import { assertIdsOnlyPayload, idsOnlyViolations, PayloadNotIdsOnlyError } from './ids-only.js';

const id = '0190aaaa-0000-7000-8000-00000000000a';

describe('ids-only payload rule', () => {
  it('accepts ids, versions, buckets and short codes', () => {
    expect(
      idsOnlyViolations({
        tenantId: id,
        assetIds: [id, id],
        version: 3,
        bucket: 29_000_000,
        day: '2026-11-18',
        kind: 'asset.checked_out',
        dryRun: false,
        parent: null,
        nested: { assetId: id },
      }),
    ).toEqual([]);
  });

  it('FAILING FIXTURES: rejects free text, emails, urls, names and secrets', () => {
    for (const bad of [
      { note: 'please check out the laptop for Alice' },
      { to: 'alice@example.com' },
      { link: 'https://app.example.com/reset?token=abc' },
      { assetId: id, description: 'a free text field with spaces' },
      { password: 'x' },
      { resetToken: 'abc' },
      { email: 'a' },
      { 'bad key': id },
    ]) {
      expect(idsOnlyViolations(bad), JSON.stringify(bad)).not.toEqual([]);
      expect(() => assertIdsOnlyPayload(bad, 'job x')).toThrow(PayloadNotIdsOnlyError);
    }
  });

  it('rejects non-objects, deep nesting, huge arrays and oversized payloads', () => {
    expect(idsOnlyViolations([id])).not.toEqual([]);
    expect(idsOnlyViolations({ a: { b: { c: { d: id } } } })).not.toEqual([]);
    expect(idsOnlyViolations({ ids: Array.from({ length: 101 }, () => id) })).not.toEqual([]);
    expect(
      idsOnlyViolations({
        ids: Array.from({ length: 100 }, () => id),
        more: Array.from({ length: 100 }, () => id),
      }),
    ).not.toEqual([]);
  });
});
