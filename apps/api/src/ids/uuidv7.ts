import { randomFillSync } from 'node:crypto';

/**
 * UUIDv7 (RFC 9562) generated in the application, so the same code path serves PostgreSQL 16, 17
 * and 18 (decision ED-08: no database-side id defaults).
 *
 * Layout: 48-bit unix-epoch milliseconds | 4-bit version (7) | 12-bit counter (rand_a) |
 * 2-bit variant (10) | 62 random bits (rand_b).
 *
 * rand_a holds a monotonic counter (RFC 9562 section 6.2, method 1), so ids minted by one
 * generator sort by creation order even inside a single millisecond, and the clock going
 * backwards never produces a smaller id than one already issued.
 */

const COUNTER_MAX = 0xfff;

export type Uuidv7Generator = () => string;

/** Creates an independent generator (own monotonic state). `clock` is injectable for tests. */
export function createUuidv7Generator(clock: () => number = Date.now): Uuidv7Generator {
  const bytes = new Uint8Array(16);
  let lastMs = -1;
  let counter = 0;

  return () => {
    let ms = Math.floor(clock());
    if (!Number.isSafeInteger(ms) || ms < 0 || ms > 0xffff_ffff_ffff) {
      throw new RangeError(`uuidv7: timestamp out of range: ${ms}`);
    }

    if (ms > lastMs) {
      lastMs = ms;
      // Start each millisecond at a random value in the lower half so the counter has headroom.
      randomFillSync(bytes, 0, 2);
      counter = ((bytes[0]! << 8) | bytes[1]!) & 0x7ff;
    } else {
      // Same millisecond, or the clock stepped backwards: keep the last timestamp and count up.
      ms = lastMs;
      counter += 1;
      if (counter > COUNTER_MAX) {
        // Counter exhausted inside this millisecond: borrow the next one (stays monotonic).
        lastMs += 1;
        ms = lastMs;
        counter = 0;
      }
    }

    randomFillSync(bytes, 8, 8); // rand_b
    bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
    bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
    bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
    bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
    bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
    bytes[5] = ms & 0xff;
    bytes[6] = 0x70 | (counter >> 8); // version 7 + counter high nibble
    bytes[7] = counter & 0xff;
    bytes[8] = 0x80 | (bytes[8]! & 0x3f); // variant 10

    return formatUuid(bytes);
  };
}

function formatUuid(b: Uint8Array): string {
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Process-wide generator: the single code path for every application-minted id. */
export const uuidv7: Uuidv7Generator = createUuidv7Generator();

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidv7(value: string): boolean {
  return UUID_V7.test(value);
}

/** Milliseconds since the epoch encoded in the first 48 bits of a UUIDv7. */
export function uuidv7Timestamp(id: string): number {
  if (!isUuidv7(id)) throw new TypeError(`not a UUIDv7: ${id}`);
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
