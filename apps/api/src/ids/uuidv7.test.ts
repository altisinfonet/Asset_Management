import { describe, expect, it } from 'vitest';
import { createUuidv7Generator, isUuidv7, uuidv7, uuidv7Timestamp } from './uuidv7.js';

describe('uuidv7', () => {
  it('has the RFC 9562 version and variant bits', () => {
    for (let i = 0; i < 200; i++) {
      const id = uuidv7();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(isUuidv7(id)).toBe(true);
    }
  });

  it('encodes the timestamp in the first 48 bits', () => {
    const now = Date.UTC(2026, 10, 17, 12, 30, 45, 123);
    expect(uuidv7Timestamp(createUuidv7Generator(() => now)())).toBe(now);
    expect(createUuidv7Generator(() => 0x0123_4567_89ab)().startsWith('01234567-89ab-7')).toBe(
      true,
    );
  });

  it('sorts by creation time across milliseconds', () => {
    let now = 1_800_000_000_000;
    const gen = createUuidv7Generator(() => now);
    const ids = Array.from({ length: 50 }, () => {
      now += 3;
      return gen();
    });
    expect([...ids].sort()).toEqual(ids);
  });

  it('is monotonic within a single millisecond (string sort == creation order)', () => {
    const gen = createUuidv7Generator(() => 1_900_000_000_000);
    const ids = Array.from({ length: 10_000 }, () => gen());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stays monotonic when the clock goes backwards', () => {
    let now = 2_000_000_000_000;
    const gen = createUuidv7Generator(() => now);
    const a = gen();
    now -= 5_000;
    const b = gen();
    expect(b > a).toBe(true);
  });

  it('ids sort by wall-clock creation order with the real clock', async () => {
    const first = uuidv7();
    await new Promise((r) => setTimeout(r, 3));
    const second = uuidv7();
    expect(second > first).toBe(true);
    expect(Math.abs(uuidv7Timestamp(second) - Date.now())).toBeLessThan(5_000);
  });

  it('rejects out-of-range timestamps and non-v7 ids', () => {
    expect(() => createUuidv7Generator(() => -1)()).toThrow(RangeError);
    expect(() => createUuidv7Generator(() => 2 ** 48)()).toThrow(RangeError);
    expect(() => uuidv7Timestamp('0197b2c0-7a4e-4c3a-9f1d-5a1b2c3d4e5f')).toThrow(TypeError);
    expect(isUuidv7('not-a-uuid')).toBe(false);
  });
});
