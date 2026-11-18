import { describe, expect, it } from 'vitest';
import {
  type FieldDef,
  coerceValue,
  hasNestedQuantifier,
  mergeCustomData,
  missingRequired,
  validateDefinition,
  validateProvided,
  validateWhole,
} from './custom-fields.js';

const def = (over: Partial<FieldDef> & Pick<FieldDef, 'key' | 'dataType'>): FieldDef => ({
  label: over.key,
  required: false,
  options: null,
  validation: null,
  ...over,
});

describe('coerceValue (M1-REG-04: type coercion)', () => {
  it('numbers: accepts numbers and numeric strings, enforces min / max / integer', () => {
    const d = def({
      key: 'ram',
      dataType: 'number',
      validation: { min: 1, max: 64, integer: true },
    });
    expect(coerceValue(d, 16)).toEqual({ ok: true, value: 16 });
    expect(coerceValue(d, '16')).toEqual({ ok: true, value: 16 });
    expect(coerceValue(d, ' 8 ')).toEqual({ ok: true, value: 8 });
    expect(coerceValue(d, '0')).toMatchObject({ ok: false, code: 'too_small' });
    expect(coerceValue(d, 65)).toMatchObject({ ok: false, code: 'too_big' });
    expect(coerceValue(d, 1.5)).toMatchObject({ ok: false, code: 'type' });
    expect(coerceValue(d, 'sixteen')).toMatchObject({ ok: false, code: 'type' });
    expect(coerceValue(d, Number.NaN)).toMatchObject({ ok: false });
    expect(coerceValue(d, true)).toMatchObject({ ok: false, code: 'type' });
  });

  it('booleans: true / false and their string forms only', () => {
    const d = def({ key: 'enc', dataType: 'boolean' });
    expect(coerceValue(d, true)).toEqual({ ok: true, value: true });
    expect(coerceValue(d, 'false')).toEqual({ ok: true, value: false });
    expect(coerceValue(d, 'yes')).toMatchObject({ ok: false });
    expect(coerceValue(d, 1)).toMatchObject({ ok: false });
  });

  it('dates: real calendar dates only, with min / max', () => {
    const d = def({
      key: 'd',
      dataType: 'date',
      validation: { min: '2020-01-01', max: '2030-12-31' },
    });
    expect(coerceValue(d, '2025-02-28')).toEqual({ ok: true, value: '2025-02-28' });
    expect(coerceValue(d, '2025-02-30')).toMatchObject({ ok: false, code: 'format' });
    expect(coerceValue(d, '2025-2-3')).toMatchObject({ ok: false });
    expect(coerceValue(d, '2019-12-31')).toMatchObject({ ok: false, code: 'too_small' });
    expect(coerceValue(d, '2031-01-01')).toMatchObject({ ok: false, code: 'too_big' });
  });

  it('select / multiselect: only listed options; multiselect de-duplicates', () => {
    const options = [{ value: 'a' }, { value: 'b' }, { value: 'c' }];
    const one = def({ key: 's', dataType: 'select', options });
    expect(coerceValue(one, 'b')).toEqual({ ok: true, value: 'b' });
    expect(coerceValue(one, 'z')).toMatchObject({ ok: false, code: 'invalid_option' });
    const many = def({ key: 'm', dataType: 'multiselect', options, validation: { max_items: 2 } });
    expect(coerceValue(many, ['a', 'b', 'a'])).toEqual({ ok: true, value: ['a', 'b'] });
    expect(coerceValue(many, ['a', 'b', 'c'])).toMatchObject({ ok: false, code: 'too_big' });
    expect(coerceValue(many, ['a', 'q'])).toMatchObject({ ok: false, code: 'invalid_option' });
    expect(coerceValue(many, 'a')).toMatchObject({ ok: false, code: 'type' });
  });

  it('text / url / email: length, pattern and format', () => {
    const text = def({
      key: 't',
      dataType: 'text',
      validation: { pattern: '^[A-Z]{2}-\\d+$', max_length: 8 },
    });
    expect(coerceValue(text, 'AB-123')).toEqual({ ok: true, value: 'AB-123' });
    expect(coerceValue(text, 'ab-123')).toMatchObject({ ok: false, code: 'pattern' });
    expect(coerceValue(text, 'AB-123456')).toMatchObject({ ok: false, code: 'too_big' });
    expect(coerceValue(text, 12)).toMatchObject({ ok: false, code: 'type' });
    const url = def({ key: 'u', dataType: 'url' });
    expect(coerceValue(url, 'https://example.com/x')).toMatchObject({ ok: true });
    expect(coerceValue(url, 'javascript:alert(1)')).toMatchObject({ ok: false, code: 'format' });
    expect(coerceValue(url, 'not a url')).toMatchObject({ ok: false, code: 'format' });
    const mail = def({ key: 'e', dataType: 'email' });
    expect(coerceValue(mail, 'a@b.co')).toMatchObject({ ok: true });
    expect(coerceValue(mail, 'a@b')).toMatchObject({ ok: false });
  });
});

describe('validateProvided / missingRequired / merge', () => {
  const defs = [
    def({ key: 'ram', dataType: 'number', required: true }),
    def({ key: 'os', dataType: 'select', options: [{ value: 'macOS' }, { value: 'Linux' }] }),
  ];

  it('rejects unknown keys with a JSON pointer, coerces known ones', () => {
    const r = validateProvided(defs, { ram: '16', colour: 'red', os: 'BeOS' });
    expect(r.values).toEqual({ ram: 16 });
    expect(r.errors.map((e) => `${e.pointer}:${e.code}`).sort()).toEqual([
      '/custom_data/colour:unknown-field',
      '/custom_data/os:invalid_option',
    ]);
  });

  it('null removes a key and escapes JSON pointer characters', () => {
    expect(validateProvided(defs, { os: null }).values).toEqual({ os: null });
    expect(validateProvided(defs, { 'a/b': 1 }, '/changes/custom_data').errors[0]!.pointer).toBe(
      '/changes/custom_data/a~1b',
    );
  });

  it('required fields must end up with a value', () => {
    expect(missingRequired(defs, {})).toEqual([
      { pointer: '/custom_data/ram', message: 'is required', code: 'required' },
    ]);
    expect(missingRequired(defs, { ram: 8 })).toEqual([]);
    expect(missingRequired(defs, { ram: null })).toHaveLength(1);
  });

  it('mergeCustomData overwrites, adds and removes (null)', () => {
    expect(mergeCustomData({ a: 1, b: 2 }, { b: null, c: 3, a: 9 })).toEqual({ a: 9, c: 3 });
  });

  it('validateWhole reports unknown stored keys and missing required ones', () => {
    const errors = validateWhole(defs, { os: 'macOS', legacy: 1 });
    expect(errors.map((e) => e.code).sort()).toEqual(['required', 'unknown-field']);
  });
});

describe('validateDefinition', () => {
  it('select needs options, others forbid them', () => {
    expect(
      validateDefinition({ dataType: 'select', options: null, validation: null })[0]!.pointer,
    ).toBe('/options');
    expect(
      validateDefinition({ dataType: 'select', options: [{ value: 'a' }], validation: null }),
    ).toEqual([]);
    expect(
      validateDefinition({ dataType: 'text', options: [{ value: 'a' }], validation: null })[0]!
        .code,
    ).toBe('invalid');
  });

  it('rejects duplicate options', () => {
    const e = validateDefinition({
      dataType: 'multiselect',
      options: [{ value: 'a' }, { value: 'a' }],
      validation: null,
    });
    expect(e.map((x) => x.pointer)).toEqual(['/options/1/value']);
  });

  it('validates the rules allowed for the type', () => {
    expect(
      validateDefinition({
        dataType: 'number',
        options: null,
        validation: { min: 0, max: 5, integer: true },
      }),
    ).toEqual([]);
    expect(
      validateDefinition({ dataType: 'number', options: null, validation: { pattern: 'x' } })[0]!
        .code,
    ).toBe('unknown-field');
    expect(
      validateDefinition({ dataType: 'text', options: null, validation: { pattern: '(' } })[0]!
        .code,
    ).toBe('format');
    expect(
      validateDefinition({ dataType: 'text', options: null, validation: { min_length: -1 } })[0]!
        .code,
    ).toBe('type');
    expect(
      validateDefinition({ dataType: 'date', options: null, validation: { min: '2025-13-01' } })[0]!
        .code,
    ).toBe('format');
    expect(
      validateDefinition({ dataType: 'boolean', options: null, validation: { min: 1 } })[0]!.code,
    ).toBe('unknown-field');
  });
});

describe('hasNestedQuantifier (ReDoS guard)', () => {
  it.each(['^(a+)+$', '(a|aa)*', '^(.*a){10,}$', '((ab)+c*)+', '^(\\d+\\.?)*$'])(
    'rejects %s',
    (p) => {
      expect(hasNestedQuantifier(p)).toBe(true);
      expect(
        validateDefinition({ dataType: 'text', options: null, validation: { pattern: p } })[0]
          ?.code,
      ).toBe('unsafe');
    },
  );
  it.each([
    '^v\\d+\\.\\d+$',
    '^[A-Z]{2}-\\d+$',
    '^([0-9a-f]{2}:){5}[0-9a-f]{2}$',
    '^(abc)?x+$',
    '^[a+]+$',
    '^\\(a+\\)$',
  ])('accepts %s', (p) => {
    expect(hasNestedQuantifier(p)).toBe(false);
  });
});
