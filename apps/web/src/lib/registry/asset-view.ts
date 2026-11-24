import type { AssetListQuery } from './api';

/**
 * State of the assets list: free-text search, filters, sort and the visible columns. It is what a
 * "saved view" stores (in this browser only for now: `localStorage`, never state that matters).
 */
export type ArchivedFilter = 'exclude' | 'include' | 'only';
export type AssignedFilter = '' | 'yes' | 'no';

/** State types the list can filter by (`state_type`); archived assets have their own filter. */
export const STATE_TYPE_FILTERS = [
  'deployable',
  'deployed',
  'pending',
  'undeployable',
  'lost',
] as const;
export type StateTypeFilter = '' | (typeof STATE_TYPE_FILTERS)[number];

export const isStateTypeFilter = (value: unknown): value is (typeof STATE_TYPE_FILTERS)[number] =>
  typeof value === 'string' && (STATE_TYPE_FILTERS as readonly string[]).includes(value);

export type AssetSortKey =
  'asset_tag' | 'name' | 'purchase_date' | 'warranty_end' | 'created_at' | 'updated_at';

export interface AssetViewState {
  q: string;
  status_id: string;
  /** Any status label of this state type (the dashboard tiles link here). */
  state_type: StateTypeFilter;
  category_id: string;
  location_id: string;
  /** Owned by this department (ED-17). */
  department_id: string;
  /** With a location: include its sublocations (the API default). */
  include_sublocations: boolean;
  /** Checked out (`yes`), in stock (`no`) or either (``). */
  assigned: AssignedFilter;
  /** Only checked-out assets that are past their expected return date. */
  overdue: boolean;
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
  'department',
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
    state_type: '',
    category_id: '',
    location_id: '',
    department_id: '',
    include_sublocations: true,
    assigned: '',
    overdue: false,
    person_id: '',
    person_name: '',
    archived: 'exclude',
    cf: null,
    sort: '',
    columns: [...DEFAULT_COLUMNS],
  };
}

/**
 * The filters a link can open the list with: `?location=`, `?person=` (locations tree, a person's
 * page) and `?state_type=`, `?assigned=yes`, `?overdue=1` (the dashboard tiles).
 */
export function stateFromLink(params: { get(name: string): string | null }): AssetViewState {
  const stateType = params.get('state_type');
  const overdue = params.get('overdue');
  return {
    ...defaultViewState(),
    location_id: params.get('location') ?? '',
    department_id: params.get('department') ?? '',
    person_id: params.get('person') ?? '',
    state_type: isStateTypeFilter(stateType) ? stateType : '',
    assigned: params.get('assigned') === 'yes' ? 'yes' : '',
    overdue: overdue === '1' || overdue === 'true',
  };
}

export function hasActiveFilters(state: AssetViewState): boolean {
  return !!(
    state.q ||
    state.status_id ||
    state.state_type ||
    state.category_id ||
    state.location_id ||
    state.department_id ||
    state.assigned ||
    state.overdue ||
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
    expand: ['model', 'category', 'location', 'vendor', 'department'],
    archived: state.archived,
  };
  if (cursor) query.cursor = cursor;
  if (state.q.trim()) query.q = state.q.trim();
  if (state.status_id) query.status_id = [state.status_id];
  if (state.state_type) query.state_type = [state.state_type];
  if (state.category_id) query.category_id = [state.category_id];
  if (state.location_id) {
    query.location_id = state.location_id;
    query.include_sublocations = state.include_sublocations;
  }
  if (state.department_id) query.department_id = state.department_id;
  if (state.assigned) query.assigned = state.assigned === 'yes';
  if (state.overdue) query.overdue = true;
  if (state.person_id) query.assigned_person_id = state.person_id;
  if (state.cf?.key && state.cf.value !== '') query.cf = { [state.cf.key]: state.cf.value };
  if (state.sort) query.sort = [state.sort as NonNullable<AssetListQuery['sort']>[number]];
  return query;
}

// ---- the views the earlier version kept in this browser ----------------------------------------

export interface SavedView {
  id: string;
  name: string;
  state: AssetViewState;
}

/** Where the earlier version kept saved views; they move to the server on first load (`lib/views`). */
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
    state_type: isStateTypeFilter(raw.state_type) ? raw.state_type : '',
    category_id: str(raw.category_id),
    location_id: str(raw.location_id),
    department_id: str(raw.department_id),
    include_sublocations: raw.include_sublocations !== false,
    assigned: raw.assigned === 'yes' || raw.assigned === 'no' ? raw.assigned : '',
    overdue: raw.overdue === true,
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
