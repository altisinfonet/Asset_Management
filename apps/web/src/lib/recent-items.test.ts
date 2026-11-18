import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRecent,
  isAssetCode,
  MAX_RECENT,
  pushRecent,
  readRecent,
  RECENT_STORAGE_KEY,
} from './recent-items';

describe('recent items', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('puts the newest first, deduplicates and caps the list', () => {
    pushRecent({ type: 'page', id: 'assets' });
    pushRecent({ type: 'asset', code: 'AT-00124' });
    pushRecent({ type: 'page', id: 'assets' });
    expect(readRecent()).toEqual([
      { type: 'page', id: 'assets' },
      { type: 'asset', code: 'AT-00124' },
    ]);

    for (let i = 0; i < MAX_RECENT + 3; i++) pushRecent({ type: 'asset', code: `AT-${i}` });
    expect(readRecent()).toHaveLength(MAX_RECENT);
    expect(readRecent()[0]).toEqual({ type: 'asset', code: `AT-${MAX_RECENT + 2}` });
  });

  it('drops malformed or tampered entries instead of trusting storage', () => {
    window.localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify([
        { type: 'page', id: 'assets' },
        { type: 'page', id: '../../evil' },
        { type: 'asset', code: 'has spaces' },
        { type: 'link', href: 'https://evil.example' },
        'string',
        null,
      ]),
    );
    expect(readRecent()).toEqual([{ type: 'page', id: 'assets' }]);

    window.localStorage.setItem(RECENT_STORAGE_KEY, '{not json');
    expect(readRecent()).toEqual([]);
  });

  it('keeps working when storage throws (private mode, blocked storage)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readRecent()).toEqual([]);
    expect(() => pushRecent({ type: 'page', id: 'assets' })).not.toThrow();
    expect(pushRecent({ type: 'page', id: 'assets' })).toEqual([{ type: 'page', id: 'assets' }]);
    expect(() => clearRecent()).not.toThrow();
    spy.mockRestore();
    setSpy.mockRestore();
  });

  it('recognises tag-like codes only', () => {
    expect(isAssetCode('AT-00124')).toBe(true);
    expect(isAssetCode('a1b2c3')).toBe(true);
    expect(isAssetCode('two words')).toBe(false);
    expect(isAssetCode('')).toBe(false);
    expect(isAssetCode('-leading')).toBe(false);
  });
});
