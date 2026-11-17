import { describe, expect, it } from 'vitest';
import { en } from './messages/en';
import { createTranslator } from './translator';

function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    leafKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('translator', () => {
  const { t } = createTranslator({ locale: 'en' });

  it('looks up dotted keys and interpolates placeholders', () => {
    expect(t('nav.assets')).toBe('Assets');
    expect(t('table.selectRow', { label: 'AT-00124' })).toBe('Select row AT-00124');
  });

  it('pluralises by count', () => {
    expect(t('table.selected', { count: 1 })).toBe('1 row selected');
    expect(t('table.selected', { count: 3 })).toBe('3 rows selected');
  });

  it('returns the key for a missing message instead of throwing', () => {
    expect(t('nav.nope' as never)).toBe('nav.nope');
  });

  it('keeps unknown placeholders visible', () => {
    expect(t('table.selectRow')).toBe('Select row {label}');
  });

  it('has no empty messages and every plural base has both forms', () => {
    const keys = leafKeys(en);
    for (const key of keys) expect(key.length).toBeGreaterThan(0);
    for (const key of keys.filter((k) => k.endsWith('_one'))) {
      expect(keys).toContain(key.replace(/_one$/, '_other'));
    }
  });
});

describe('formatting helpers', () => {
  const i18n = createTranslator({ locale: 'en', timeZone: 'UTC', currency: 'USD' });

  it('formats numbers and currency for the locale', () => {
    expect(i18n.formatNumber(1234.5)).toBe('1,234.5');
    expect(i18n.formatCurrency(289)).toBe('$289.00');
    expect(i18n.formatCurrency(289, 'EUR')).toContain('289.00');
  });

  it('formats dates in the configured time zone', () => {
    expect(i18n.formatDate('2026-12-18T23:30:00Z')).toBe('Dec 18, 2026');
    const shifted = createTranslator({ locale: 'en', timeZone: 'Asia/Tokyo' });
    expect(shifted.formatDate('2026-12-18T23:30:00Z')).toBe('Dec 19, 2026');
  });
});
