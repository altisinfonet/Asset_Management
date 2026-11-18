import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/i18n/translator';
import {
  describeProblem,
  emptyRaw,
  formatValue,
  isBlank,
  suggestKey,
  toApiValue,
  toRaw,
  validateRaw,
} from './custom-fields';
import type { CustomFieldType } from './types';

const def = (
  data_type: CustomFieldType,
  extra: Partial<Parameters<typeof validateRaw>[0]> = {},
): Parameters<typeof validateRaw>[0] => ({
  data_type,
  required: false,
  options: null,
  validation: null,
  ...extra,
});

describe('custom field values', () => {
  it('converts API values to form values and back for every type', () => {
    expect(toRaw(def('text'), undefined)).toBe('');
    expect(toRaw(def('number'), 11.6)).toBe('11.6');
    expect(toRaw(def('boolean'), true)).toBe(true);
    expect(toRaw(def('boolean'), undefined)).toBe(false);
    expect(toRaw(def('multiselect'), ['a', 'b'])).toEqual(['a', 'b']);
    expect(toRaw(def('multiselect'), null)).toEqual([]);

    expect(toApiValue(def('number'), '11,6')).toBe(11.6);
    expect(toApiValue(def('text'), '  hello ')).toBe('hello');
    expect(toApiValue(def('text'), '   ')).toBeUndefined();
    expect(toApiValue(def('boolean'), false)).toBe(false);
    expect(toApiValue(def('multiselect'), [])).toBeUndefined();
    expect(toApiValue(def('multiselect'), ['x'])).toEqual(['x']);
    expect(emptyRaw(def('multiselect'))).toEqual([]);
  });

  it('knows what is blank (an unchecked box is a value, an empty list is not)', () => {
    expect(isBlank(def('text'), '  ')).toBe(true);
    expect(isBlank(def('boolean'), false)).toBe(false);
    expect(isBlank(def('multiselect'), [])).toBe(true);
    expect(isBlank(def('number'), '0')).toBe(false);
  });

  describe('validation mirrors the server rules', () => {
    it('required', () => {
      expect(validateRaw(def('text', { required: true }), '')).toEqual({ key: 'required' });
      expect(validateRaw(def('text'), '')).toBeUndefined();
      expect(validateRaw(def('multiselect', { required: true }), [])).toEqual({ key: 'required' });
      expect(validateRaw(def('boolean', { required: true }), false)).toBeUndefined();
    });

    it('number with min and max', () => {
      const d = def('number', { validation: { min: 5, max: 20 } });
      expect(validateRaw(d, 'abc')).toEqual({ key: 'number' });
      expect(validateRaw(d, '4')).toEqual({ key: 'min', min: 5 });
      expect(validateRaw(d, '21')).toEqual({ key: 'max', max: 20 });
      expect(validateRaw(d, '11,6')).toBeUndefined();
    });

    it('date, url, email', () => {
      expect(validateRaw(def('date'), '2026-13-40')).toEqual({ key: 'date' });
      expect(validateRaw(def('date'), '2026-11-02')).toBeUndefined();
      expect(validateRaw(def('url'), 'not a url')).toEqual({ key: 'url' });
      expect(validateRaw(def('url'), 'https://example.org/x')).toBeUndefined();
      expect(validateRaw(def('email'), 'nope')).toEqual({ key: 'email' });
      expect(validateRaw(def('email'), 'a@b.co')).toBeUndefined();
    });

    it('select and multi-select only accept the options', () => {
      const options = [{ value: 'good' }, { value: 'fair' }];
      expect(validateRaw(def('select', { options }), 'poor')).toEqual({ key: 'option' });
      expect(validateRaw(def('select', { options }), 'fair')).toBeUndefined();
      expect(validateRaw(def('multiselect', { options }), ['good', 'bad'])).toEqual({
        key: 'option',
      });
      expect(validateRaw(def('multiselect', { options }), ['good'])).toBeUndefined();
    });

    it('text pattern and max length', () => {
      const d = def('text', { validation: { pattern: '^[0-9]{15}$', max_length: 15 } });
      expect(validateRaw(d, '123')).toEqual({ key: 'pattern' });
      expect(validateRaw(d, '123456789012345')).toBeUndefined();
      expect(validateRaw(def('long_text', { validation: { max_length: 3 } }), 'abcd')).toEqual({
        key: 'maxLength',
        max: 3,
      });
    });

    it('describes each problem in words', () => {
      const { t } = createTranslator();
      expect(describeProblem({ key: 'min', min: 5 }, t)).toBe('Must be at least 5.');
      expect(describeProblem({ key: 'required' }, t)).toBe('This field is required.');
    });
  });

  it('formats stored values for display', () => {
    const i18n = createTranslator({ timeZone: 'UTC' });
    const select = def('select', { options: [{ value: 'good', label: 'Good' }] });
    expect(formatValue(select, 'good', i18n)).toBe('Good');
    expect(formatValue(def('boolean'), true, i18n)).toBe('Yes');
    expect(formatValue(def('boolean'), false, i18n)).toBe('No');
    expect(formatValue(def('number'), 1234.5, i18n)).toBe('1,234.5');
    expect(formatValue(def('date'), '2026-11-02', i18n)).toBe('Nov 2, 2026');
    expect(
      formatValue(def('multiselect', { options: [{ value: 'a', label: 'A' }] }), ['a', 'z'], i18n),
    ).toBe('A, z');
    expect(formatValue(def('text'), undefined, i18n)).toBe('');
  });

  it('suggests a key from the label', () => {
    expect(suggestKey('Screen size (in)')).toBe('screen_size_in');
    expect(suggestKey('  OS Version ')).toBe('os_version');
    expect(suggestKey('3G modem')).toBe('f_3g_modem');
    expect(suggestKey('!!!')).toBe('');
  });
});
