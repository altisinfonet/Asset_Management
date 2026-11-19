import type { AssetListQuery } from './api';

/**
 * State of the assets list: free-text search, filters, sort and the visible columns. It is what a
 * "saved view" stores (in this browser only for now: `localStorage`, never state that matters).
 */
export type ArchivedFilter = 'exclude' | 'include' | 'only';
export type AssignedFilter = '' | 'yes' | 'no';

export type AssetSortKey =
  'asset_tag' | 'name' | 'purchase_date' | 'warranty_end' | 'created_at' | 'updated_at';

export interface AssetViewState {
  q: string;
  status_id: string;
  category_id: string;
  location_id: string;
  /** With a location: include its sublocations (the API default). */
  include_sublocations: boolean;
  /** Checked out (`yes`), in stock (`no`) or either (``). */
  assigned: AssignedFilter;
  /** Currently checked out to this person. */
  person_id: string;
  person_name: string;
  archived: ArchivedFilter;
  /** One custom field filter (`cf[key]=value`, exact match). */
  cf: { key: string; value: string } | null;
  /** Sort key with `-` for descending, or `''` for the default (newest first). */
  sort: string;
  /** Column ids in display order: standard ids plus `cf:<key>` for custom fields. */
  columns: string[];
}

export const STANDARD_COLUMNS = [
  'tag',
  'name',
  'model',
  'category',
  'status',
  'assignee',
  'due',
  'location',
  'serial',
  'vendor',
  'purchase_date',
  'warranty_end',
  'created_at',
] as const;

export const DEFAULT_COLUMNS = [
  'tag',
  'name',
  'model',
  'status',
  'assignee',
  'location',
  'warranty_end',
];

/** Which columns the server can sort by, and the API sort key behind each. */
export const SORT_KEY_BY_COLUMN: Record<string, AssetSortKey> = {
  tag: 'asset_tag',
  name: 'name',
  purchase_date: 'purchase_date',
  warranty_end: 'warranty_end',
  created_at: 'created_at',
};

export const COLUMN_BY_SORT_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(SORT_KEY_BY_COLUMN).map(([column, key]) => [key, column]),
);

export const PAGE_SIZE = 50;

export function defaultViewState(): AssetViewState {
  return {
    q: '',
    status_id: '',
    category_id: '',
    location_id: '',
    include_sublocations: true,
    assigned: '',
    person_id: '',
    person_name: '',
    archived: 'exclude',
    cf: null,
    sort: '',
    columns: [...DEFAULT_COLUMNS],
  };
}

export function hasActiveFilters(state: AssetViewState): boolean {
  return !!(
    state.q ||
    state.status_id ||
    state.category_id ||
    state.location_id ||
    state.assigned ||
    state.person_id ||
    state.archived !== 'exclude' ||
    state.cf
  );
}

/** The `GET /v1/assets` query for a view state and cursor. */
export function toAssetQuery(state: AssetViewState, cursor?: string): AssetListQuery {
  const query: AssetListQuery = {
    limit: PAGE_SIZE,
    include_total: true,
    expand: ['model', 'category', 'location', 'vendor'],
    archived: state.archived,
  };
  if (cursor) query.cursor = cursor;
  if (state.q.trim()) query.q = state.q.trim();
  if (state.status_id) query.status_id = [state.status_id];
  if (state.category_id) query.category_id = [state.category_id];
  if (state.location_id) {
    query.location_id = state.location_id;
    query.include_sublocations = state.include_sublocations;
  }
  if (state.assigned) query.assigned = state.assigned === 'yes';
  if (state.person_id) query.assigned_person_id = state.person_id;
  if (state.cf?.key && state.cf.value !== '') query.cf = { [state.cf.key]: state.cf.value };
  if (state.sort) query.sort = [state.sort as NonNullable<AssetListQuery['sort']>[number]];
  return query;
}

// ---- saved views (this browser only) ---------------------------------------------------------

export interface SavedView {
  id: string;
  name: string;
  state: AssetViewState;
}

export const SAVED_VIEWS_KEY = 'at-asset-views';
const MAX_VIEWS = 20;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/** Accept only well-formed stored state: a tampered or outdated value falls back to defaults. */
export function sanitiseState(value: unknown): AssetViewState {
  const base = defaultViewState();
  if (typeof value !== 'object' || value === null) return base;
  const raw = value as Record<string, unknown>;
  const archived = raw.archived;
  const cf = raw.cf as { key?: unknown; value?: unknown } | null | undefined;
  const columns = Array.isArray(raw.columns)
    ? raw.columns.filter(
        (c): c is string => typeof c === 'string' && /^(cf:)?[a-z0-9_]{1,40}$/.test(c),
      )
    : [];
  return {
    q: str(raw.q),
    status_id: str(raw.status_id),
    category_id: str(raw.category_id),
    location_id: str(raw.location_id),
    include_sublocations: raw.include_sublocations !== false,
    assigned: raw.assigned === 'yes' || raw.assigned === 'no' ? raw.assigned : '',
    person_id: str(raw.person_id),
    person_name: str(raw.person_name).slice(0, 200),
    archived: archived === 'include' || archived === 'only' ? archived : 'exclude',
    cf:
      cf && typeof cf.key === 'string' && typeof cf.value === 'string'
        ? { key: cf.key, value: cf.value }
        : null,
    sort: /^-?[a-z_]{1,20}$/.test(str(raw.sort)) ? str(raw.sort) : '',
    columns: columns.length > 0 ? columns.slice(0, 30) : base.columns,
  };
}

export function readSavedViews(): SavedView[] {
  try {
    const data: unknown = JSON.parse(window.localStorage.getItem(SAVED_VIEWS_KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data
      .flatMap((entry): SavedView[] => {
        if (typeof entry !== 'object' || entry === null) return [];
        const record = entry as Record<string, unknown>;
        if (typeof record.id !== 'string' || typeof record.name !== 'string') return [];
        return [
          { id: record.id, name: record.name.slice(0, 60), state: sanitiseState(record.state) },
        ];
      })
      .slice(0, MAX_VIEWS);
  } catch {
    return [];
  }
}

function writeSavedViews(views: SavedView[]): SavedView[] {
  const list = views.slice(0, MAX_VIEWS);
  try {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable (private mode, quota): the in-memory list is still returned
  }
  return list;
}

/** Save `state` under `name` (a view with the same name is replaced). */
export function saveView(name: string, state: AssetViewState): SavedView[] {
  const trimmed = name.trim().slice(0, 60);
  const existing = readSavedViews();
  const same = existing.find((v) => v.name.toLowerCase() === trimmed.toLowerCase());
  const entry: SavedView = {
    id: same?.id ?? `view-${Date.now().toString(36)}`,
    name: trimmed,
    state: { ...state, q: state.q },
  };
  return writeSavedViews([entry, ...existing.filter((v) => v.id !== entry.id)]);
}

export function deleteView(id: string): SavedView[] {
  return writeSavedViews(readSavedViews().filter((v) => v.id !== id));
}
