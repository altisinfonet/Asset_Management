import {
  defaultViewState,
  readSavedViews,
  sanitiseState,
  SAVED_VIEWS_KEY,
  type AssetViewState,
  type SavedView as LocalSavedView,
} from '@/lib/registry/asset-view';
import type { SavedView, SavedViewDefinition } from './api';

/**
 * Saved views on the server (M2-REG-01): the wire shape `{ filters, columns, sort }` and the list's
 * `AssetViewState` convert into each other here; a view that points at something that no longer
 * exists degrades to the closest valid state plus a list of what was dropped (so the screen can warn).
 */

/** The server definition of a list state. */
export function toDefinition(state: AssetViewState): SavedViewDefinition {
  const { columns, sort, ...filters } = state;
  return { filters: { ...filters }, columns: [...columns], sort: sort || null };
}

/** The list state of a definition; anything malformed falls back to the defaults. */
export function fromDefinition(definition: SavedViewDefinition): AssetViewState {
  return sanitiseState({
    ...definition.filters,
    columns: definition.columns,
    sort: definition.sort ?? '',
  });
}

/** What a stored view refers to that the catalogue no longer has. */
export type DroppedPart = 'status' | 'category' | 'location' | 'field' | 'column';

export interface ViewReferences {
  statusIds: ReadonlySet<string>;
  categoryIds: ReadonlySet<string>;
  locationIds: ReadonlySet<string>;
  fieldKeys: ReadonlySet<string>;
  /** Until the catalogue lists have loaded nothing can be judged stale. */
  ready: boolean;
}

/**
 * Drop references to a deleted status, category, location or custom field. A location list that is
 * empty because the API does not serve it is not "everything deleted": the check is skipped for
 * lists that came back empty.
 */
export function degradeState(
  state: AssetViewState,
  refs: ViewReferences,
): { state: AssetViewState; dropped: DroppedPart[] } {
  if (!refs.ready) return { state, dropped: [] };
  const dropped = new Set<DroppedPart>();
  const next: AssetViewState = { ...state };
  if (next.status_id && refs.statusIds.size > 0 && !refs.statusIds.has(next.status_id)) {
    next.status_id = '';
    dropped.add('status');
  }
  if (next.category_id && refs.categoryIds.size > 0 && !refs.categoryIds.has(next.category_id)) {
    next.category_id = '';
    dropped.add('category');
  }
  if (next.location_id && refs.locationIds.size > 0 && !refs.locationIds.has(next.location_id)) {
    next.location_id = '';
    dropped.add('location');
  }
  if (next.cf && !refs.fieldKeys.has(next.cf.key)) {
    next.cf = null;
    dropped.add('field');
  }
  const columns = next.columns.filter(
    (column) => !column.startsWith('cf:') || refs.fieldKeys.has(column.slice(3)),
  );
  if (columns.length !== next.columns.length) {
    next.columns = columns.length > 0 ? columns : defaultViewState().columns;
    dropped.add('column');
  }
  return { state: next, dropped: [...dropped] };
}

// ---- the views kept in this browser before they moved to the server ---------------------------------

export const MIGRATED_KEY = 'at-asset-views-migrated';

/** Views still in this browser's storage that have not been moved yet. */
export function pendingLocalViews(): LocalSavedView[] {
  try {
    if (window.localStorage.getItem(MIGRATED_KEY)) return [];
  } catch {
    return [];
  }
  return readSavedViews();
}

/** Remember that the local views were handled (and drop them) so they are never moved twice. */
export function markMigrated(): void {
  try {
    window.localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
    window.localStorage.removeItem(SAVED_VIEWS_KEY);
  } catch {
    // storage unavailable: the views stay where they are and the move is tried again next time
  }
}

export interface MigrationResult {
  moved: number;
  skipped: number;
  failed: number;
}

/**
 * Create every local view on the server (personal). A name the user already has there is skipped
 * (the server's copy wins). Local views are removed only when none failed, so a flaky network
 * loses nothing: the next load tries again.
 */
export async function migrateLocalViews(
  local: LocalSavedView[],
  existing: Pick<SavedView, 'name' | 'shared' | 'owner_user_id'>[],
  userId: string,
  create: (view: { name: string; shared: boolean; definition: SavedViewDefinition }) => Promise<unknown>,
): Promise<MigrationResult> {
  const taken = new Set(
    existing.filter((v) => v.owner_user_id === userId).map((v) => v.name.toLowerCase()),
  );
  const result: MigrationResult = { moved: 0, skipped: 0, failed: 0 };
  for (const view of local) {
    if (taken.has(view.name.toLowerCase())) {
      result.skipped += 1;
      continue;
    }
    try {
      await create({ name: view.name, shared: false, definition: toDefinition(view.state) });
      taken.add(view.name.toLowerCase());
      result.moved += 1;
    } catch {
      result.failed += 1;
    }
  }
  if (result.failed === 0) markMigrated();
  return result;
}
