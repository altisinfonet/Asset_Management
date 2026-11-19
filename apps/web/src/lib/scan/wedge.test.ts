import { describe, expect, it } from 'vitest';
import { extractScanCode, isScannable } from './parse';
import { WedgeDetector, type WedgeResult } from './wedge';

/** Feed a code the way a scanner types it (`gap` ms between keys), then Enter `enterGap` ms later. */
function typeCode(
  detector: WedgeDetector,
  code: string,
  { start = 1000, gap = 5, enterGap = 5 } = {},
): WedgeResult[] {
  const results: WedgeResult[] = [];
  let at = start;
  for (const key of code) {
    results.push(detector.feed(key, at));
    at += gap;
  }
  results.push(detector.feed('Enter', at - gap + enterGap));
  return results;
}

describe('WedgeDetector', () => {
  it('recognises a fast burst ended by Enter as a scan', () => {
    const results = typeCode(new WedgeDetector(), 'AT-00124');
    expect(results.at(-1)).toEqual({ type: 'scan', code: 'AT-00124' });
  });

  it('swallows every key of a burst from the third on, never the first two (a quick "g a" chord)', () => {
    const results = typeCode(new WedgeDetector(), 'LBL42');
    expect(results.slice(0, 5).map((r) => r.type)).toEqual([
      'ignore', // the first keys cannot be told from typing yet
      'ignore',
      'capture',
      'capture',
      'capture',
    ]);
  });

  it('does not treat a person typing as a scan', () => {
    const results = typeCode(new WedgeDetector(), 'AT-00124', { gap: 150, enterGap: 150 });
    expect(results.every((r) => r.type === 'ignore')).toBe(true);
  });

  it('ignores a burst shorter than the minimum length', () => {
    expect(typeCode(new WedgeDetector(), 'ab').at(-1)).toEqual({ type: 'ignore' });
  });

  it('ignores Enter long after the last key', () => {
    const detector = new WedgeDetector();
    detector.feed('A', 0);
    detector.feed('B', 5);
    detector.feed('C', 10);
    expect(detector.feed('Enter', 5000)).toEqual({ type: 'ignore' });
  });

  it('a pause inside the code starts a new burst', () => {
    const detector = new WedgeDetector();
    for (const [i, key] of [...'ABC'].entries()) detector.feed(key, i * 5);
    // the person walks away, someone else scans after a long gap
    const results: WedgeResult[] = [];
    for (const [i, key] of [...'XYZ1'].entries()) results.push(detector.feed(key, 5000 + i * 5));
    results.push(detector.feed('Enter', 5025));
    expect(results.at(-1)).toEqual({ type: 'scan', code: 'XYZ1' });
  });

  it('other keys (Tab, Escape, arrows) end the burst; Shift does not', () => {
    const detector = new WedgeDetector();
    detector.feed('A', 0);
    detector.feed('Shift', 2);
    detector.feed('B', 4);
    detector.feed('C', 8);
    expect(detector.feed('Enter', 12)).toEqual({ type: 'scan', code: 'ABC' });
    detector.feed('A', 100);
    detector.feed('B', 105);
    detector.feed('Escape', 110);
    expect(detector.pending).toBe('');
  });

  it('drops a runaway buffer', () => {
    const detector = new WedgeDetector({ maxLength: 10 });
    let last: WedgeResult = { type: 'ignore' };
    for (let i = 0; i < 11; i += 1) last = detector.feed('x', i * 2);
    expect(last).toEqual({ type: 'ignore' });
    expect(detector.pending).toBe('');
  });
});

describe('extractScanCode', () => {
  it('leaves a bare tag or label code alone', () => {
    expect(extractScanCode('  AT-00124 ')).toBe('AT-00124');
    expect(extractScanCode('LBL00124')).toBe('LBL00124');
  });

  it('takes the last path segment of a label URL', () => {
    expect(extractScanCode('https://assets.example.org/s/LBL00124')).toBe('LBL00124');
    expect(extractScanCode('http://localhost:3001/s/AB12CD34/')).toBe('AB12CD34');
    expect(extractScanCode('https://host/s/a%20b')).toBe('a b');
  });

  it('treats text that only looks like a URL as the code', () => {
    expect(extractScanCode('https://')).toBe('https://');
  });
});

describe('isScannable', () => {
  it('accepts 1-200 characters without line breaks', () => {
    expect(isScannable('A')).toBe(true);
    expect(isScannable('')).toBe(false);
    expect(isScannable('x'.repeat(201))).toBe(false);
    expect(isScannable('a\nb')).toBe(false);
  });
});
