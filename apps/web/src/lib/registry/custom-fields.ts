import type { Translator } from '@/i18n';
import type { CustomFieldDef } from './types';

/**
 * Custom field values. The API stores them in `asset.custom_data` keyed by the definition's `key`
 * (string, number, boolean, ISO date, option value, or an array of option values). Forms edit a
 * "raw" form of each value (text inputs hold strings) and convert on the way in and out, so the
 * type-specific parsing and validation live in one place and mirror what the server enforces.
 */
export type RawValue = string | boolean | string[];

export interface FieldRules {
  min?: number;
  max?: number;
  pattern?: string;
  max_length?: number;
}

export function rulesOf(def: Pick<CustomFieldDef, 'validation'>): FieldRules {
  return (def.validation ?? {}) as FieldRules;
}

export function emptyRaw(def: Pick<CustomFieldDef, 'data_type'>): RawValue {
  if (def.data_type === 'boolean') return false;
  if (def.data_type === 'multiselect') return [];
  return '';
}

/** API value -> what the form control edits. */
export function toRaw(def: Pick<CustomFieldDef, 'data_type'>, value: unknown): RawValue {
  if (value === undefined || value === null) return emptyRaw(def);
  switch (def.data_type) {
    case 'boolean':
      return value === true;
    case 'multiselect':
      return Array.isArray(value) ? value.map(String) : [];
    default:
      return String(value);
  }
}

/** True when the form holds nothing for this field (a checkbox that is off counts as a value). */
export function isBlank(
  def: Pick<CustomFieldDef, 'data_type'>,
  raw: RawValue | undefined,
): boolean {
  if (raw === undefined) return true;
  if (def.data_type === 'boolean') return false;
  if (Array.isArray(raw)) return raw.length === 0;
  return typeof raw === 'string' && raw.trim() === '';
}

/** What to send for a field; `undefined` means "leave it out". */
export function toApiValue(
  def: Pick<CustomFieldDef, 'data_type'>,
  raw: RawValue | undefined,
): string | number | boolean | string[] | undefined {
  if (raw === undefined) return undefined;
  if (def.data_type === 'boolean') return raw === true;
  if (isBlank(def, raw)) return undefined;
  if (def.data_type === 'number') return Number(String(raw).replace(',', '.'));
  if (def.data_type === 'multiselect') return raw as string[];
  return String(raw).trim();
}

export type FieldProblem =
  | { key: 'required' }
  | { key: 'number' }
  | { key: 'min'; min: number }
  | { key: 'max'; max: number }
  | { key: 'url' }
  | { key: 'email' }
  | { key: 'date' }
  | { key: 'option' }
  | { key: 'pattern' }
  | { key: 'maxLength'; max: number };

/** Client-side check of one raw value against its definition (the server re-validates). */
export function validateRaw(
  def: Pick<CustomFieldDef, 'data_type' | 'required' | 'options' | 'validation'>,
  raw: RawValue | undefined,
): FieldProblem | undefined {
  if (isBlank(def, raw)) return def.required ? { key: 'required' } : undefined;
  const rules = rulesOf(def);
  switch (def.data_type) {
    case 'number': {
      const n = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(n)) return { key: 'number' };
      if (rules.min !== undefined && n < rules.min) return { key: 'min', min: rules.min };
      if (rules.max !== undefined && n > rules.max) return { key: 'max', max: rules.max };
      return undefined;
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) && !Number.isNaN(Date.parse(String(raw)))
        ? undefined
        : { key: 'date' };
    case 'url':
      try {
        new URL(String(raw));
        return undefined;
      } catch {
        return { key: 'url' };
      }
    case 'email':
      return /^\S+@\S+\.\S+$/.test(String(raw)) ? undefined : { key: 'email' };
    case 'select':
      return def.options?.some((o) => o.value === raw) ? undefined : { key: 'option' };
    case 'multiselect':
      return (raw as string[]).every((v) => def.options?.some((o) => o.value === v))
        ? undefined
        : { key: 'option' };
    case 'text':
    case 'long_text': {
      const value = String(raw);
      if (rules.pattern) {
        try {
          if (!new RegExp(rules.pattern).test(value)) return { key: 'pattern' };
        } catch {
          // an invalid pattern in the definition is the server's problem, not the user's
        }
      }
      if (rules.max_length && value.length > rules.max_length) {
        return { key: 'maxLength', max: rules.max_length };
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

export function describeProblem(problem: FieldProblem, t: Translator['t']): string {
  switch (problem.key) {
    case 'required':
      return t('customFields.validation.required');
    case 'number':
      return t('customFields.validation.number');
    case 'min':
      return t('customFields.validation.min', { min: problem.min });
    case 'max':
      return t('customFields.validation.max', { max: problem.max });
    case 'url':
      return t('customFields.validation.url');
    case 'email':
      return t('customFields.validation.email');
    case 'date':
      return t('customFields.validation.date');
    case 'option':
      return t('customFields.validation.option');
    case 'pattern':
      return t('customFields.validation.pattern');
    case 'maxLength':
      return t('customFields.validation.maxLength', { max: problem.max });
  }
}

/** Read-only display text of a stored value (detail page, drawer, table cells). */
export function formatValue(
  def: Pick<CustomFieldDef, 'data_type' | 'options'>,
  value: unknown,
  i18n: Pick<Translator, 't' | 'formatDate' | 'formatNumber'>,
): string {
  if (value === undefined || value === null || value === '') return '';
  const label = (v: unknown) => def.options?.find((o) => o.value === v)?.label ?? String(v);
  switch (def.data_type) {
    case 'boolean':
      return value === true ? i18n.t('common.yes') : i18n.t('common.no');
    case 'number':
      return typeof value === 'number' ? i18n.formatNumber(value) : String(value);
    case 'date':
      return i18n.formatDate(`${String(value)}T00:00:00Z`, { timeZone: 'UTC' });
    case 'select':
      return label(value);
    case 'multiselect':
      return Array.isArray(value) ? value.map(label).join(', ') : String(value);
    default:
      return String(value);
  }
}

/** `Screen size (in)` -> `screen_size_in`: the suggested immutable key for a new field. */
export function suggestKey(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(slug) ? slug : slug ? `f_${slug}`.slice(0, 40) : '';
}
