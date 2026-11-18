import type { FieldError } from '../platform/index.js';
import type { FieldType } from './schemas.js';

/**
 * Custom field values (M1-REG-04). Definitions live in `app.custom_field_def`; values live in
 * `app.asset.custom_data` (JSONB) keyed by the definition key. This file is the pure engine:
 * it validates and coerces values against definitions, and validates the definitions themselves.
 *
 * Rules:
 *  - unknown keys are rejected (a key of an archived definition is unknown for NEW writes, but the
 *    stored value stays readable and untouched);
 *  - values are coerced to their canonical JSON type (`"16"` -> 16 for number, `"true"` -> true);
 *  - select / multiselect values must be one of the definition's options;
 *  - `null` removes a key (merge semantics of PATCH); a required field must end up with a value.
 */

export interface FieldOption {
  value: string;
  label?: string;
}

export interface FieldDef {
  key: string;
  label: string;
  dataType: FieldType;
  required: boolean;
  options: FieldOption[] | null;
  validation: Record<string, unknown> | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_TEXT = 2_000;
export const MAX_LONG_TEXT = 10_000;
export const MAX_PATTERN_INPUT = 2_000;

export function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

export type Coerced = { ok: true; value: unknown } | { ok: false; message: string; code: string };
const bad = (message: string, code = 'invalid'): Coerced => ({ ok: false, message, code });
const good = (value: unknown): Coerced => ({ ok: true, value });

/** Validates and coerces one value against its definition. */
export function coerceValue(def: FieldDef, raw: unknown): Coerced {
  const v = def.validation ?? {};
  switch (def.dataType) {
    case 'text':
    case 'long_text':
    case 'url':
    case 'email': {
      if (typeof raw !== 'string') return bad('must be a string', 'type');
      const max = def.dataType === 'long_text' ? MAX_LONG_TEXT : MAX_TEXT;
      if (raw.length > max) return bad(`must be at most ${max} characters`, 'too_big');
      const minLength = num(v.min_length);
      const maxLength = num(v.max_length);
      if (minLength !== undefined && raw.length < minLength) {
        return bad(`must be at least ${minLength} characters`, 'too_small');
      }
      if (maxLength !== undefined && raw.length > maxLength) {
        return bad(`must be at most ${maxLength} characters`, 'too_big');
      }
      if (def.dataType === 'url') {
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          return bad('must be a valid URL', 'format');
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return bad('must be an http(s) URL', 'format');
        }
      }
      if (def.dataType === 'email' && !EMAIL_RE.test(raw)) {
        return bad('must be a valid email address', 'format');
      }
      if (typeof v.pattern === 'string') {
        try {
          if (raw.length <= MAX_PATTERN_INPUT && !new RegExp(v.pattern, 'u').test(raw)) {
            return bad(`must match the pattern ${v.pattern}`, 'pattern');
          }
        } catch {
          return bad('has an invalid pattern in its definition', 'invalid');
        }
      }
      return good(raw);
    }
    case 'number': {
      let n: number;
      if (typeof raw === 'number') n = raw;
      else if (typeof raw === 'string' && NUMBER_RE.test(raw.trim())) n = Number(raw.trim());
      else return bad('must be a number', 'type');
      if (!Number.isFinite(n)) return bad('must be a finite number', 'type');
      const min = num(v.min);
      const max = num(v.max);
      if (min !== undefined && n < min) return bad(`must be at least ${min}`, 'too_small');
      if (max !== undefined && n > max) return bad(`must be at most ${max}`, 'too_big');
      if (v.integer === true && !Number.isInteger(n)) return bad('must be a whole number', 'type');
      return good(n);
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return good(raw);
      if (raw === 'true') return good(true);
      if (raw === 'false') return good(false);
      return bad('must be true or false', 'type');
    }
    case 'date': {
      if (typeof raw !== 'string' || !isRealDate(raw))
        return bad('must be a date (YYYY-MM-DD)', 'format');
      if (typeof v.min === 'string' && raw < v.min)
        return bad(`must be on or after ${v.min}`, 'too_small');
      if (typeof v.max === 'string' && raw > v.max)
        return bad(`must be on or before ${v.max}`, 'too_big');
      return good(raw);
    }
    case 'select': {
      if (typeof raw !== 'string') return bad('must be one of the options', 'type');
      if (!(def.options ?? []).some((o) => o.value === raw)) {
        return bad(
          `must be one of: ${(def.options ?? []).map((o) => o.value).join(', ')}`,
          'invalid_option',
        );
      }
      return good(raw);
    }
    case 'multiselect': {
      if (!Array.isArray(raw)) return bad('must be an array of options', 'type');
      const allowed = new Set((def.options ?? []).map((o) => o.value));
      const seen = new Set<string>();
      for (const item of raw) {
        if (typeof item !== 'string' || !allowed.has(item)) {
          return bad(`must only contain: ${[...allowed].join(', ')}`, 'invalid_option');
        }
        seen.add(item);
      }
      const minItems = num(v.min_items);
      const maxItems = num(v.max_items);
      if (minItems !== undefined && seen.size < minItems)
        return bad(`needs at least ${minItems} options`, 'too_small');
      if (maxItems !== undefined && seen.size > maxItems)
        return bad(`allows at most ${maxItems} options`, 'too_big');
      return good([...seen]);
    }
  }
}

export interface ValidatedCustomData {
  /** The values to write: canonical, coerced. `null` marks a key to remove. */
  values: Record<string, unknown>;
  errors: FieldError[];
}

/**
 * Validates the PROVIDED keys against the active definitions that apply to the asset. `pointer` is
 * the JSON pointer of the custom_data object in the request (`/custom_data`, `/changes/custom_data`).
 */
export function validateProvided(
  defs: readonly FieldDef[],
  provided: Record<string, unknown>,
  pointer = '/custom_data',
): ValidatedCustomData {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const values: Record<string, unknown> = {};
  const errors: FieldError[] = [];
  for (const [key, raw] of Object.entries(provided)) {
    // Removing a key is always allowed (it is how a value left over from another category goes away).
    if (raw === null) {
      values[key] = null;
      continue;
    }
    const def = byKey.get(key);
    if (!def) {
      errors.push({
        pointer: `${pointer}/${escapePointer(key)}`,
        message: 'is not a custom field of this category',
        code: 'unknown-field',
      });
      continue;
    }
    const result = coerceValue(def, raw);
    if (result.ok) values[key] = result.value;
    else
      errors.push({
        pointer: `${pointer}/${escapePointer(key)}`,
        message: result.message,
        code: result.code,
      });
  }
  return { values, errors };
}

/** Required fields without a value in the FINAL custom_data. */
export function missingRequired(
  defs: readonly FieldDef[],
  finalData: Record<string, unknown>,
  pointer = '/custom_data',
): FieldError[] {
  return defs
    .filter((d) => d.required)
    .filter((d) => {
      const v = finalData[d.key];
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    })
    .map((d) => ({
      pointer: `${pointer}/${escapePointer(d.key)}`,
      message: 'is required',
      code: 'required',
    }));
}

/** PATCH merge: provided keys overwrite, `null` removes. */
export function mergeCustomData(
  existing: Record<string, unknown>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...existing };
  for (const [k, v] of Object.entries(values)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/**
 * Re-validates the whole stored object against the (new) set of applicable definitions, for a
 * category change: stored keys that the new category does not define are reported.
 */
export function validateWhole(
  defs: readonly FieldDef[],
  data: Record<string, unknown>,
  pointer = '/custom_data',
): FieldError[] {
  const { errors } = validateProvided(defs, data, pointer);
  return [...errors, ...missingRequired(defs, data, pointer)];
}

const escapePointer = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

// ----------------------------------------------------------------------- definition validation

/**
 * Patterns run on the single Node thread, against admin-defined regular expressions: refuse the
 * classic catastrophic shapes, a group that is itself quantified (`+ * {n,}`) and contains a
 * quantifier or an alternation, e.g. `(a+)+`, `(a|aa)*`, `(.*a){10,}`. A heuristic, backed by the
 * 200-character pattern cap and the 2,000-character input cap.
 */
export function hasNestedQuantifier(pattern: string): boolean {
  const stack: Array<{ quantified: boolean; alternation: boolean }> = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === '(') stack.push({ quantified: false, alternation: false });
    else if (ch === '|' && stack.length > 0) stack.at(-1)!.alternation = true;
    else if (ch === '+' || ch === '*' || (ch === '{' && /^\{\d+,\d*\}/.test(pattern.slice(i)))) {
      if (stack.length > 0) stack.at(-1)!.quantified = true;
    } else if (ch === ')') {
      const group = stack.pop();
      const next = pattern[i + 1];
      const repeats =
        next === '+' || next === '*' || (next === '{' && /^\{\d+,\d*\}/.test(pattern.slice(i + 1)));
      if (group && repeats && (group.quantified || group.alternation)) return true;
      // the enclosing group inherits "contains a quantifier" from a quantified inner group
      if (group && repeats && stack.length > 0) stack.at(-1)!.quantified = true;
    }
  }
  return false;
}

const VALIDATION_KEYS: Record<FieldType, readonly string[]> = {
  text: ['min_length', 'max_length', 'pattern'],
  long_text: ['min_length', 'max_length', 'pattern'],
  url: ['min_length', 'max_length', 'pattern'],
  email: ['min_length', 'max_length', 'pattern'],
  number: ['min', 'max', 'integer'],
  boolean: [],
  date: ['min', 'max'],
  select: [],
  multiselect: ['min_items', 'max_items'],
};

/** Field errors of a definition's own shape (options vs type, validation keys). */
export function validateDefinition(def: {
  dataType: FieldType;
  options: FieldOption[] | null | undefined;
  validation: Record<string, unknown> | null | undefined;
}): FieldError[] {
  const errors: FieldError[] = [];
  const isSelect = def.dataType === 'select' || def.dataType === 'multiselect';
  if (isSelect) {
    if (!def.options || def.options.length === 0) {
      errors.push({
        pointer: '/options',
        message: 'is required for select fields',
        code: 'required',
      });
    } else {
      const seen = new Set<string>();
      def.options.forEach((o, i) => {
        if (seen.has(o.value)) {
          errors.push({
            pointer: `/options/${i}/value`,
            message: 'is duplicated',
            code: 'duplicate',
          });
        }
        seen.add(o.value);
      });
    }
  } else if (def.options && def.options.length > 0) {
    errors.push({
      pointer: '/options',
      message: 'is only allowed for select fields',
      code: 'invalid',
    });
  }

  const allowed = VALIDATION_KEYS[def.dataType];
  for (const [key, value] of Object.entries(def.validation ?? {})) {
    const pointer = `/validation/${escapePointer(key)}`;
    if (!allowed.includes(key)) {
      errors.push({
        pointer,
        message: `is not a validation rule of ${def.dataType} fields (allowed: ${allowed.join(', ') || 'none'})`,
        code: 'unknown-field',
      });
      continue;
    }
    switch (key) {
      case 'min_length':
      case 'max_length':
      case 'min_items':
      case 'max_items':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
          errors.push({ pointer, message: 'must be a non-negative integer', code: 'type' });
        }
        break;
      case 'min':
      case 'max':
        if (def.dataType === 'date') {
          if (typeof value !== 'string' || !isRealDate(value)) {
            errors.push({ pointer, message: 'must be a date (YYYY-MM-DD)', code: 'format' });
          }
        } else if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push({ pointer, message: 'must be a number', code: 'type' });
        }
        break;
      case 'integer':
        if (typeof value !== 'boolean') {
          errors.push({ pointer, message: 'must be true or false', code: 'type' });
        }
        break;
      case 'pattern':
        if (typeof value !== 'string' || value.length > 200) {
          errors.push({
            pointer,
            message: 'must be a string of at most 200 characters',
            code: 'type',
          });
        } else {
          try {
            new RegExp(value, 'u');
            if (hasNestedQuantifier(value)) {
              errors.push({
                pointer,
                message:
                  'a quantified group may not contain another quantifier (catastrophic backtracking)',
                code: 'unsafe',
              });
            }
          } catch {
            errors.push({ pointer, message: 'is not a valid regular expression', code: 'format' });
          }
        }
        break;
    }
  }
  return errors;
}
