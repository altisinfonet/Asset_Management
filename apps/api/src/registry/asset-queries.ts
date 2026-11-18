import { ApiProblem, type SortTerm, parseSort } from '../platform/index.js';
import { Prisma, type Tx } from '../tenancy/index.js';
import { isoDate } from './dto.js';
import type { AssetListQuery } from './schemas.js';

/**
 * SQL of the asset list, lookup and search (M1-REG-07, M1-REG-08). Raw tagged SQL on purpose: the
 * list needs trigram / full-text / JSONB containment predicates and a keyset cursor on
 * microsecond-precision timestamps, none of which Prisma's query builder expresses. Every value is
 * a bound parameter; the only `Prisma.raw` text comes from the fixed {@link SORTS} table below.
 * Tenant scoping is RLS (the transaction's `app.tenant_id`), never a parameter.
 */

/** The row shape the asset queries return (joined with its status label). */
export interface AssetRow {
  id: string;
  asset_tag: string;
  label_code: string;
  name: string | null;
  serial: string | null;
  category_id: string;
  model_id: string | null;
  status_id: string;
  location_id: string | null;
  company_id: string;
  vendor_id: string | null;
  parent_asset_id: string | null;
  purchase_date: Date | null;
  purchase_cost_minor: bigint | null;
  currency: string | null;
  order_number: string | null;
  warranty_end: Date | null;
  notes: string | null;
  custom_data: Record<string, unknown>;
  external_source: string | null;
  external_id: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  version: number;
  status_name: string;
  status_state_type: string;
  [sortKey: `k${number}`]: string;
}

export const ASSET_COLUMNS = Prisma.sql`a.id, a.asset_tag, a.label_code, a.name, a.serial, a.category_id,
  a.model_id, a.status_id, a.location_id, a.company_id, a.vendor_id, a.parent_asset_id, a.purchase_date,
  a.purchase_cost_minor, a.currency, a.order_number, a.warranty_end, a.notes, a.custom_data,
  a.external_source, a.external_id, a.created_at, a.updated_at, a.archived_at, a.version`;

/**
 * No join with the status label: it would let the planner start from the 7-row label table and
 * scan assets per status (a bad plan for exact tag lookups). Status names are attached to the page
 * of rows afterwards ({@link withStatus}), one query over at most a handful of labels.
 */
export const ASSET_FROM = Prisma.sql`from app.asset a`;

/** Attaches `status_name` / `status_state_type` to rows fetched without the status join. */
export async function withStatus(
  trx: Tx,
  rows: Array<Omit<AssetRow, 'status_name' | 'status_state_type'>>,
): Promise<AssetRow[]> {
  if (rows.length === 0) return [];
  const labels = await trx.status_label.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.status_id))] } },
    select: { id: true, name: true, state_type: true },
  });
  const byId = new Map(labels.map((l) => [l.id, l]));
  return rows.map((r) => {
    const label = byId.get(r.status_id);
    return { ...r, status_name: label?.name ?? '', status_state_type: label?.state_type ?? '' };
  });
}

export function assetDto(r: AssetRow, expanded?: Record<string, unknown>) {
  return {
    id: r.id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    archived_at: r.archived_at ? r.archived_at.toISOString() : null,
    asset_tag: r.asset_tag,
    name: r.name,
    serial: r.serial,
    category_id: r.category_id,
    model_id: r.model_id,
    status_id: r.status_id,
    location_id: r.location_id,
    company_id: r.company_id,
    vendor_id: r.vendor_id,
    parent_asset_id: r.parent_asset_id,
    purchase_date: isoDate(r.purchase_date),
    purchase_cost:
      r.purchase_cost_minor === null || r.currency === null
        ? null
        : { amount_minor: Number(r.purchase_cost_minor), currency: r.currency },
    order_number: r.order_number,
    warranty_end: isoDate(r.warranty_end),
    notes: r.notes,
    custom_data: r.custom_data,
    external_source: r.external_source,
    external_id: r.external_id,
    label_code: r.label_code,
    current_assignment: null as null,
    status: { id: r.status_id, name: r.status_name, state_type: r.status_state_type },
    ...(expanded ? { expanded } : {}),
  };
}
export type AssetDto = ReturnType<typeof assetDto>;
export const ASSET_FIELDS = Object.keys(
  assetDto({
    id: '',
    asset_tag: '',
    label_code: '',
    name: null,
    serial: null,
    category_id: '',
    model_id: null,
    status_id: '',
    location_id: null,
    company_id: '',
    vendor_id: null,
    parent_asset_id: null,
    purchase_date: null,
    purchase_cost_minor: null,
    currency: null,
    order_number: null,
    warranty_end: null,
    notes: null,
    custom_data: {},
    external_source: null,
    external_id: null,
    created_at: new Date(0),
    updated_at: new Date(0),
    archived_at: null,
    version: 1,
    status_name: '',
    status_state_type: '',
  }),
);

/** One asset (any archive state) by an arbitrary predicate. */
export async function loadAssetRows(trx: Tx, where: Prisma.Sql, limit = 1000): Promise<AssetRow[]> {
  const rows = await trx.$queryRaw<
    Array<Omit<AssetRow, 'status_name' | 'status_state_type'>>
  >`select ${ASSET_COLUMNS} ${ASSET_FROM} where ${where} limit ${limit}`;
  return withStatus(trx, rows);
}

export async function loadAsset(trx: Tx, id: string): Promise<AssetRow | null> {
  const [row] = await loadAssetRows(trx, Prisma.sql`a.id = ${id}::uuid`, 1);
  return row ?? null;
}

/** `%` and `_` are literal in user input. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ------------------------------------------------------------------------------------- sorting

interface SortSpec {
  /** SQL expression compared and ordered by (index friendly where an index exists). */
  expr: string;
  /** Text form selected into the row, carried in the cursor (full precision). */
  text: string;
  /** Cast of the cursor value back to the expression's type. */
  cast: string;
}

const PG_TS = `to_char(%s at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00"')`;
/** Nullable columns sort with NULL as the smallest value (cursor values cannot compare NULL). */
const SORTS: Record<string, SortSpec> = {
  created_at: {
    expr: 'a.created_at',
    text: PG_TS.replace('%s', 'a.created_at'),
    cast: 'timestamptz',
  },
  updated_at: {
    expr: 'a.updated_at',
    text: PG_TS.replace('%s', 'a.updated_at'),
    cast: 'timestamptz',
  },
  asset_tag: { expr: 'a.asset_tag_key', text: 'a.asset_tag_key', cast: 'text' },
  name: { expr: `coalesce(lower(a.name), '')`, text: `coalesce(lower(a.name), '')`, cast: 'text' },
  purchase_date: {
    expr: `coalesce(a.purchase_date, date '0001-01-01')`,
    text: `coalesce(a.purchase_date, date '0001-01-01')::text`,
    cast: 'date',
  },
  warranty_end: {
    expr: `coalesce(a.warranty_end, date '0001-01-01')`,
    text: `coalesce(a.warranty_end, date '0001-01-01')::text`,
    cast: 'date',
  },
  id: { expr: 'a.id', text: 'a.id::text', cast: 'uuid' },
};

export function sortSpecFor(key: string): SortSpec {
  const spec = SORTS[key];
  if (!spec) throw new Error(`no SQL for sort key ${key}`);
  return spec;
}

/** `, <text expr> as k0, ...` for the cursor, in sort order. */
export function sortKeySelect(terms: SortTerm[]): Prisma.Sql {
  return Prisma.raw(terms.map((t, i) => `, ${sortSpecFor(t.key).text} as k${i}`).join(''));
}

export function orderBySql(terms: SortTerm[]): Prisma.Sql {
  return Prisma.raw(
    terms
      .map((t) => `${sortSpecFor(t.key).expr} ${t.direction === 'desc' ? 'desc' : 'asc'}`)
      .join(', '),
  );
}

/** The text must be a date / timestamp PostgreSQL can cast (month 13 and year 0000 pass the shape). */
function isRealDateTime(v: string, cast: string): boolean {
  const iso = cast === 'date' ? `${v}T00:00:00Z` : v.replace(/\+00$/, 'Z');
  const d = new Date(iso);
  return (
    !Number.isNaN(d.getTime()) &&
    d.getUTCFullYear() >= 1 &&
    d.toISOString().slice(0, 10) === v.slice(0, 10)
  );
}

const CURSOR_SHAPE: Record<string, RegExp> = {
  timestamptz: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  text: /^[\s\S]{0,300}$/,
};

/**
 * A cursor is not signed (tenant isolation never depends on it), so a client can forge one that
 * carries the right sort/filter binding but a value PostgreSQL cannot cast: reject it as an invalid
 * cursor (400) instead of letting the cast fail as a 500.
 */
export function assertCursorValues(terms: SortTerm[], values: Array<string | number | Date>): void {
  terms.forEach((term, i) => {
    const shape = CURSOR_SHAPE[sortSpecFor(term.key).cast]!;
    const v = values[i];
    const cast = sortSpecFor(term.key).cast;
    const parses =
      typeof v === 'string' &&
      (cast === 'text' ? !v.includes('\u0000') : cast === 'uuid' || isRealDateTime(v, cast));
    if (typeof v !== 'string' || !shape.test(v) || !parses) {
      throw new ApiProblem({
        code: 'invalid-cursor',
        detail: 'The cursor is not valid for this list. Start again without a cursor.',
        errors: [{ pointer: 'query:cursor', message: 'invalid cursor', code: 'invalid_cursor' }],
      });
    }
  });
}

/** Keyset condition "strictly after the cursor row" over the sort terms, as SQL. */
export function keysetSql(terms: SortTerm[], values: Array<string | number | Date>): Prisma.Sql {
  const alternatives = terms.map((term, i) => {
    const parts: Prisma.Sql[] = [];
    for (let j = 0; j < i; j++) {
      const s = sortSpecFor(terms[j]!.key);
      parts.push(Prisma.sql`${Prisma.raw(s.expr)} = ${String(values[j])}::${Prisma.raw(s.cast)}`);
    }
    const s = sortSpecFor(term.key);
    const op = term.direction === 'asc' ? '>' : '<';
    parts.push(
      Prisma.sql`${Prisma.raw(s.expr)} ${Prisma.raw(op)} ${String(values[i])}::${Prisma.raw(s.cast)}`,
    );
    return Prisma.sql`(${Prisma.join(parts, ' and ')})`;
  });
  return Prisma.sql`(${Prisma.join(alternatives, ' or ')})`;
}

// ------------------------------------------------------------------------------------- filters

const uuidList = (ids: string[]) => Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));

export interface CustomFieldFilter {
  key: string;
  /** JSON value to test with `@>` (a scalar, boolean, number, or a one-element array for multiselect). */
  value: unknown;
}

/** The WHERE conditions of `GET /v1/assets` (without the cursor). */
export function assetConditions(q: AssetListQuery, cf: CustomFieldFilter[]): Prisma.Sql[] {
  const c: Prisma.Sql[] = [];
  if (q.archived === 'exclude') c.push(Prisma.sql`a.archived_at is null`);
  else if (q.archived === 'only') c.push(Prisma.sql`a.archived_at is not null`);

  if (q.tag) c.push(Prisma.sql`a.asset_tag_key = lower(${q.tag})`);
  if (q.serial) c.push(Prisma.sql`a.serial_key = lower(${q.serial})`);
  if (q.q) c.push(Prisma.sql`strpos(a.search_text, lower(${q.q})) > 0`);
  if (q.status_id?.length) c.push(Prisma.sql`a.status_id in (${uuidList(q.status_id)})`);
  if (q.state_type?.length) {
    c.push(
      Prisma.sql`a.status_id in (select s.id from app.status_label s where s.state_type in (${Prisma.join(q.state_type)}))`,
    );
  }
  if (q.category_id?.length) c.push(Prisma.sql`a.category_id in (${uuidList(q.category_id)})`);
  if (q.model_id?.length) c.push(Prisma.sql`a.model_id in (${uuidList(q.model_id)})`);
  if (q.manufacturer_id) {
    c.push(
      Prisma.sql`exists (select 1 from app.asset_model m
        where m.tenant_id = a.tenant_id and m.id = a.model_id and m.manufacturer_id = ${q.manufacturer_id}::uuid)`,
    );
  }
  if (q.location_id) c.push(Prisma.sql`a.location_id = ${q.location_id}::uuid`);
  if (q.company_id) c.push(Prisma.sql`a.company_id = ${q.company_id}::uuid`);
  if (q.vendor_id) c.push(Prisma.sql`a.vendor_id = ${q.vendor_id}::uuid`);
  if (q.parent_asset_id) c.push(Prisma.sql`a.parent_asset_id = ${q.parent_asset_id}::uuid`);
  if (q.warranty_end_before) c.push(Prisma.sql`a.warranty_end <= ${q.warranty_end_before}::date`);
  if (q.warranty_end_after) c.push(Prisma.sql`a.warranty_end >= ${q.warranty_end_after}::date`);
  if (q.purchase_date_from) c.push(Prisma.sql`a.purchase_date >= ${q.purchase_date_from}::date`);
  if (q.purchase_date_to) c.push(Prisma.sql`a.purchase_date <= ${q.purchase_date_to}::date`);
  if (q.updated_since) c.push(Prisma.sql`a.updated_at >= ${q.updated_since}::timestamptz`);
  for (const f of cf) {
    c.push(Prisma.sql`a.custom_data @> ${JSON.stringify({ [f.key]: f.value })}::jsonb`);
  }
  return c;
}

/** Query-string `cf[key]=value` pairs, split from the rest of the query. */
export function splitCustomFieldParams(query: Record<string, unknown>): {
  rest: Record<string, unknown>;
  cf: Array<{ key: string; raw: string }>;
} {
  const rest: Record<string, unknown> = {};
  const cf: Array<{ key: string; raw: string }> = [];
  for (const [k, v] of Object.entries(query)) {
    const m = /^cf\[([^\]]+)\]$/.exec(k);
    if (m) {
      if (typeof v !== 'string') {
        throw new ApiProblem({
          code: 'bad-request',
          detail: `Query parameter "${k}" must be a single value.`,
          errors: [{ pointer: `query:${k}`, message: 'must be a single value', code: 'invalid' }],
        });
      }
      cf.push({ key: m[1]!, raw: v });
    } else rest[k] = v;
  }
  return { rest, cf };
}

/** `?sort=` of the asset list: allow-listed keys, `-created_at` by default. */
export function assetSortTerms(sort: string | undefined): SortTerm[] {
  const terms = parseSort(sort, {
    sortable: {
      created_at: { kind: 'string' },
      updated_at: { kind: 'string' },
      asset_tag: { kind: 'string' },
      name: { kind: 'string' },
      purchase_date: { kind: 'string' },
      warranty_end: { kind: 'string' },
    },
    defaultSort: '-created_at',
  });
  // The unique tiebreaker follows the direction of the first sort key (newest first stays newest
  // first on ties, matching the asset_created_idx index order).
  // (parseSort hands out a shared constant for the tiebreaker: replace it, never mutate it.)
  const idTerm = terms.at(-1);
  if (idTerm && idTerm.key === 'id' && !/(^|,)[-+]?id(,|$)/.test(sort ?? '')) {
    terms[terms.length - 1] = { ...idTerm, direction: terms[0]!.direction };
  }
  return terms;
}

/** Sparse fieldset: `id` is always included. */
export function pickFields<T extends Record<string, unknown>>(
  row: T,
  fields: string[] | undefined,
): Partial<T> {
  if (!fields || fields.length === 0) return row;
  const out: Record<string, unknown> = { id: row.id };
  for (const f of fields) out[f] = row[f];
  return out as Partial<T>;
}

/**
 * The statement behind `GET /v1/assets`: filters + keyset condition + order + limit. Exported so the
 * performance suite can EXPLAIN exactly what production runs (`.sql` / `.values` of a Prisma.Sql).
 */
export function assetListSql(
  q: AssetListQuery,
  cf: CustomFieldFilter[],
  terms: SortTerm[],
  cursorValues: Array<string | number | Date> | undefined,
): Prisma.Sql {
  const conditions = assetConditions(q, cf);
  const where = conditions.length > 0 ? Prisma.join(conditions, ' and ') : Prisma.sql`true`;
  const after = cursorValues ? keysetSql(terms, cursorValues) : Prisma.sql`true`;
  const take = q.limit + 1;
  return Prisma.sql`select ${ASSET_COLUMNS} ${sortKeySelect(terms)} ${ASSET_FROM}
    where ${where} and ${after}
    order by ${orderBySql(terms)}
    limit ${take}`;
}

/** `GET /v1/assets?include_total=true`: the same filters, no cursor. */
export function assetCountSql(q: AssetListQuery, cf: CustomFieldFilter[]): Prisma.Sql {
  const conditions = assetConditions(q, cf);
  const where = conditions.length > 0 ? Prisma.join(conditions, ' and ') : Prisma.sql`true`;
  return Prisma.sql`select count(*) as n ${ASSET_FROM} where ${where}`;
}
