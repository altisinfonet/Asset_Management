import { describe, expect, it } from 'vitest';
import type { Accessory, Consumable } from './api';
import {
  adjustmentDelta,
  levelOf,
  outstanding,
  parseCount,
  shelfShare,
  stockLevel,
  unitsLeft,
} from './helpers';

const accessory = (extra: Partial<Accessory>): Accessory =>
  ({
    id: 'a',
    category_id: 'c',
    name: 'Charger',
    qty_total: 10,
    min_qty: 3,
    ...extra,
  }) as Accessory;
const consumable = (extra: Partial<Consumable>): Consumable =>
  ({
    id: 'c',
    category_id: 'c',
    name: 'Paper',
    min_qty: 5,
    qty_on_hand: 20,
    ...extra,
  }) as Consumable;

describe('stock levels', () => {
  it('is out at zero, low at or below a set minimum, else ok', () => {
    expect(stockLevel(0, 5)).toBe('out');
    expect(stockLevel(0, 0)).toBe('out');
    expect(stockLevel(5, 5)).toBe('low');
    expect(stockLevel(3, 5)).toBe('low');
    expect(stockLevel(6, 5)).toBe('ok');
    // a minimum of 0 means "no alert"
    expect(stockLevel(1, 0)).toBe('ok');
  });

  it('reads the right quantity for each kind', () => {
    const a = accessory({ qty_available: 2 });
    expect(unitsLeft(a, 'accessory')).toBe(2);
    expect(levelOf(a, 'accessory')).toBe('low');
    const c = consumable({ qty_on_hand: 0 });
    expect(unitsLeft(c, 'consumable')).toBe(0);
    expect(levelOf(c, 'consumable')).toBe('out');
    expect(unitsLeft(accessory({}), 'accessory')).toBe(0);
  });

  it('computes the share of the shelf that is left', () => {
    expect(shelfShare(accessory({ qty_available: 5 }), 'accessory')).toBe(0.5);
    expect(shelfShare(accessory({ qty_total: 0, qty_available: 0 }), 'accessory')).toBe(0);
    expect(shelfShare(consumable({ qty_on_hand: 10, min_qty: 5 }), 'consumable')).toBe(1);
    expect(shelfShare(consumable({ qty_on_hand: 5, min_qty: 5 }), 'consumable')).toBe(0.5);
  });
});

describe('quantities', () => {
  it('knows what is still out of a partly returned hand-out', () => {
    expect(outstanding({ quantity: 8, quantity_returned: 3 })).toBe(5);
    expect(outstanding({ quantity: 2, quantity_returned: 2 })).toBe(0);
    expect(outstanding({ quantity: 2, quantity_returned: 5 })).toBe(0);
  });

  it('turns a count into the delta the ledger records', () => {
    expect(adjustmentDelta(24, 20)).toBe(-4);
    expect(adjustmentDelta(24, 30)).toBe(6);
    expect(adjustmentDelta(24, 24)).toBe(0);
  });

  it('accepts only whole numbers', () => {
    expect(parseCount('12')).toBe(12);
    expect(parseCount(' 0 ')).toBe(0);
    for (const bad of ['', '1.5', '-1', 'x', '1e3', '1234567890'])
      expect(parseCount(bad)).toBeNull();
  });
});
