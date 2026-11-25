import { useQuery } from '@tanstack/react-query';
import { assetsApi, type AssetListQuery } from '@/lib/registry/api';
import { repairsApi } from '@/lib/repairs/api';
import { accessoriesApi, consumablesApi } from '@/lib/stock/api';

/**
 * What the dashboard reads. Only operations the API already has, and only `limit` pages with
 * `include_total=true`, so a count costs one small request.
 *
 * Tile definitions (the same filters open the asset list when a tile is clicked):
 * - Ready: `state_type=deployable`, assets that can be checked out.
 * - Assigned: `assigned=true`, assets with an open check-out (whoever holds them).
 * - Not deployable (key inRepair): `state_type=undeployable`. A repair moves the asset to an `undeployable` status
 *   label (`set_status_id`, see RepairsService), which is what blocks its check-out, and the status
 *   catalogue names that state type "Not deployable" (`status.undeployable`). Other undeployable
 *   labels, for example "Broken", count too: they are equally unavailable.
 * - Overdue: `overdue=true`, checked out with an expected return before today (UTC, server side).
 */
export const PANEL_SIZE = 5;
/** Overdue check-outs are read in one page of this size so the panel can show the oldest due dates first. */
const OVERDUE_WINDOW = 50;

export type TileId = 'ready' | 'assigned' | 'inRepair' | 'overdue';

export const TILE_QUERIES = {
  ready: { state_type: ['deployable'] },
  assigned: { assigned: true },
  inRepair: { state_type: ['undeployable'] },
  overdue: { overdue: true },
} as const satisfies Record<TileId, Partial<AssetListQuery>>;

const countQuery = (id: TileId): AssetListQuery => ({
  ...TILE_QUERIES[id],
  limit: 1,
  include_total: true,
});

/** The tile queries also feed the overdue panel: one request answers both. */
const overdueQuery = (): AssetListQuery => ({
  ...TILE_QUERIES.overdue,
  limit: OVERDUE_WINDOW,
  include_total: true,
});

/** Total of an asset count; a page without `total` (never with `include_total`) reads as 0. */
export function useAssetCount(id: Exclude<TileId, 'overdue'>, enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'count', id],
    queryFn: () => assetsApi.list(countQuery(id)),
    select: (page) => page.page.total ?? 0,
    enabled,
  });
}

/** Every asset the list shows by default (the denominator of the tiles' shares). */
export function useTotalAssets(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'count', 'total'],
    queryFn: () => assetsApi.list({ limit: 1, include_total: true }),
    select: (page) => page.page.total ?? 0,
    enabled,
  });
}

/**
 * The state types the status chart splits the fleet into. Every status label has exactly one state
 * type, so these counts partition the assets the list shows (archived records are left out by
 * default; assets with an `archived` status label are counted).
 */
export const CHART_STATE_TYPES = [
  'deployable',
  'deployed',
  'pending',
  'undeployable',
  'lost',
  'archived',
] as const;
export type ChartStateType = (typeof CHART_STATE_TYPES)[number];

/** One count per state type. `deployable` and `undeployable` share their cache with the tiles. */
export function useStateTypeCount(stateType: ChartStateType, enabled: boolean) {
  const tile =
    stateType === 'deployable' ? 'ready' : stateType === 'undeployable' ? 'inRepair' : null;
  return useQuery({
    queryKey: tile ? ['dashboard', 'count', tile] : ['dashboard', 'state', stateType],
    queryFn: () =>
      assetsApi.list(
        tile ? countQuery(tile) : { state_type: [stateType], limit: 1, include_total: true },
      ),
    select: (page) => page.page.total ?? 0,
    enabled,
  });
}

export function useOverdueAssets(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'overdue'],
    queryFn: () => assetsApi.list(overdueQuery()),
    select: (page) => {
      const rows = [...page.data].sort((a, b) =>
        (a.current_assignment?.expected_return ?? '').localeCompare(
          b.current_assignment?.expected_return ?? '',
        ),
      );
      return { total: page.page.total ?? rows.length, rows: rows.slice(0, PANEL_SIZE) };
    },
    enabled,
  });
}

export function useOpenRepairs(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'repairs'],
    // oldest report first: the one that has waited longest is the one that needs attention
    queryFn: () =>
      repairsApi.list({
        status: ['open', 'in_progress'],
        sort: ['reported_at'],
        limit: PANEL_SIZE,
        include_total: true,
      }),
    select: (page) => ({ total: page.page.total ?? page.data.length, rows: page.data }),
    enabled,
  });
}

export interface LowStockItem {
  kind: 'accessory' | 'consumable';
  id: string;
  name: string;
  left: number;
  min: number;
}

/** Accessories first, then consumables, `PANEL_SIZE` rows in all; the total counts both kinds. */
export function useLowStock(options: { accessories: boolean; consumables: boolean }) {
  return useQuery({
    queryKey: ['dashboard', 'low-stock', options.accessories, options.consumables],
    queryFn: async () => {
      const [accessories, consumables] = await Promise.all([
        options.accessories
          ? accessoriesApi.list({ low_stock: true, limit: PANEL_SIZE, include_total: true })
          : null,
        options.consumables
          ? consumablesApi.list({ low_stock: true, limit: PANEL_SIZE, include_total: true })
          : null,
      ]);
      const items: LowStockItem[] = [
        ...(accessories?.data ?? []).map((a) => ({
          kind: 'accessory' as const,
          id: a.id,
          name: a.name,
          left: a.qty_available ?? 0,
          min: a.min_qty ?? 0,
        })),
        ...(consumables?.data ?? []).map((c) => ({
          kind: 'consumable' as const,
          id: c.id,
          name: c.name,
          left: c.qty_on_hand ?? 0,
          min: c.min_qty ?? 0,
        })),
      ];
      return {
        total: (accessories?.page.total ?? 0) + (consumables?.page.total ?? 0),
        rows: items.slice(0, PANEL_SIZE),
      };
    },
    enabled: options.accessories || options.consumables,
  });
}
