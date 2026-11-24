import { describe, expect, it } from 'vitest';
import {
  changedKeys,
  discardedCustom,
  emptyAssetForm,
  formFromAsset,
  mergeEdits,
  pointerToKey,
  toCreateBody,
  toMinorUnits,
  toUpdateBody,
  validateAssetForm,
} from './asset-form';
import type { Asset, CustomFieldDef } from './types';

const field = (
  key: string,
  data_type: CustomFieldDef['data_type'],
  extra: Partial<CustomFieldDef> = {},
) =>
  ({
    id: `f-${key}`,
    key,
    label: key,
    data_type,
    required: false,
    position: 1,
    show_in_list: false,
    ...extra,
  }) as CustomFieldDef;

const FIELDS = [
  field('os_version', 'text', { required: true }),
  field('screen_size', 'number', { validation: { min: 5, max: 20 } }),
  field('managed', 'boolean'),
];

const ASSET = {
  id: 'a1',
  asset_tag: 'AT-00124',
  name: 'Chromebook 3100',
  serial: 'SN123',
  category_id: 'cat1',
  model_id: 'm1',
  status_id: 's1',
  location_id: 'l1',
  department_id: 'd1',
  vendor_id: 'v1',
  purchase_date: '2026-01-02',
  purchase_cost: { amount_minor: 28900, currency: 'USD' },
  order_number: 'PO-1',
  warranty_end: '2029-01-02',
  notes: 'cart 3',
  custom_data: { os_version: 'ChromeOS 126', screen_size: 11.6, managed: true, legacy: 'x' },
} as unknown as Asset;

describe('asset form state', () => {
  it('an edit loads every field including custom values', () => {
    const form = formFromAsset(ASSET, FIELDS);
    expect(form).toMatchObject({
      tagMode: 'manual',
      asset_tag: 'AT-00124',
      serial: 'SN123',
      cost: '289.00',
      custom: { os_version: 'ChromeOS 126', screen_size: '11.6', managed: true },
    });
  });

  it('a clone keeps everything except tag and serial, and numbers the tag automatically', () => {
    const form = formFromAsset(ASSET, FIELDS, { clone: true });
    expect(form).toMatchObject({
      tagMode: 'auto',
      asset_tag: '',
      serial: '',
      category_id: 'cat1',
      model_id: 'm1',
      location_id: 'l1',
      department_id: 'd1',
      vendor_id: 'v1',
      notes: 'cart 3',
      custom: { os_version: 'ChromeOS 126' },
    });
  });

  it('converts typed money to minor units', () => {
    expect(toMinorUnits('289.00')).toBe(28900);
    expect(toMinorUnits('289,5')).toBe(28950);
    expect(toMinorUnits('')).toBeNull();
    expect(toMinorUnits('abc')).toBeNull();
    expect(toMinorUnits('-1')).toBeNull();
  });
});

describe('client-side validation', () => {
  it('requires a category, a manual tag, valid money and dates, and custom fields', () => {
    const state = {
      ...emptyAssetForm(),
      tagMode: 'manual' as const,
      cost: 'x',
      warranty_end: '2026-99-99',
    };
    const keys = validateAssetForm(state, FIELDS).map((p) => p.key);
    expect(keys).toEqual(['category_id', 'asset_tag', 'cost', 'warranty_end', 'cf:os_version']);
  });

  it('passes a complete form and reports a failing custom field by key', () => {
    const ok = formFromAsset(ASSET, FIELDS);
    expect(validateAssetForm(ok, FIELDS)).toEqual([]);
    const bad = { ...ok, custom: { ...ok.custom, screen_size: '99' } };
    expect(validateAssetForm(bad, FIELDS)).toEqual([
      { key: 'cf:screen_size', problem: { key: 'max', max: 20 } },
    ]);
  });
});

describe('request bodies', () => {
  it('create: omits the tag in auto mode, defaults the name to the model, converts money', () => {
    const state = {
      ...emptyAssetForm('s1'),
      category_id: 'cat1',
      model_id: 'm1',
      cost: '289.00',
      custom: { os_version: 'ChromeOS 126', screen_size: '11.6', managed: false },
    };
    const body = toCreateBody(state, FIELDS, { currency: 'USD', modelName: 'Dell 3100' });
    expect(body).toEqual({
      category_id: 'cat1',
      model_id: 'm1',
      name: 'Dell 3100',
      status_id: 's1',
      purchase_cost: { amount_minor: 28900, currency: 'USD' },
      custom_data: { os_version: 'ChromeOS 126', screen_size: 11.6, managed: false },
    });
    expect(body).not.toHaveProperty('asset_tag');
    const manual = toCreateBody({ ...state, tagMode: 'manual', asset_tag: ' X-1 ' }, FIELDS, {
      currency: 'USD',
    });
    expect(manual.asset_tag).toBe('X-1');
  });

  it('the department goes on create when chosen, and is cleared with null on update', () => {
    const state = { ...emptyAssetForm('s1'), category_id: 'cat1', department_id: 'd1' };
    expect(toCreateBody(state, FIELDS, { currency: 'USD' }).department_id).toBe('d1');
    expect(
      toCreateBody({ ...state, department_id: '' }, FIELDS, { currency: 'USD' }),
    ).not.toHaveProperty('department_id');
    const edit = formFromAsset(ASSET, FIELDS);
    expect(toUpdateBody(edit, FIELDS, ASSET, { currency: 'USD' }).department_id).toBe('d1');
    expect(
      toUpdateBody({ ...edit, department_id: '' }, FIELDS, ASSET, { currency: 'USD' })
        .department_id,
    ).toBeNull();
  });

  it('update: clears emptied fields with null and removes custom keys that are gone', () => {
    const state = {
      ...formFromAsset(ASSET, FIELDS),
      serial: '',
      notes: '',
      cost: '',
      custom: { os_version: 'ChromeOS 127', screen_size: '', managed: true },
    };
    const body = toUpdateBody(state, FIELDS, ASSET, { currency: 'USD' });
    expect(body).toMatchObject({
      serial: null,
      notes: null,
      purchase_cost: null,
      custom_data: { os_version: 'ChromeOS 127', managed: true, screen_size: null, legacy: null },
    });
  });
});

describe('412 merge', () => {
  const base = formFromAsset(ASSET, FIELDS);
  const fresh = { ...base, notes: 'changed by someone else', serial: 'SN-THEIRS' };

  it('keeps what I changed and takes everything else from the latest version', () => {
    const mine = {
      ...base,
      serial: 'SN-MINE',
      custom: { ...base.custom, os_version: 'ChromeOS 200' },
    };
    const merged = mergeEdits(base, mine, fresh);
    expect(merged.serial).toBe('SN-MINE'); // I changed it
    expect(merged.notes).toBe('changed by someone else'); // they changed it, I did not
    expect(merged.custom.os_version).toBe('ChromeOS 200');
    expect(merged.custom.screen_size).toBe('11.6');
  });

  it('lists the differing fields', () => {
    expect(changedKeys(base, fresh)).toEqual(['serial', 'notes']);
    expect(changedKeys(base, { ...base, custom: { ...base.custom, managed: false } })).toEqual([
      'cf:managed',
    ]);
  });
});

describe('category change and error pointers', () => {
  it('warns about typed values the new category would discard', () => {
    const state = formFromAsset(ASSET, FIELDS);
    const laptopFields = [field('ram_gb', 'number')];
    const dropped = discardedCustom(state, laptopFields, FIELDS);
    expect(dropped.map((d) => d.key)).toEqual(['os_version', 'screen_size']); // not the checkbox
  });

  it('maps API pointers to form keys', () => {
    expect(pointerToKey('/custom_data/os_version')).toBe('cf:os_version');
    expect(pointerToKey('/purchase_cost')).toBe('cost');
    expect(pointerToKey('/asset_tag')).toBe('asset_tag');
  });
});
