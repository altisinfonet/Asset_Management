import type { FieldError } from '../platform/index.js';
import { Prisma, type Tx } from '../tenancy/index.js';
import { ASSET_FROM, assetConditions, assetSortTerms, orderBySql } from './asset-queries.js';
import { type AssetListQuery, assetListSchema } from './schemas.js';

/**
 * Selecting assets for bulk work (labels, M2-TAG-02; exports and bulk screens later): the SAME filter
 * language as `GET /v1/assets`, answered with ids only, in the list's own order (default: tag order).
 * Lives with the registry because the list's WHERE clause is the registry's; other modules call it
 * through the facade (`registry/index.ts`).
 */

/** Filters a bulk selection accepts: every list filter that narrows the set (no paging, no expansion, no `cf[...]`). */
export const ASSET_SELECTION_KEYS = [
  'q',
  'archived',
  'tag',
  'serial',
  'status_id',
  'state_type',
  'category_id',
  'model_id',
  'manufacturer_id',
  'location_id',
  'include_sublocations',
  'assigned',
  'assigned_person_id',
  'overdue',
  'company_id',
  'vendor_id',
  'parent_asset_id',
  'warranty_end_before',
  'warranty_end_after',
  'purchase_date_from',
  'purchase_date_to',
  'updated_since',
  'sort',
] as const;

export type AssetSelectionFilter = Record<string, unknown>;

/** Query-string text of a JSON filter value (the list's own parsers take strings: `a,b` lists, `true`). */
const asQueryValue = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(String).join(',') : typeof v === 'boolean' ? String(v) : v;

/** Validates a JSON filter with the list's schema; field errors point at `<pointer>/<key>`. */
export function parseAssetSelection(
  filter: AssetSelectionFilter,
  pointer: string,
): { ok: true; query: AssetListQuery } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const query: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (!(ASSET_SELECTION_KEYS as readonly string[]).includes(key)) {
      errors.push({
        pointer: `${pointer}/${key}`,
        message: 'Not a filter an asset selection supports.',
        code: 'unknown-filter',
      });
    } else query[key] = asQueryValue(value);
  }
  if (errors.length > 0) return { ok: false, errors };
  // tag order is what a person expects on a label sheet; the list's own default is newest first
  const parsed = assetListSchema.safeParse({ sort: 'asset_tag', ...query });
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        pointer: `${pointer}/${String(i.path[0] ?? '')}`,
        message: i.message,
        code: i.code,
      })),
    };
  }
  return { ok: true, query: parsed.data };
}

/**
 * Ids of the assets matching `query`, at most `max`; `more` is true when there were further matches.
 * Runs under the caller's tenant transaction (RLS scopes it), ordered like the list.
 */
export async function selectAssetIds(
  trx: Tx,
  query: AssetListQuery,
  max: number,
): Promise<{ ids: string[]; more: boolean }> {
  const conditions = assetConditions(query, []);
  const where = conditions.length > 0 ? Prisma.join(conditions, ' and ') : Prisma.sql`true`;
  const rows = await trx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`select a.id ${ASSET_FROM} where ${where}
      order by ${orderBySql(assetSortTerms(query.sort))} limit ${max + 1}`,
  );
  return { ids: rows.slice(0, max).map((r) => r.id), more: rows.length > max };
}

/** What a label needs of an asset. */
export interface LabelAssetRow {
  id: string;
  asset_tag: string;
  label_code: string;
  name: string | null;
  serial: string | null;
  model_name: string | null;
  location_name: string | null;
}

/**
 * The label data of `ids`, IN THE ORDER OF `ids` (print order). An id that does not exist in the
 * tenant is simply absent (RLS: another tenant's asset does not exist here); compare lengths.
 */
export async function loadLabelAssets(trx: Tx, ids: readonly string[]): Promise<LabelAssetRow[]> {
  if (ids.length === 0) return [];
  return trx.$queryRaw<LabelAssetRow[]>`
    select a.id, a.asset_tag, a.label_code, a.name, a.serial,
           m.name as model_name, l.name as location_name
      from unnest(${ids as string[]}::uuid[]) with ordinality as want(id, n)
      join app.asset a on a.id = want.id
      left join app.asset_model m on m.tenant_id = a.tenant_id and m.id = a.model_id
      left join app.location l on l.tenant_id = a.tenant_id and l.id = a.location_id
     order by want.n`;
}
