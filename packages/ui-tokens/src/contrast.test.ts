import { describe, expect, it } from 'vitest';
import {
  TEXT_MIN_RATIO,
  UI_MIN_RATIO,
  checkTokenContrast,
  contrastPairs,
  contrastRatio,
  tokens,
} from './index.js';

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // design_system.md section 5: text on bg and surface
    expect(contrastRatio('#14171F', '#F6F7F9')).toBeCloseTo(16.71, 1);
    expect(contrastRatio('#14171F', '#FFFFFF')).toBeCloseTo(17.92, 1);
    // order does not matter
    expect(contrastRatio('#FFFFFF', '#14171F')).toBeCloseTo(17.92, 1);
  });
});

describe('design token contrast (WCAG 2.2 AA)', () => {
  const results = checkTokenContrast(tokens.color);

  it('checks the 168 pairs documented in design_system.md section 5', () => {
    expect(contrastPairs()).toHaveLength(84);
    expect(results).toHaveLength(168);
  });

  it(`every text pair is at least ${TEXT_MIN_RATIO}:1 and every UI pair at least ${UI_MIN_RATIO}:1`, () => {
    const failures = results
      .filter((r) => !r.pass)
      .map(
        (r) =>
          `${r.mode} ${r.fg} ${r.fgHex} on ${r.bg} ${r.bgHex}: ${r.ratio.toFixed(2)} < ${r.required}`,
      );
    expect(failures).toEqual([]);
  });

  it('reproduces the lowest ratios reported in the design document', () => {
    const lowest = Math.min(...results.map((r) => r.ratio));
    expect(lowest).toBeCloseTo(3.19, 1);
    // lowest UI pair is light chart.4 (amber) on surface (3.19); lowest text pair is light danger.on on danger.solid (4.83)
    const lowestText = Math.min(...results.filter((r) => r.kind === 'text').map((r) => r.ratio));
    expect(lowestText).toBeCloseTo(4.83, 1);
  });

  it('fails when a token regresses (the gate really gates)', () => {
    const broken = structuredClone(tokens.color) as unknown as Record<
      string,
      Record<string, string>
    >;
    broken.light!.muted = '#9AA2B1'; // too pale for body text
    broken.dark!['border-strong'] = '#2C3340'; // control outline vanishes
    const failures = checkTokenContrast(broken).filter((r) => !r.pass);
    expect(failures.some((r) => r.mode === 'light' && r.fg === 'muted' && r.kind === 'text')).toBe(
      true,
    );
    expect(
      failures.some((r) => r.mode === 'dark' && r.fg === 'border-strong' && r.kind === 'ui'),
    ).toBe(true);
  });
});
