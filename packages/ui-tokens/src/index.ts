/**
 * Design tokens shared by web (CSS variables + Tailwind theme) and mobile (typed object).
 * Generated from docs/design/tokens.json; see scripts/generate.mjs.
 */
export * from './generated/tokens.js';
export {
  TEXT_MIN_RATIO,
  UI_MIN_RATIO,
  checkTokenContrast,
  contrastPairs,
  contrastRatio,
  hexToRgb,
  relativeLuminance,
  type ContrastKind,
  type ContrastResult,
} from './contrast.js';
