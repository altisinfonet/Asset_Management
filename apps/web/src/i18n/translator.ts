import { en, type TranslationKey } from './messages/en';

export type Messages = typeof en;
export type TranslationValues = Record<string, string | number>;

export interface I18nConfig {
  /** BCP 47 locale used for formatting and plural rules. */
  locale: string;
  /** IANA time zone for date formatting; the browser zone when omitted. */
  timeZone?: string;
  /** ISO 4217 currency used by `formatCurrency` when none is given. */
  currency: string;
}

export interface Translator extends I18nConfig {
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatCurrency: (value: number, currency?: string) => string;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
}

export const defaultI18nConfig: I18nConfig = { locale: 'en', currency: 'USD' };

function lookup(messages: unknown, path: string): string | undefined {
  let cursor: unknown = messages;
  for (const part of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

function interpolate(template: string, values: TranslationValues | undefined): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/**
 * Build a translator. `messages` defaults to the English catalogue; a missing key returns the key
 * itself (visible in the UI and caught by the catalogue test) rather than throwing.
 */
export function createTranslator(
  config: Partial<I18nConfig> = {},
  messages: unknown = en,
): Translator {
  const cfg: I18nConfig = { ...defaultI18nConfig, ...config };
  const plurals = new Intl.PluralRules(cfg.locale);

  const t: Translator['t'] = (key, values) => {
    const count = values?.count;
    if (typeof count === 'number') {
      const found =
        lookup(messages, `${key}_${plurals.select(count)}`) ?? lookup(messages, `${key}_other`);
      if (found) return interpolate(found, values);
    }
    const direct = lookup(messages, key);
    return direct === undefined ? key : interpolate(direct, values);
  };

  const toDate = (v: Date | string | number) => (v instanceof Date ? v : new Date(v));

  return {
    ...cfg,
    t,
    formatNumber: (value, options) => new Intl.NumberFormat(cfg.locale, options).format(value),
    formatCurrency: (value, currency = cfg.currency) =>
      new Intl.NumberFormat(cfg.locale, { style: 'currency', currency }).format(value),
    formatDate: (value, options) =>
      new Intl.DateTimeFormat(cfg.locale, {
        dateStyle: 'medium',
        timeZone: cfg.timeZone,
        ...options,
      }).format(toDate(value)),
    formatDateTime: (value, options) =>
      new Intl.DateTimeFormat(cfg.locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: cfg.timeZone,
        ...options,
      }).format(toDate(value)),
  };
}
