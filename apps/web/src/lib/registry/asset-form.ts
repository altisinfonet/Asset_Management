import {
  emptyRaw,
  isBlank,
  toApiValue,
  toRaw,
  validateRaw,
  type FieldProblem,
  type RawValue,
} from './custom-fields';
import type { Asset, AssetCreate, AssetUpdate, CustomFieldDef } from './types';

/**
 * Form state of the asset create / edit screen, and its conversion to the API bodies. Pure
 * functions (no React) so the rules - what a clone copies, what a PATCH sends, how the 412 merge
 * keeps the user's edits - are unit-tested on their own.
 */
export interface AssetFormState {
  category_id: string;
  model_id: string;
  name: string;
  tagMode: 'auto' | 'manual';
  asset_tag: string;
  serial: string;
  status_id: string;
  location_id: string;
  purchase_date: string;
  /** Major units as typed ("289.00"); converted to minor units on save. */
  cost: string;
  vendor_id: string;
  order_number: string;
  warranty_end: string;
  notes: string;
  custom: Record<string, RawValue>;
}

export const emptyAssetForm = (defaultStatusId = ''): AssetFormState => ({
  category_id: '',
  model_id: '',
  name: '',
  tagMode: 'auto',
  asset_tag: '',
  serial: '',
  status_id: defaultStatusId,
  location_id: '',
  purchase_date: '',
  cost: '',
  vendor_id: '',
  order_number: '',
  warranty_end: '',
  notes: '',
  custom: {},
});

/** Form state for an existing asset; a clone keeps everything except the tag and the serial. */
export function formFromAsset(
  asset: Asset,
  fields: readonly CustomFieldDef[],
  options: { clone?: boolean } = {},
): AssetFormState {
  const custom: Record<string, RawValue> = {};
  for (const def of fields) custom[def.key] = toRaw(def, asset.custom_data?.[def.key]);
  return {
    category_id: asset.category_id,
    model_id: asset.model_id ?? '',
    name: asset.name ?? '',
    tagMode: options.clone ? 'auto' : 'manual',
    asset_tag: options.clone ? '' : asset.asset_tag,
    serial: options.clone ? '' : (asset.serial ?? ''),
    status_id: asset.status_id,
    location_id: asset.location_id ?? '',
    purchase_date: asset.purchase_date ?? '',
    cost: asset.purchase_cost ? (asset.purchase_cost.amount_minor / 100).toFixed(2) : '',
    vendor_id: asset.vendor_id ?? '',
    order_number: asset.order_number ?? '',
    warranty_end: asset.warranty_end ?? '',
    notes: asset.notes ?? '',
    custom,
  };
}

/** Major units to integer minor units, or null when empty or not a number. */
export function toMinorUnits(text: string): number | null {
  const n = Number(text.replace(',', '.'));
  if (!text.trim() || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export interface FormProblem {
  /** Form field key: a state key or `cf:<custom field key>`. */
  key: string;
  problem: FieldProblem | 'required' | 'cost' | 'date';
}

/** Client-side checks before a request is sent (the server re-validates everything). */
export function validateAssetForm(
  state: AssetFormState,
  fields: readonly CustomFieldDef[],
): FormProblem[] {
  const problems: FormProblem[] = [];
  if (!state.category_id) problems.push({ key: 'category_id', problem: 'required' });
  if (state.tagMode === 'manual' && !state.asset_tag.trim()) {
    problems.push({ key: 'asset_tag', problem: 'required' });
  }
  if (state.cost.trim() && toMinorUnits(state.cost) === null) {
    problems.push({ key: 'cost', problem: 'cost' });
  }
  for (const key of ['purchase_date', 'warranty_end'] as const) {
    const value = state[key];
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) {
      problems.push({ key, problem: 'date' });
    }
  }
  for (const def of fields) {
    const problem = validateRaw(def, state.custom[def.key]);
    if (problem) problems.push({ key: `cf:${def.key}`, problem });
  }
  return problems;
}

function customBody(
  state: AssetFormState,
  fields: readonly CustomFieldDef[],
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const def of fields) {
    const value = toApiValue(def, state.custom[def.key]);
    if (value !== undefined) out[def.key] = value;
  }
  return out;
}

/** `POST /v1/assets` body. An empty tag in auto mode is left out (the server numbers it). */
export function toCreateBody(
  state: AssetFormState,
  fields: readonly CustomFieldDef[],
  options: { currency: string; modelName?: string },
): AssetCreate {
  const cost = toMinorUnits(state.cost);
  const name = state.name.trim() || options.modelName || undefined;
  return {
    category_id: state.category_id,
    ...(state.model_id ? { model_id: state.model_id } : {}),
    ...(name ? { name } : {}),
    ...(state.tagMode === 'manual' && state.asset_tag.trim()
      ? { asset_tag: state.asset_tag.trim() }
      : {}),
    ...(state.serial.trim() ? { serial: state.serial.trim() } : {}),
    ...(state.status_id ? { status_id: state.status_id } : {}),
    ...(state.location_id ? { location_id: state.location_id } : {}),
    ...(state.vendor_id ? { vendor_id: state.vendor_id } : {}),
    ...(state.purchase_date ? { purchase_date: state.purchase_date } : {}),
    ...(state.warranty_end ? { warranty_end: state.warranty_end } : {}),
    ...(cost !== null ? { purchase_cost: { amount_minor: cost, currency: options.currency } } : {}),
    ...(state.order_number.trim() ? { order_number: state.order_number.trim() } : {}),
    ...(state.notes.trim() ? { notes: state.notes.trim() } : {}),
    custom_data: customBody(state, fields),
  };
}

/**
 * `PATCH /v1/assets/{id}` body (merge semantics): every editable field is sent, a cleared nullable
 * field as `null`, and a custom value that was removed (cleared, or no longer applicable after a
 * category change) as `null` so the server drops the key.
 */
export function toUpdateBody(
  state: AssetFormState,
  fields: readonly CustomFieldDef[],
  original: Asset,
  options: { currency: string },
): AssetUpdate {
  const cost = toMinorUnits(state.cost);
  const custom: Record<string, unknown> = customBody(state, fields);
  for (const key of Object.keys(original.custom_data ?? {})) {
    if (!(key in custom)) custom[key] = null;
  }
  return {
    category_id: state.category_id,
    model_id: state.model_id || null,
    name: state.name.trim() || null,
    asset_tag: state.asset_tag.trim() || undefined,
    serial: state.serial.trim() || null,
    status_id: state.status_id || undefined,
    location_id: state.location_id || null,
    vendor_id: state.vendor_id || null,
    purchase_date: state.purchase_date || null,
    warranty_end: state.warranty_end || null,
    purchase_cost:
      cost !== null
        ? { amount_minor: cost, currency: original.purchase_cost?.currency ?? options.currency }
        : null,
    order_number: state.order_number.trim() || null,
    notes: state.notes.trim() || null,
    custom_data: custom,
  };
}

const SIMPLE_KEYS = [
  'category_id',
  'model_id',
  'name',
  'tagMode',
  'asset_tag',
  'serial',
  'status_id',
  'location_id',
  'purchase_date',
  'cost',
  'vendor_id',
  'order_number',
  'warranty_end',
  'notes',
] as const;

const sameRaw = (a: RawValue | undefined, b: RawValue | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Three-way merge after a `412` ("someone else saved first"): start from the freshly loaded
 * server version and re-apply only the fields this user changed relative to what they started
 * from, so their edits survive and nothing they did not touch is overwritten by stale data.
 */
export function mergeEdits(
  base: AssetFormState,
  mine: AssetFormState,
  fresh: AssetFormState,
): AssetFormState {
  const merged: AssetFormState = { ...fresh, custom: { ...fresh.custom } };
  for (const key of SIMPLE_KEYS) {
    if (mine[key] !== base[key]) (merged as unknown as Record<string, unknown>)[key] = mine[key];
  }
  for (const key of new Set([...Object.keys(base.custom), ...Object.keys(mine.custom)])) {
    if (!sameRaw(mine.custom[key], base.custom[key])) {
      merged.custom[key] = mine.custom[key] ?? emptyRaw({ data_type: 'text' });
    }
  }
  return merged;
}

/** The fields that differ between two form states (for the "what changed" list). */
export function changedKeys(a: AssetFormState, b: AssetFormState): string[] {
  const keys: string[] = SIMPLE_KEYS.filter((k) => a[k] !== b[k]);
  for (const key of new Set([...Object.keys(a.custom), ...Object.keys(b.custom)])) {
    if (!sameRaw(a.custom[key], b.custom[key])) keys.push(`cf:${key}`);
  }
  return keys;
}

/** Custom values the user typed that a new category would discard (fields that no longer apply). */
export function discardedCustom(
  state: AssetFormState,
  allowed: readonly CustomFieldDef[],
  allFields: readonly CustomFieldDef[],
): CustomFieldDef[] {
  const keep = new Set(allowed.map((d) => d.key));
  return allFields.filter(
    (def) =>
      !keep.has(def.key) && !isBlank(def, state.custom[def.key]) && def.data_type !== 'boolean',
  );
}

/** Map an API `errors[].pointer` to a form field key. */
export function pointerToKey(pointer: string): string {
  if (pointer.startsWith('/custom_data/')) return `cf:${pointer.slice('/custom_data/'.length)}`;
  if (pointer === '/purchase_cost') return 'cost';
  return pointer.replace(/^\//, '');
}
