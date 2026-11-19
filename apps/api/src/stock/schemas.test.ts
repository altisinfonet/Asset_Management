import { describe, expect, it } from 'vitest';
import {
  accessoryCheckinSchema,
  accessoryCheckoutSchema,
  accessoryCreateSchema,
  accessoryUpdateSchema,
  consumableCreateSchema,
  consumableUpdateSchema,
  stockMovementCreateSchema,
} from './schemas.js';
import { accessoryDto, consumableDto, isLow } from './dto.js';

const uuid = '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d91';

describe('stock movement body (M2-ACC-02)', () => {
  const ok = (v: unknown) => stockMovementCreateSchema.safeParse(v).success;

  it('the sign follows the reason', () => {
    expect(ok({ qty_delta: 5, reason: 'receive' })).toBe(true);
    expect(ok({ qty_delta: 1, reason: 'return' })).toBe(true);
    expect(ok({ qty_delta: -3, reason: 'issue' })).toBe(true);
    expect(ok({ qty_delta: -1, reason: 'receive' })).toBe(false);
    expect(ok({ qty_delta: -1, reason: 'return' })).toBe(false);
    expect(ok({ qty_delta: 1, reason: 'issue' })).toBe(false);
    expect(ok({ qty_delta: 0, reason: 'adjust', note: 'x' })).toBe(false);
  });

  it('an adjustment or correction needs a note saying why, either sign', () => {
    expect(ok({ qty_delta: -2, reason: 'adjust' })).toBe(false);
    expect(ok({ qty_delta: 2, reason: 'correction' })).toBe(false);
    expect(ok({ qty_delta: -2, reason: 'adjust', note: '   ' })).toBe(false);
    expect(ok({ qty_delta: -2, reason: 'adjust', note: 'count' })).toBe(true);
    expect(ok({ qty_delta: 2, reason: 'correction', note: 'typo' })).toBe(true);
  });

  it('is strict: no unknown members, whole numbers only, person is a uuid or null', () => {
    expect(ok({ qty_delta: 1, reason: 'receive', balance_after: 4 })).toBe(false);
    expect(ok({ qty_delta: 1.5, reason: 'receive' })).toBe(false);
    expect(ok({ qty_delta: -1, reason: 'issue', person_id: 'nope' })).toBe(false);
    expect(ok({ qty_delta: -1, reason: 'issue', person_id: null })).toBe(true);
    expect(ok({ qty_delta: -1, reason: 'issue', person_id: uuid })).toBe(true);
  });
});

describe('accessory and consumable bodies', () => {
  it('create needs category, name and (accessory) the total; update has no defaults', () => {
    expect(accessoryCreateSchema.safeParse({ category_id: uuid, name: 'x' }).success).toBe(false);
    expect(
      accessoryCreateSchema.safeParse({ category_id: uuid, name: ' Cable ', qty_total: 3 }).data,
    ).toEqual({ category_id: uuid, name: 'Cable', qty_total: 3 });
    expect(accessoryUpdateSchema.parse({})).toEqual({});
    expect(accessoryUpdateSchema.safeParse({ qty_available: 1 }).success).toBe(false);
    expect(consumableCreateSchema.safeParse({ category_id: uuid, name: 'x' }).success).toBe(true);
    expect(
      consumableCreateSchema.safeParse({ category_id: uuid, name: 'x', qty_on_hand: 1 }).success,
    ).toBe(false);
    expect(consumableUpdateSchema.safeParse({ qty_on_hand: 1 }).success).toBe(false);
    expect(consumableUpdateSchema.parse({})).toEqual({});
  });

  it('check-out has exactly one target and a positive quantity (default 1); check-in names the assignment', () => {
    expect(accessoryCheckoutSchema.parse({ person_id: uuid })).toEqual({
      person_id: uuid,
      quantity: 1,
    });
    expect(accessoryCheckoutSchema.safeParse({}).success).toBe(false);
    expect(accessoryCheckoutSchema.safeParse({ person_id: uuid, location_id: uuid }).success).toBe(
      false,
    );
    expect(accessoryCheckoutSchema.safeParse({ person_id: uuid, quantity: 0 }).success).toBe(false);
    expect(accessoryCheckinSchema.safeParse({ quantity: 1 }).success).toBe(false);
    expect(accessoryCheckinSchema.safeParse({ assignment_id: uuid, quantity: 2 }).success).toBe(
      true,
    );
  });
});

describe('derived members', () => {
  it('low stock needs a minimum and is at-or-below', () => {
    expect(isLow(3, 3)).toBe(true);
    expect(isLow(4, 3)).toBe(false);
    expect(isLow(0, 0)).toBe(false);
  });

  const at = new Date('2026-01-01T00:00:00Z');
  const base = {
    id: uuid,
    tenant_id: uuid,
    company_id: uuid,
    category_id: uuid,
    category_kind: 'accessory',
    manufacturer_id: null,
    vendor_id: null,
    location_id: null,
    name: 'Cable',
    model_number: null,
    min_qty: 2,
    currency: null,
    notes: null,
    label_code: 'a'.repeat(32),
    low_stock_alerted: false,
    created_at: at,
    updated_at: at,
    created_by: null,
    updated_by: null,
    archived_at: null,
    version: 1,
    search_text: 'cable',
  };

  it('an accessory shows units out, available units and the low-stock flag', () => {
    const dto = accessoryDto(
      { ...base, qty_total: 5, purchase_date: null, purchase_cost_minor: null } as never,
      3,
    );
    expect(dto).toMatchObject({
      qty_total: 5,
      qty_checked_out: 3,
      qty_available: 2,
      low_stock: true,
    });
  });

  it('a consumable shows the balance and the flag, money as { amount_minor, currency }', () => {
    const dto = consumableDto({
      ...base,
      category_kind: 'consumable',
      unit: 'box',
      qty_on_hand: 9,
      unit_cost_minor: 1250n,
      currency: 'EUR',
    } as never);
    expect(dto).toMatchObject({
      qty_on_hand: 9,
      low_stock: false,
      unit: 'box',
      unit_cost: { amount_minor: 1250, currency: 'EUR' },
    });
  });
});
