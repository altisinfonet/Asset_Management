/**
 * WCAG 2.x contrast checks over the colour tokens (design_system.md section 5).
 *
 * Thresholds: text pairs need 4.5:1 (1.4.3), UI components, focus rings and graphical objects need
 * 3:1 (1.4.11). `checkTokenContrast` enumerates the same 168 pairs the design document lists and is
 * run as a unit test, so a token change that breaks contrast fails the build. It is also exported so
 * a future "custom status colour" feature can validate a colour at save time.
 */

export const TEXT_MIN_RATIO = 4.5;
export const UI_MIN_RATIO = 3;

export type ContrastKind = 'text' | 'ui';

export interface ContrastResult {
  mode: string;
  fg: string;
  bg: string;
  fgHex: string;
  bgHex: string;
  kind: ContrastKind;
  required: number;
  ratio: number;
  pass: boolean;
}

type ColorMode = Record<string, unknown>;

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(hex);
  if (!m) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  const n = Number.parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function pick(mode: ColorMode, dotted: string): string {
  let cursor: unknown = mode;
  for (const part of dotted.split('.')) {
    cursor = (cursor as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof cursor !== 'string') throw new Error(`Missing colour token ${dotted}`);
  return cursor;
}

const ROLES = ['primary', 'success', 'warning', 'danger', 'info'] as const;
const SURFACES = ['bg', 'surface', 'sunken'] as const;
const CHART_SERIES = ['1', '2', '3', '4', '5'] as const;

/** `[foreground token, background token, kind]` for one mode. Matches design_system.md section 5. */
export function contrastPairs(): Array<[string, string, ContrastKind]> {
  const pairs: Array<[string, string, ContrastKind]> = [];
  const textOnSurface = ['text', 'muted', ...ROLES.map((r) => `${r}.text`)];
  const uiOnSurface = ['border-strong', 'focus', ...ROLES.map((r) => `${r}.solid`)];
  for (const bg of SURFACES) {
    for (const fg of textOnSurface) pairs.push([fg, bg, 'text']);
    for (const fg of uiOnSurface) pairs.push([fg, bg, 'ui']);
  }
  for (const role of ROLES) {
    pairs.push([`${role}.on`, `${role}.solid`, 'text']);
    pairs.push([`${role}.text`, `${role}.subtle`, 'text']);
    pairs.push(['text', `${role}.subtle`, 'text']);
    pairs.push(['muted', `${role}.subtle`, 'text']);
    pairs.push([`${role}.solid`, `${role}.subtle`, 'ui']);
    pairs.push(['focus', `${role}.subtle`, 'ui']);
  }
  pairs.push(['primary.on', 'primary.hover', 'text']);
  // The navigation sidebar is dark navy in every theme; its labels, headings and current-item accent
  // (also its focus ring) are checked against its own fills.
  for (const bg of ['sidebar.solid', 'sidebar.hover', 'sidebar.active']) {
    pairs.push(['sidebar.text', bg, 'text']);
  }
  pairs.push(['sidebar.muted', 'sidebar.solid', 'text']);
  pairs.push(['sidebar.accent', 'sidebar.solid', 'ui']);
  pairs.push(['sidebar.accent', 'sidebar.active', 'ui']);
  // Chart series are graphical objects on cards.
  for (const series of CHART_SERIES) pairs.push([`chart.${series}`, 'surface', 'ui']);
  return pairs;
}

/** Check every pair in every mode of a `{ light, dark }` colour tree (the shape of `tokens.color`). */
export function checkTokenContrast(color: Record<string, ColorMode>): ContrastResult[] {
  const results: ContrastResult[] = [];
  for (const [mode, tokens] of Object.entries(color)) {
    for (const [fg, bg, kind] of contrastPairs()) {
      const fgHex = pick(tokens, fg);
      const bgHex = pick(tokens, bg);
      const required = kind === 'text' ? TEXT_MIN_RATIO : UI_MIN_RATIO;
      const ratio = contrastRatio(fgHex, bgHex);
      results.push({ mode, fg, bg, fgHex, bgHex, kind, required, ratio, pass: ratio >= required });
    }
  }
  return results;
}
