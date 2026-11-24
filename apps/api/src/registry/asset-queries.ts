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
  /** ED-17: the owning / cost-centre department (optional). */
  department_id: string | null;
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
  disposed_on: Date | null;
  disposal_reason: string | null;
  disposal_note: string | null;
  /** M2-FILE-03; optional so fixtures that predate the column still type-check. */
  image_attachment_id?: string | null;
  status_name: string;
  status_state_type: string;
  /** The open custody period (attached by {@link withStatus}); null when the asset is in stock. */
  assignment?: AssignmentSummaryDto | null;
  [sortKey: `k${number}`]: string;
}

/** `Asset.current_assignment` of the contract (schema AssignmentSummary). */
export interface AssignmentSummaryDto {
  assignment_id: string;
  target_type: 'person' | 'location' | 'asset';
  target_id: string;
  target_name: string | null;
  checked_out_at: string;
  expected_return: string | null;
  overdue: boolean;
  loaner_pool_id: string | null;
}

export const ASSET_COLUMNS = Prisma.sql`a.id, a.asset_tag, a.label_code, a.name, a.serial, a.category_id,
  a.model_id, a.status_id, a.location_id, a.company_id, a.vendor_id, a.parent_asset_id, a.purchase_date,
  a.purchase_cost_minor, a.currency, a.order_number, a.warranty_end, a.notes, a.custom_data,
  a.external_source, a.external_id, a.created_at, a.updated_at, a.archived_at, a.version,
  a.disposed_on, a.disposal_reason, a.disposal_note, a.image_attachment_id, a.department_id`;

/** Row of the asset queries before the status label and the open custody period are attached. */
export type BareAssetRow = Omit<AssetRow, 'status_name' | 'status_state_type' | 'assignment'>;

/**
 * No join with the status label: it would let the planner start from the 7-row label table and
 * scan assets per status (a bad plan for exact tag lookups). Status names are attached to the page
 * of rows afterwards ({@link withStatus}), one query over at most a handful of labels.
 */
export const ASSET_FROM = Prisma.sql`from app.asset a`;

/**
 * Attaches `status_name` / `status_state_type` to rows fetched without the status join, and the
 * open custody period (`assignment`, M2-LIFE-01) with the name of its target. One query over the
 * page's asset ids hits the partial unique index of open assignments; names are read per target
 * type only when the page has such targets.
 */
export async function withStatus(trx: Tx, rows: BareAssetRow[]): Promise<AssetRow[]> {
  if (rows.length === 0) return [];
  const labels = await trx.status_label.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.status_id))] } },
    select: { id: true, name: true, state_type: true },
  });
  const byId = new Map(labels.map((l) => [l.id, l]));
  const assignments = await openAssignmentSummaries(
    trx,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const label = byId.get(r.status_id);
    return {
      ...r,
      status_name: label?.name ?? '',
      status_state_type: label?.state_type ?? '',
      assignment: assignments.get(r.id) ?? null,
    };
  });
}

/** Open custody period of each given asset (assets in stock are absent from the map). */
export async function openAssignmentSummaries(
  trx: Tx,
  assetIds: string[],
): Promise<Map<string, AssignmentSummaryDto>> {
  const out = new Map<string, AssignmentSummaryDto>();
  if (assetIds.length === 0) return out;
  const open = await trx.$queryRaw<
    Array<{
      id: string;
      asset_id: string;
      person_id: string | null;
      location_id: string | null;
      target_asset_id: string | null;
      checked_out_at: Date;
      expected_return: Date | null;
      loaner_pool_id: string | null;
      overdue: boolean;
    }>
  >`select s.id, s.asset_id, s.person_id, s.location_id, s.target_asset_id, s.checked_out_at,
           s.expected_return, s.loaner_pool_id,
           coalesce(s.expected_return < (now() at time zone 'UTC')::date, false) as overdue
      from app.assignment s
     where s.asset_id = any(${assetIds}::uuid[]) and s.checked_in_at is null`;
  if (open.length === 0) return out;
  const ids = (pick: (o: (typeof open)[number]) => string | null) => [
    ...new Set(open.map(pick).filter((v): v is string => v !== null)),
  ];
  const people = new Map(
    (
      await trx.person.findMany({
        where: { id: { in: ids((o) => o.person_id) } },
        select: { id: true, display_name: true },
      })
    ).map((p) => [p.id, p.display_name]),
  );
  const places = new Map(
    (
      await trx.location.findMany({
        where: { id: { in: ids((o) => o.location_id) } },
        select: { id: true, name: true },
      })
    ).map((l) => [l.id, l.name]),
  );
  const targets = new Map(
    (
      await trx.asset.findMany({
        where: { id: { in: ids((o) => o.target_asset_id) } },
        select: { id: true, asset_tag: true, name: true },
      })
    ).map((a) => [a.id, a.name ? `${a.asset_tag} ${a.name}` : a.asset_tag]),
  );
  for (const o of open) {
    const [type, id, name] = o.person_id
      ? (['person', o.person_id, people.get(o.person_id)] as const)
      : o.location_id
        ? (['location', o.location_id, places.get(o.location_id)] as const)
        : (['asset', o.target_asset_id!, targets.get(o.target_asset_id!)] as const);
    out.set(o.asset_id, {
      assignment_id: o.id,
      target_type: type,
      target_id: id,
      target_name: name ?? null,
      checked_out_at: o.checked_out_at.toISOString(),
      expected_return: isoDate(o.expected_return),
      overdue: o.overdue,
      loaner_pool_id: o.loaner_pool_id,
    });
  }
  return out;
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
    department_id: r.department_id,
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
    image_attachment_id: r.image_attachment_id ?? null,
    current_assignment: r.assignment ?? (null as AssignmentSummaryDto | null),
    disposal:
      r.disposed_on && r.disposal_reason
        ? { disposed_on: isoDate(r.disposed_on)!, reason: r.disposal_reason, note: r.disposal_note }
        : (null as { disposed_on: string; reason: string; note: string | null } | null),
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
    department_id: null,
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
    disposed_on: null,
    disposal_reason: null,
    disposal_note: null,
    status_name: '',
    status_state_type: '',
  }),
);

/** One asset (any archive state) by an arbitrary predicate. */
export async function loadAssetRows(trx: Tx, where: Prisma.Sql, limit = 1000): Promise<AssetRow[]> {
  const rows = await trx.$queryRaw<
    BareAssetRow[]
  >`select ${ASSET_COLUMNS} ${ASSET_FROM} where ${where} limit ${limit}`;
  return withStatus(trx, rows);
}

/** Locks the asset row (`FOR UPDATE`) and reads it: the entry point of every custody write. */
export async function lockAsset(trx: Tx, id: string): Promise<AssetRow | null> {
  const rows = await trx.$queryRaw<
    BareAssetRow[]
  >`select ${ASSET_COLUMNS} ${ASSET_FROM} where a.id = ${id}::uuid for update of a`;
  return rows[0] ? (await withStatus(trx, rows))[0]! : null;
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
  /** Tables the expression reads besides `app.asset` (joined only when the sort needs them). */
  joins?: SortJoin[];
}

/**
 * Left joins a sort key may need (M2-REG-03, ED-22). Every one yields at most one row per asset
 * (the open custody period is unique per asset, the others are joined by primary key), so a join
 * never duplicates or drops an asset and the keyset stays stable.
 */
type SortJoin = 'location' | 'custody' | 'assignee';

// the asset target's tag is read by a scalar subquery: coalesce evaluates it only for the (few) assets
// checked out to another asset, instead of hash-joining the tenant's whole asset table
const ASSIGNEE_KEY = `coalesce(lower(coalesce(sort_person.display_name, sort_tloc.name,
    (select ta.asset_tag from app.asset ta where ta.tenant_id = a.tenant_id and ta.id = sort_open.target_asset_id))), '')`;

const SORT_JOIN_SQL: Record<SortJoin, string> = {
  // the path key is computed once per LOCATION (a small table), then hash-joined to the assets
  location: `left join (
      select l.id, (select string_agg(lower(n.name), ' > ' order by u.ord)
                      from unnest(l.ancestor_ids) with ordinality as u(id, ord)
                      join app.location n on n.tenant_id = l.tenant_id and n.id = u.id) as path_key
        from app.location l
    ) sort_loc on sort_loc.id = a.location_id`,
  custody: `left join app.assignment sort_open on sort_open.tenant_id = a.tenant_id
      and sort_open.asset_id = a.id and sort_open.checked_in_at is null`,
  // `assignee` includes the `custody` join (same alias): never request both
  assignee: `left join app.assignment sort_open on sort_open.tenant_id = a.tenant_id
      and sort_open.asset_id = a.id and sort_open.checked_in_at is null
    left join app.person sort_person on sort_person.tenant_id = a.tenant_id and sort_person.id = sort_open.person_id
    left join app.location sort_tloc on sort_tloc.tenant_id = a.tenant_id and sort_tloc.id = sort_open.location_id`,
};

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
  // ---- M2-REG-03 (ED-22): sort by location, assignee and due date, empty values LAST in both
  // directions. A nullable key is two terms: `<key>.null` (false = has a value; always ascending, so
  // values come first) followed by the value with the direction the client asked for. The flag makes
  // the cursor exact for NULL (a NULL cannot be compared with `>`); the value of an empty row is a
  // constant filler, so empty rows are ordered by the unique `id` tiebreaker alone.
  'location.null': {
    expr: '(sort_loc.path_key is null)',
    text: '(sort_loc.path_key is null)::text',
    cast: 'boolean',
    joins: ['location'],
  },
  // the full path as the table shows it ("hq > floor 2 > room 4"), lower-cased
  location: {
    expr: `coalesce(sort_loc.path_key, '')`,
    text: `coalesce(sort_loc.path_key, '')`,
    cast: 'text',
    joins: ['location'],
  },
  'assignee.null': {
    expr: '(sort_open.id is null)',
    text: '(sort_open.id is null)::text',
    cast: 'boolean',
    joins: ['assignee'],
  },
  // the name of the open custody target (person, location, or asset tag), lower-cased
  assignee: { expr: ASSIGNEE_KEY, text: ASSIGNEE_KEY, cast: 'text', joins: ['assignee'] },
  'due.null': {
    expr: '(sort_open.expected_return is null)',
    text: '(sort_open.expected_return is null)::text',
    cast: 'boolean',
    joins: ['custody'],
  },
  due: {
    expr: `coalesce(sort_open.expected_return, date '0001-01-01')`,
    text: `coalesce(sort_open.expected_return, date '0001-01-01')::text`,
    cast: 'date',
    joins: ['custody'],
  },
};

/** The left joins the sort terms read, as SQL (empty for the sorts of the asset row). */
export function sortJoinsSql(terms: SortTerm[]): Prisma.Sql {
  const need = new Set<SortJoin>(terms.flatMap((t) => sortSpecFor(t.key).joins ?? []));
  if (need.has('assignee')) need.delete('custody');
  return Prisma.raw([...need].map((j) => SORT_JOIN_SQL[j]).join('\n'));
}

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
  boolean: /^(true|false)$/,
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
      (cast === 'text'
        ? !v.includes('\u0000')
        : cast === 'uuid' || cast === 'boolean' || isRealDateTime(v, cast));
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
  if (q.location_id) {
    // M2-LOC-02: the whole subtree unless `include_sublocations=false`. The descendant ids come
    // from the (small) per-tenant location table; ancestor_ids is trigger-maintained (ED-07).
    c.push(
      q.include_sublocations === false
        ? Prisma.sql`a.location_id = ${q.location_id}::uuid`
        : Prisma.sql`a.location_id in (select l.id from app.location l
            where l.ancestor_ids @> array[${q.location_id}::uuid])`,
    );
  }
  // M2-LIFE-01..03: custody filters, all answered by the partial unique index of open assignments
  // (or the due-date index for `overdue`).
  const open = Prisma.sql`select 1 from app.assignment s where s.tenant_id = a.tenant_id and s.asset_id = a.id and s.checked_in_at is null`;
  if (q.assigned !== undefined) {
    c.push(q.assigned ? Prisma.sql`exists (${open})` : Prisma.sql`not exists (${open})`);
  }
  if (q.assigned_person_id) {
    c.push(Prisma.sql`exists (${open} and s.person_id = ${q.assigned_person_id}::uuid)`);
  }
  if (q.overdue !== undefined) {
    const overdue = Prisma.sql`${open} and s.expected_return < (now() at time zone 'UTC')::date`;
    c.push(q.overdue ? Prisma.sql`exists (${overdue})` : Prisma.sql`not exists (${overdue})`);
  }
  if (q.department_id) c.push(Prisma.sql`a.department_id = ${q.department_id}::uuid`);
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
      // M2-REG-03: empty values last in both directions (a leading `<key>.null` term, see SORTS)
      location: { kind: 'string' },
      assignee: { kind: 'string' },
      due: { kind: 'string' },
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
  // A key that can be empty is preceded by its "is empty" flag term (always ascending): empty last.
  return terms.flatMap((t) =>
    NULLS_LAST_KEYS.has(t.key)
      ? [{ ...t, key: `${t.key}.null`, column: `${t.key}.null`, direction: 'asc' as const }, t]
      : [t],
  );
}

/** Sort keys whose value can be empty and that put the empty ones last (M2-REG-03, ED-22). */
const NULLS_LAST_KEYS = new Set(['location', 'assignee', 'due']);

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
  if (!terms.some((t) => sortSpecFor(t.key).joins?.length)) {
    return Prisma.sql`select ${ASSET_COLUMNS} ${sortKeySelect(terms)} ${ASSET_FROM}
      where ${where} and ${after}
      order by ${orderBySql(terms)}
      limit ${take}`;
  }
  // A sort that reads other tables (M2-REG-03, ED-22) sorts NARROW rows: the inner statement only
  // carries the asset id and the sort keys (the covering index asset_sort_cover_idx answers it with an
  // index-only scan), then the page of at most `limit + 1` ids is joined back to the full rows. The
  // text keys order exactly like the typed expressions (fixed-width ISO dates, 'false' < 'true').
  const outerKeys = Prisma.raw(terms.map((_, i) => `, t.k${i}`).join(''));
  const outerOrder = Prisma.raw(
    terms.map((term, i) => `t.k${i} ${term.direction === 'desc' ? 'desc' : 'asc'}`).join(', '),
  );
  return Prisma.sql`select ${ASSET_COLUMNS} ${outerKeys}
    from (
      select a.id ${sortKeySelect(terms)} ${ASSET_FROM} ${sortJoinsSql(terms)}
       where ${where} and ${after}
       order by ${orderBySql(terms)}
       limit ${take}
    ) t join app.asset a on a.id = t.id
    order by ${outerOrder}`;
}

/** `GET /v1/assets?include_total=true`: the same filters, no cursor. */
export function assetCountSql(q: AssetListQuery, cf: CustomFieldFilter[]): Prisma.Sql {
  const conditions = assetConditions(q, cf);
  const where = conditions.length > 0 ? Prisma.join(conditions, ' and ') : Prisma.sql`true`;
  return Prisma.sql`select count(*) as n ${ASSET_FROM} where ${where}`;
}
