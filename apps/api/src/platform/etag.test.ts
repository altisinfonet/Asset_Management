import { describe, expect, it } from 'vitest';
import {
  assertIfMatch,
  etagFor,
  ifMatchSatisfied,
  notModified,
  parseIfMatch,
  requireIfMatch,
  setEtag,
} from './etag.js';
import type { ApiProblem } from './problem.js';

const problemOf = (fn: () => unknown): ApiProblem => {
  try {
    fn();
  } catch (err) {
    return err as ApiProblem;
  }
  throw new Error('expected a problem');
};

describe('etagFor / setEtag', () => {
  it('is the weak tag of the version', () => {
    expect(etagFor(7)).toBe('W/"7"');
    expect(etagFor(7n)).toBe('W/"7"');
  });
  it('sets the ETag header', () => {
    const headers: Record<string, string> = {};
    setEtag(
      { header: (k: string, v: string) => ((headers[k] = v), undefined as never) } as never,
      3,
    );
    expect(headers).toEqual({ etag: 'W/"3"' });
  });
});

describe('parseIfMatch', () => {
  it('absent, any, single and list forms; weak and strong tags are the same version', () => {
    expect(parseIfMatch(undefined)).toEqual({ kind: 'absent' });
    expect(parseIfMatch('  ')).toEqual({ kind: 'absent' });
    expect(parseIfMatch('*')).toEqual({ kind: 'any' });
    expect(parseIfMatch('W/"7"')).toEqual({ kind: 'versions', versions: ['7'] });
    expect(parseIfMatch('"7"')).toEqual({ kind: 'versions', versions: ['7'] });
    expect(parseIfMatch('W/"7", "8" ,W/"9"')).toEqual({
      kind: 'versions',
      versions: ['7', '8', '9'],
    });
    expect(parseIfMatch(['W/"1"', 'W/"2"'])).toEqual({ kind: 'versions', versions: ['1', '2'] });
  });

  it('a malformed value is 400, not a silent mismatch', () => {
    for (const bad of ['7', 'W/7', 'banana', 'W/"7', '"7" "8"']) {
      const p = problemOf(() => parseIfMatch(bad));
      expect(p.getStatus(), bad).toBe(400);
      expect(p.code).toBe('bad-request');
    }
  });
});

describe('requireIfMatch / assertIfMatch', () => {
  it('missing header is 428 precondition-required', () => {
    const p = problemOf(() => requireIfMatch(undefined));
    expect(p.getStatus()).toBe(428);
    expect(p.code).toBe('precondition-required');
    expect(p.detail).toContain('If-Match');
  });

  it('stale version is 412 precondition-failed and names the current tag', () => {
    const p = problemOf(() => assertIfMatch(requireIfMatch('W/"6"'), 7));
    expect(p.getStatus()).toBe(412);
    expect(p.code).toBe('precondition-failed');
    expect(p.detail).toContain('W/"7"');
  });

  it('matching version, any-match and absent-optional pass', () => {
    expect(() => assertIfMatch(requireIfMatch('W/"7"'), 7)).not.toThrow();
    expect(() => assertIfMatch(requireIfMatch('W/"1", W/"7"'), 7)).not.toThrow();
    expect(() => assertIfMatch(requireIfMatch('*'), 7)).not.toThrow();
    expect(ifMatchSatisfied({ kind: 'absent' }, 7)).toBe(true);
    expect(ifMatchSatisfied({ kind: 'versions', versions: ['8'] }, 7)).toBe(false);
  });
});

describe('notModified (If-None-Match)', () => {
  it('is true only when the client already has the current version', () => {
    expect(notModified('W/"7"', 7)).toBe(true);
    expect(notModified('W/"6"', 7)).toBe(false);
    expect(notModified(undefined, 7)).toBe(false);
    expect(notModified('*', 7)).toBe(true);
  });
});
