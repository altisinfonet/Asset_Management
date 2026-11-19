import { beforeEach, describe, expect, it } from 'vitest';
import { CODE128_PATTERNS, code128Bars, code128Values } from './code128';
import {
  LABEL_CHOICE_KEY,
  cellSlot,
  codeTypeFrom,
  isSingleLabel,
  knownFields,
  readLabelChoice,
  sheetCount,
  sheetSlots,
  showsBarcode,
  showsQr,
  slotCell,
  slotsPerSheet,
  writeLabelChoice,
} from './helpers';

const avery = { cols: 3, rows: 10 };

describe('Code 128 (subset B)', () => {
  it('has 107 distinct patterns that add up to 11 modules (13 for the stop)', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((pattern, index) => {
      const widths = [...pattern].map(Number);
      expect(
        widths.reduce((a, b) => a + b, 0),
        `pattern ${index}`,
      ).toBe(index === 106 ? 13 : 11);
      expect(widths, `pattern ${index}`).toHaveLength(index === 106 ? 7 : 6);
      // the three bars of a symbol always take an even number of modules
      if (index !== 106)
        expect((widths[0]! + widths[2]! + widths[4]!) % 2, `pattern ${index}`).toBe(0);
    });
  });

  it('computes the check symbol (modulo 103) of a known value', () => {
    // "PJJ123C" in subset B: start 104, P=48, J=42, J=42, 1=17, 2=18, 3=19, C=35 -> 879 mod 103 = 55
    const values = code128Values('PJJ123C');
    expect(values).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
  });

  it('draws bars whose widths add up to the symbol length', () => {
    const { bars, modules } = code128Bars('AT-00123');
    // start + 8 characters + check + stop: 10 symbols of 11 modules, the stop has 13
    expect(modules).toBe(10 * 11 + 13);
    expect(bars[0]).toEqual([0, 2]); // start B begins with a bar of 2 modules
    expect(bars.at(-1)![0] + bars.at(-1)![1]).toBe(modules);
  });

  it('prints what it cannot encode as a question mark', () => {
    expect(code128Values('é')).toEqual(code128Values('?'));
  });
});

describe('sheet arithmetic', () => {
  it('counts slots and maps them to rows and columns', () => {
    expect(slotsPerSheet(avery)).toBe(30);
    expect(slotCell(1, avery)).toEqual({ row: 0, col: 0 });
    expect(slotCell(4, avery)).toEqual({ row: 1, col: 0 });
    expect(slotCell(30, avery)).toEqual({ row: 9, col: 2 });
    expect(cellSlot(9, 2, avery)).toBe(30);
    expect(isSingleLabel({ cols: 1, rows: 1 })).toBe(true);
    expect(isSingleLabel(avery)).toBe(false);
  });

  it('counts the sheets a run needs when the first one is partly used', () => {
    expect(sheetCount(0, 1, avery)).toBe(0);
    expect(sheetCount(30, 1, avery)).toBe(1);
    expect(sheetCount(31, 1, avery)).toBe(2);
    expect(sheetCount(24, 7, avery)).toBe(1); // slots 7..30
    expect(sheetCount(25, 7, avery)).toBe(2);
    expect(sheetCount(5, 30, avery)).toBe(1 + 1); // one on the first sheet, four on the next
  });

  it('shows which slots are used, filled and empty on every sheet', () => {
    const first = sheetSlots(1, 5, 7, avery);
    expect(first.slice(0, 6)).toEqual(Array(6).fill('used'));
    expect(first.slice(6, 11)).toEqual(Array(5).fill('label'));
    expect(first.slice(11).every((s) => s === 'empty')).toBe(true);

    const full = sheetSlots(1, 40, 7, avery);
    expect(full.filter((s) => s === 'label')).toHaveLength(24);
    const second = sheetSlots(2, 40, 7, avery);
    expect(second.filter((s) => s === 'label')).toHaveLength(16);
    expect(second.slice(0, 16).every((s) => s === 'label')).toBe(true);
    expect(second.slice(16).every((s) => s === 'empty')).toBe(true);
    expect(second.includes('used')).toBe(false);
  });
});

describe('codes and fields', () => {
  it('turns the two checkboxes into the API code type and back', () => {
    expect(codeTypeFrom(true, true)).toBe('qr_and_code128');
    expect(codeTypeFrom(true, false)).toBe('qr');
    expect(codeTypeFrom(false, true)).toBe('code128');
    expect(codeTypeFrom(false, false)).toBeNull();
    expect([showsQr('qr'), showsBarcode('qr')]).toEqual([true, false]);
    expect([showsQr('code128'), showsBarcode('code128')]).toEqual([false, true]);
    expect([showsQr('qr_and_code128'), showsBarcode('qr_and_code128')]).toEqual([true, true]);
  });

  it('keeps only the fields this screen knows, in its own order', () => {
    expect(knownFields(['name', 'tag', 'colour', 'organisation'])).toEqual([
      'tag',
      'name',
      'organisation',
    ]);
    expect(knownFields(undefined)).toEqual([]);
  });
});

describe('the remembered choice', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips through localStorage', () => {
    expect(readLabelChoice()).toBeNull();
    writeLabelChoice({ template_key: 'a4-21up', code_type: 'qr', fields: ['tag', 'serial'] });
    expect(readLabelChoice()).toEqual({
      template_key: 'a4-21up',
      code_type: 'qr',
      fields: ['tag', 'serial'],
    });
  });

  it('ignores a tampered value', () => {
    window.localStorage.setItem(LABEL_CHOICE_KEY, '{nope');
    expect(readLabelChoice()).toBeNull();
    window.localStorage.setItem(LABEL_CHOICE_KEY, JSON.stringify({ template_key: 5 }));
    expect(readLabelChoice()).toBeNull();
    window.localStorage.setItem(
      LABEL_CHOICE_KEY,
      JSON.stringify({ template_key: 'x', code_type: 'evil', fields: ['tag', '<script>'] }),
    );
    expect(readLabelChoice()).toEqual({ template_key: 'x', fields: ['tag'] });
  });

  it('survives storage that throws', () => {
    const original = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(readLabelChoice()).toBeNull();
      expect(() => writeLabelChoice({ template_key: 'x' })).not.toThrow();
    } finally {
      Storage.prototype.getItem = original;
      Storage.prototype.setItem = originalSet;
    }
  });
});
