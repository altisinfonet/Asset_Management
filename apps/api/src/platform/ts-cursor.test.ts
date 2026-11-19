import { describe, expect, it } from 'vitest';
import { nextTsIdCursor, readTsIdCursor, tsText } from './ts-cursor.js';

const TS = '2026-11-19T10:15:30.123456+00';
const ID = '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d91';

describe('timestamp + id cursor (history and assignment lists)', () => {
  it('round-trips with full microsecond precision, bound to the filters', () => {
    const first = readTsIdCursor(undefined, { assetId: 'a' });
    expect(first.after).toBeUndefined();
    const cursor = nextTsIdCursor(first.binding, { k0: TS, k1: ID });
    const next = readTsIdCursor(cursor, { assetId: 'a' });
    expect(next.after).toEqual({ ts: TS, id: ID });
    expect(next.binding).toBe(first.binding);
  });

  it('refuses a cursor issued for other filters, garbage, and forged values', () => {
    const { binding } = readTsIdCursor(undefined, { assetId: 'a' });
    const cursor = nextTsIdCursor(binding, { k0: TS, k1: ID });
    expect(() => readTsIdCursor(cursor, { assetId: 'b' })).toThrowError(/different sort or filter/);
    expect(() => readTsIdCursor('garbage', { assetId: 'a' })).toThrow();
    for (const [k0, k1] of [
      ['not-a-timestamp', ID],
      [TS, 'not-a-uuid'],
      ['2026-13-45T10:15:30.123456+00', ID],
      ['0000-01-01T00:00:00.000000+00', ID],
    ] as const) {
      const forged = nextTsIdCursor(binding, { k0, k1 });
      expect(() => readTsIdCursor(forged, { assetId: 'a' }), `${k0} ${k1}`).toThrow();
    }
  });

  it('formats a timestamptz column the way the cursor expects', () => {
    expect(tsText('h.at')).toBe(
      `to_char(h.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00"')`,
    );
  });
});
