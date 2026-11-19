import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InvalidStorageKeyError,
  assertObjectKey,
  isObjectKey,
  keyBelongsToTenant,
  newObjectKey,
  parseObjectKey,
  variantKey,
} from './keys.js';

const T = '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d91';
const O = '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d92';

describe('object keys (M2-FILE-01: tenant-prefixed, M2-SEC-02: fuzzed keys fail)', () => {
  it('newObjectKey builds tenants/<tenant>/<yyyy>/<uuid> and parses back', () => {
    const key = newObjectKey(T, { objectId: O, now: new Date('2026-11-19T00:00:00Z') });
    expect(key).toBe(`tenants/${T}/2026/${O}`);
    expect(parseObjectKey(key)).toEqual({ tenantId: T, year: 2026, objectId: O, variant: null });
    expect(keyBelongsToTenant(key, T)).toBe(true);
    expect(keyBelongsToTenant(key, randomUUID())).toBe(false);
  });

  it('a random uuid is generated when none is given', () => {
    const a = newObjectKey(T);
    const b = newObjectKey(T);
    expect(a).not.toBe(b);
    expect(isObjectKey(a)).toBe(true);
  });

  it('derivatives are `<key>.thumb`, and only an original can have one', () => {
    const key = newObjectKey(T, { objectId: O, now: new Date('2026-01-01T00:00:00Z') });
    const thumb = variantKey(key, 'thumb');
    expect(thumb).toBe(`${key}.thumb`);
    expect(parseObjectKey(thumb)?.variant).toBe('thumb');
    expect(() => variantKey(thumb, 'thumb')).toThrow(InvalidStorageKeyError);
    expect(() => variantKey('nope', 'thumb')).toThrow(InvalidStorageKeyError);
  });

  it('refuses every key that is not exactly that shape', () => {
    const good = `tenants/${T}/2026/${O}`;
    const bad = [
      '',
      '/',
      '..',
      `/${good}`,
      `${good}/`,
      `${good}/x`,
      `./${good}`,
      `tenants/${T}/2026/../${O}`,
      `tenants/${T}/../${T}/2026/${O}`,
      `tenants/../2026/${O}`,
      `tenants/${T.toUpperCase()}/2026/${O}`,
      `tenants/${T}/2026/${O.toUpperCase()}`,
      `tenants/${T}/26/${O}`,
      `tenants/${T}/20266/${O}`,
      `t/${T}/2026/${O}`,
      `tenants/${T}//2026/${O}`,
      `tenants/${T}/2026/${O}.`,
      `tenants/${T}/2026/${O}.THUMB`,
      `tenants/${T}/2026/${O}.thumbnails0`,
      `tenants/${T}/2026/${O}.thumb.thumb`,
      `tenants/${T}/2026/${O}\0`,
      `tenants/${T}/2026/${O}%2e%2e`,
      `tenants/${T}/2026/${O}\\..\\x`,
      `tenants/${T}\n/2026/${O}`,
      `tenants/${T}/2026/${O} `,
      ' ' + good,
      `tenants/${T}/2026/${O}.${'a'.repeat(9)}`,
      'x'.repeat(5000),
    ];
    for (const key of bad) {
      expect(parseObjectKey(key), JSON.stringify(key.slice(0, 80))).toBeNull();
      expect(() => assertObjectKey(key)).toThrow(InvalidStorageKeyError);
    }
  });

  it('fuzz: random strings, random bytes and mutated valid keys are never accepted unless they are valid keys', () => {
    const good = `tenants/${T}/2026/${O}`;
    const alphabet = '.-/\\%0123456789abcdefABCDEF\0 \n\t:?#tenants';
    const accepted: string[] = [];
    for (let i = 0; i < 4000; i++) {
      // mutate: replace, insert or delete one character of a valid key
      const chars = [...good];
      const at = Math.floor(Math.random() * chars.length);
      const pick = alphabet[Math.floor(Math.random() * alphabet.length)]!;
      const mode = i % 3;
      if (mode === 0) chars[at] = pick;
      else if (mode === 1) chars.splice(at, 0, pick);
      else chars.splice(at, 1);
      const candidate = chars.join('');
      if (isObjectKey(candidate)) accepted.push(candidate);
      // pure noise
      expect(isObjectKey(randomBytes(24).toString('latin1'))).toBe(false);
    }
    // anything that was accepted is, by construction, still exactly the canonical shape
    for (const key of accepted) {
      const parsed = parseObjectKey(key)!;
      expect(key).toBe(
        `tenants/${parsed.tenantId}/${String(parsed.year).padStart(4, '0')}/${parsed.objectId}${parsed.variant ? `.${parsed.variant}` : ''}`,
      );
    }
  });
});
