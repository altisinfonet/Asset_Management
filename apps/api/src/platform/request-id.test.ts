import { describe, expect, it } from 'vitest';
import {
  currentRequestContext,
  currentRequestId,
  runWithRequestContext,
} from '../context/request-context.js';
import { resolveRequestId } from './request-id.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('reuses a safe incoming id', () => {
    expect(resolveRequestId('0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e5f')).toBe(
      '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e5f',
    );
    expect(resolveRequestId('trace.id:42_a-b')).toBe('trace.id:42_a-b');
    expect(resolveRequestId(['first-id', 'second-id'])).toBe('first-id');
  });

  it('mints a UUID when absent, empty, too long or containing unsafe characters', () => {
    for (const bad of [
      undefined,
      '',
      ' ',
      'a'.repeat(129),
      'has space',
      'new\nline',
      '<script>',
      'semi;colon',
      '-leading-dash',
      'ünï',
    ]) {
      expect(resolveRequestId(bad), String(bad)).toMatch(UUID);
    }
    expect(resolveRequestId('a'.repeat(128))).toBe('a'.repeat(128));
  });

  it('never returns the same minted id twice', () => {
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
  });
});

describe('request context', () => {
  it('is empty outside a request and visible to everything awaited inside one', async () => {
    expect(currentRequestId()).toBeUndefined();
    await runWithRequestContext({ requestId: 'r-1' }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(currentRequestId()).toBe('r-1');
      expect(currentRequestContext()).toEqual({ requestId: 'r-1' });
    });
    expect(currentRequestId()).toBeUndefined();
  });

  it('keeps concurrent requests apart', async () => {
    const seen = await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        runWithRequestContext({ requestId: id }, async () => {
          await new Promise((r) => setTimeout(r, Math.random() * 5));
          return currentRequestId();
        }),
      ),
    );
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});
