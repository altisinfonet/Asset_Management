import { describe, expect, it } from 'vitest';
import {
  SEARCH_TYPES,
  assetCreateSchema,
  assetListSchema,
  assetUpdateSchema,
  bulkUpdateSchema,
  cloneSchema,
} from './schemas.js';
import { formatAssetTag, tagPrefixFor } from './asset-tags.js';
import { assetDto, escapeLike, sortSpecFor, splitCustomFieldParams } from './asset-queries.js';
import { normaliseOptions } from './dto.js';
import { parseSort } from '../platform/index.js';

describe('asset tag template (M1-REG-06)', () => {
  const template = { prefix: '', width: 5, use_category_prefix: true };

  it('formats prefix + category prefix + zero-padded counter', () => {
    expect(formatAssetTag(template, 'LAP-', 42)).toBe('LAP-00042');
    expect(formatAssetTag({ ...template, prefix: 'AT-', width: 4 }, 'LAP-', 7)).toBe('AT-LAP-0007');
    expect(
      formatAssetTag({ ...template, use_category_prefix: false, prefix: 'ID' }, 'LAP-', 7),
    ).toBe('ID00007');
    expect(formatAssetTag(template, null, 123456)).toBe('123456');
  });

  it('counter keys are the full prefix, so categories number independently', () => {
    expect(tagPrefixFor(template, 'LAP-')).toBe('LAP-');
    expect(tagPrefixFor({ ...template, prefix: 'X-' }, 'MON-')).toBe('X-MON-');
    expect(tagPrefixFor({ ...template, use_category_prefix: false, prefix: 'X-' }, 'MON-')).toBe(
      'X-',
    );
  });
});

describe('request schemas', () => {
  it('asset create requires a category and rejects unknown fields (strict)', () => {
    expect(assetCreateSchema.safeParse({}).success).toBe(false);
    expect(assetCreateSchema.safeParse({ category_id: crypto.randomUUID() }).success).toBe(true);
    expect(
      assetCreateSchema.safeParse({ category_id: crypto.randomUUID(), colour: 'red' }).success,
    ).toBe(false);
  });

  it('asset update has no defaults (merge semantics) and accepts null to clear', () => {
    expect(assetUpdateSchema.parse({})).toEqual({});
    expect(assetUpdateSchema.parse({ name: null, model_id: null, purchase_cost: null })).toEqual({
      name: null,
      model_id: null,
      purchase_cost: null,
    });
    expect(assetUpdateSchema.safeParse({ status_id: null }).success).toBe(false);
  });

  it('tags may not contain whitespace or control characters', () => {
    const base = { category_id: crypto.randomUUID() };
    expect(assetCreateSchema.safeParse({ ...base, asset_tag: 'A B' }).success).toBe(false);
    expect(assetCreateSchema.safeParse({ ...base, asset_tag: 'A\u0007B' }).success).toBe(false);
    expect(assetCreateSchema.safeParse({ ...base, asset_tag: 'LAP-00042' }).success).toBe(true);
  });

  it('list query: comma separated filters, booleans and bounds', () => {
    const id = crypto.randomUUID();
    const q = assetListSchema.parse({
      category_id: `${id},${id}`,
      include_total: 'true',
      limit: '10',
      state_type: 'deployed,lost',
    });
    expect(q.category_id).toEqual([id, id]);
    expect(q.include_total).toBe(true);
    expect(q.limit).toBe(10);
    expect(q.state_type).toEqual(['deployed', 'lost']);
    expect(assetListSchema.safeParse({ state_type: 'nope' }).success).toBe(false);
    expect(assetListSchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(assetListSchema.safeParse({ category_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('bulk and clone bodies are bounded', () => {
    expect(bulkUpdateSchema.safeParse({ ids: [crypto.randomUUID()], changes: {} }).success).toBe(
      false,
    );
    expect(
      bulkUpdateSchema.safeParse({
        ids: [crypto.randomUUID()],
        changes: { status_id: crypto.randomUUID() },
      }).success,
    ).toBe(true);
    expect(cloneSchema.parse({}).count).toBe(1);
    expect(cloneSchema.safeParse({ count: 101 }).success).toBe(false);
    expect(cloneSchema.safeParse({ copy_fields: ['asset_tag'] }).success).toBe(false);
  });

  it('search types match the contract', () => {
    expect([...SEARCH_TYPES]).toEqual(['asset', 'model', 'category', 'person', 'location']);
  });
});

describe('query helpers', () => {
  it('escapeLike makes % _ and \\ literal', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('splits cf[key]=value out of the query', () => {
    const { rest, cf } = splitCustomFieldParams({ q: 'x', 'cf[os]': 'macOS', 'cf[ram_gb]': '16' });
    expect(rest).toEqual({ q: 'x' });
    expect(cf).toEqual([
      { key: 'os', raw: 'macOS' },
      { key: 'ram_gb', raw: '16' },
    ]);
    expect(() => splitCustomFieldParams({ 'cf[os]': ['a', 'b'] })).toThrow();
  });

  it('every public sort key has SQL, and nullable columns sort NULL smallest', () => {
    for (const key of [
      'created_at',
      'updated_at',
      'asset_tag',
      'name',
      'purchase_date',
      'warranty_end',
      'id',
    ]) {
      expect(sortSpecFor(key).expr).toBeTruthy();
    }
    expect(sortSpecFor('purchase_date').expr).toContain('coalesce');
    expect(() => sortSpecFor('serial')).toThrow();
    const terms = parseSort('-created_at,asset_tag', {
      sortable: { created_at: { kind: 'string' }, asset_tag: { kind: 'string' } },
      defaultSort: '-created_at',
    });
    expect(terms.map((t) => `${t.direction}:${t.key}`)).toEqual([
      'desc:created_at',
      'asc:asset_tag',
      'asc:id',
    ]);
  });

  it('the asset dto exposes money as {amount_minor, currency} and dates as YYYY-MM-DD', () => {
    const dto = assetDto({
      id: 'i',
      asset_tag: 't',
      label_code: 'l',
      name: null,
      serial: null,
      category_id: 'c',
      model_id: null,
      status_id: 's',
      location_id: null,
      company_id: 'co',
      vendor_id: null,
      parent_asset_id: null,
      purchase_date: new Date('2025-03-04T00:00:00Z'),
      purchase_cost_minor: 12345n,
      currency: 'EUR',
      order_number: null,
      warranty_end: null,
      notes: null,
      custom_data: {},
      external_source: null,
      external_id: null,
      created_at: new Date(0),
      updated_at: new Date(0),
      archived_at: null,
      version: 3,
      disposed_on: null,
      disposal_reason: null,
      disposal_note: null,
      status_name: 'Ready',
      status_state_type: 'deployable',
    });
    expect(dto.current_assignment).toBeNull();
    expect(dto.disposal).toBeNull();
    expect(dto.purchase_cost).toEqual({ amount_minor: 12345, currency: 'EUR' });
    expect(dto.purchase_date).toBe('2025-03-04');
    expect(dto.status).toEqual({ id: 's', name: 'Ready', state_type: 'deployable' });
    expect(dto.current_assignment).toBeNull();
    expect('version' in dto).toBe(false);
  });

  it('option lists read back canonically, also from legacy plain-string rows', () => {
    expect(normaliseOptions(['a', { value: 'b', label: 'B' }, { value: 'c' }, 7])).toEqual([
      { value: 'a', label: 'a' },
      { value: 'b', label: 'B' },
      { value: 'c' },
    ]);
    expect(normaliseOptions(null)).toBeNull();
  });
});
