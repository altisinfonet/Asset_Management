/**
 * Code 128 (subset B) encoder for the on-screen label preview. The PDF the server renders is the
 * real thing; this draws the same symbology so the preview looks like the printed label. Subset B
 * covers printable ASCII (32-126), which is what asset tags are; anything else prints as `?`.
 *
 * Each symbol is six alternating bar and space widths (in modules) that sum to 11; the stop symbol
 * has a seventh width and sums to 13.
 */
// prettier-ignore
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
] as const;

const START_B = 104;
const STOP = 106;

export const CODE128_PATTERNS = PATTERNS;

/** The symbol values of `text` including start, check digit and stop. */
export function code128Values(text: string): number[] {
  const values = [START_B];
  let sum = START_B;
  let position = 1;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const value = code >= 32 && code <= 126 ? code - 32 : '?'.charCodeAt(0) - 32;
    values.push(value);
    sum += value * position;
    position += 1;
  }
  values.push(sum % 103, STOP);
  return values;
}

/** Bar runs as `[x, width]` in modules, left to right, including the quiet-zone-free symbol only. */
export function code128Bars(text: string): { bars: Array<[number, number]>; modules: number } {
  const bars: Array<[number, number]> = [];
  let x = 0;
  for (const value of code128Values(text)) {
    const widths = PATTERNS[value]!;
    for (let i = 0; i < widths.length; i += 1) {
      const width = Number(widths[i]);
      if (i % 2 === 0) bars.push([x, width]);
      x += width;
    }
  }
  return { bars, modules: x };
}
