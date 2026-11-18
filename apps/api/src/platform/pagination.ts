import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiProblem } from './problem.js';

/**
 * List conventions (M1-PLAT-02, openapi "Pagination, sorting, filtering"): `limit` (1-200, default
 * 50), opaque `cursor`, `include_total`, `sort` (comma-separated, `-` prefix = descending, a unique
 * `id` tiebreaker always appended), `fields` (sparse fieldset). {@link listPage} is the one
 * implementation every list endpoint uses.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** Query parameters shared by every list endpoint. Extend it with the endpoint's filters. */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).max(1024).optional(),
  include_total: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  sort: z.string().max(200).optional(),
  fields: z.string().max(500).optional(),
});
export type ListQuery = z.output<typeof listQuerySchema>;

export interface PageInfo {
  next_cursor: string | null;
  has_more: boolean;
  total?: number | null;
}

export interface Page<T> {
  data: T[];
  page: PageInfo;
}

/** How a sort key is serialised into the cursor and compared again (uuidv7 ids sort as strings). */
export type SortKind = 'string' | 'number' | 'date';

export interface SortableField {
  kind: SortKind;
  /** Column/property name when it differs from the public sort key. */
  column?: string;
}

/** What a list endpoint allows. Keys are the public names used in `?sort=`. */
export interface ListSpec {
  sortable: Record<string, SortableField>;
  /** Default `sort` value, e.g. `-created_at`. */
  defaultSort: string;
}

export interface SortTerm {
  key: string;
  column: string;
  kind: SortKind;
  direction: 'asc' | 'desc';
}

const ID_TERM: SortTerm = { key: 'id', column: 'id', kind: 'string', direction: 'asc' };

/** Parses `?sort=-created_at,name` against the allow-list; always ends with the `id` tiebreaker. */
export function parseSort(raw: string | undefined, spec: ListSpec): SortTerm[] {
  const source = raw && raw.trim() ? raw : spec.defaultSort;
  const terms: SortTerm[] = [];
  for (const part of source.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const direction = trimmed.startsWith('-') ? 'desc' : 'asc';
    const key = trimmed.replace(/^[-+]/, '');
    const field = spec.sortable[key];
    if (!field && key !== 'id') {
      throw new ApiProblem({
        code: 'bad-request',
        detail: `Query parameter "sort": "${key}" is not sortable. Allowed: ${Object.keys(spec.sortable).join(', ')}.`,
        errors: [
          { pointer: 'query:sort', message: `unknown sort key "${key}"`, code: 'invalid_value' },
        ],
      });
    }
    if (terms.some((t) => t.key === key)) continue; // a repeated key adds nothing
    terms.push(
      key === 'id'
        ? { ...ID_TERM, direction }
        : { key, column: field!.column ?? key, kind: field!.kind, direction },
    );
  }
  if (!terms.some((t) => t.key === 'id')) terms.push(ID_TERM);
  return terms;
}

/** Prisma `orderBy` for the terms. */
export function toOrderBy(terms: SortTerm[]): Array<Record<string, 'asc' | 'desc'>> {
  return terms.map((t) => ({ [t.column]: t.direction }));
}

/**
 * Parses `?fields=name,serial` into a Prisma `select` (`id` always included). Unknown fields are a
 * 400, so a typo cannot silently return less than the client asked for.
 */
export function parseFields(
  raw: string | undefined,
  allowed: readonly string[],
): Record<string, true> | undefined {
  if (!raw || !raw.trim()) return undefined;
  const select: Record<string, true> = { id: true };
  for (const f of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (!allowed.includes(f)) {
      throw new ApiProblem({
        code: 'bad-request',
        detail: `Query parameter "fields": "${f}" is not a field. Allowed: ${allowed.join(', ')}.`,
        errors: [
          { pointer: 'query:fields', message: `unknown field "${f}"`, code: 'invalid_value' },
        ],
      });
    }
    select[f] = true;
  }
  return select;
}

// ---------------------------------------------------------------------------------------------
// Cursor

interface CursorPayload {
  v: 1;
  /** Binding: hash of the sort terms and filters the cursor was issued for. */
  b: string;
  /** The sort-key values of the last row of the page, serialised (dates as ISO strings). */
  k: Array<string | number | null>;
}

/** Hash that ties a cursor to the exact sort and filters of its list. */
export function bindingFor(terms: SortTerm[], filters: unknown): string {
  const canonical = JSON.stringify([
    terms.map((t) => `${t.direction === 'desc' ? '-' : ''}${t.key}`),
    sortKeysDeep(filters ?? {}),
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}

function serialiseKey(kind: SortKind, value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (kind === 'date')
    return (value instanceof Date ? value : new Date(String(value))).toISOString();
  if (kind === 'number') return typeof value === 'bigint' ? Number(value) : Number(value);
  return String(value);
}

function deserialiseKey(kind: SortKind, value: string | number | null): string | number | Date {
  if (value === null)
    throw invalidCursor('a sort key is null (nullable sort columns are not supported)');
  if (kind === 'date') {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) throw invalidCursor('bad date');
    return d;
  }
  if (kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidCursor('bad number');
    return value;
  }
  if (typeof value !== 'string') throw invalidCursor('bad string');
  return value;
}

function invalidCursor(why: string): ApiProblem {
  return new ApiProblem({
    code: 'invalid-cursor',
    detail: `The cursor is not valid for this list (${why}). Start again without a cursor.`,
    errors: [{ pointer: 'query:cursor', message: 'invalid cursor', code: 'invalid_cursor' }],
  });
}

export function encodeCursor(
  terms: SortTerm[],
  binding: string,
  lastRow: Record<string, unknown>,
): string {
  for (const t of terms) {
    if (!(t.column in lastRow)) {
      throw new Error(
        `list row has no "${t.column}" property: include every sort column in the select`,
      );
    }
  }
  const payload: CursorPayload = {
    v: 1,
    b: binding,
    k: terms.map((t) => serialiseKey(t.kind, lastRow[t.column])),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Decodes and validates a cursor; throws `400 invalid-cursor` for anything not issued for this sort and filters. */
export function decodeCursor(
  cursor: string,
  terms: SortTerm[],
  binding: string,
): Array<string | number | Date> {
  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
  } catch {
    throw invalidCursor('not decodable');
  }
  if (!payload || payload.v !== 1 || typeof payload.b !== 'string' || !Array.isArray(payload.k)) {
    throw invalidCursor('unexpected shape');
  }
  if (payload.b !== binding) throw invalidCursor('it belongs to a different sort or filter');
  if (payload.k.length !== terms.length) throw invalidCursor('unexpected shape');
  return payload.k.map((v, i) => deserialiseKey(terms[i]!.kind, v));
}

/**
 * Keyset condition "strictly after the cursor row" for a mixed-direction sort, as a Prisma `where`:
 *   (a > x) OR (a = x AND b > y) OR (a = x AND b = y AND id > z)
 * (`<` for descending terms). Combine with the endpoint's filters using `AND`.
 */
export function keysetWhere(
  terms: SortTerm[],
  values: Array<string | number | Date>,
): Record<string, unknown> {
  const alternatives = terms.map((term, i) => {
    const and: Record<string, unknown>[] = [];
    for (let j = 0; j < i; j++) and.push({ [terms[j]!.column]: values[j] });
    and.push({ [term.column]: { [term.direction === 'asc' ? 'gt' : 'lt']: values[i] } });
    return and.length === 1 ? and[0]! : { AND: and };
  });
  return { OR: alternatives };
}

// ---------------------------------------------------------------------------------------------
// The shared list helper

export interface ListPageArgs<Row> {
  /** Validated query (see {@link listQuerySchema}). */
  query: Pick<ListQuery, 'limit' | 'cursor' | 'include_total' | 'sort'>;
  spec: ListSpec;
  /** The endpoint's filters, in canonical form: they are bound into the cursor. */
  filters?: unknown;
  /**
   * Runs the query. `where` is the keyset condition (undefined on the first page) to AND with the
   * endpoint's filters; fetch `take` rows (limit + 1) ordered by `orderBy`.
   */
  fetch: (q: {
    take: number;
    orderBy: Array<Record<string, 'asc' | 'desc'>>;
    where: Record<string, unknown> | undefined;
  }) => Promise<Row[]>;
  /** Only called when `include_total=true`; it runs with the filters but without the cursor. */
  count?: () => Promise<number>;
}

/** The one list implementation: parse sort, decode the cursor, fetch limit+1 rows, build `{data, page}`. */
export async function listPage<Row extends Record<string, unknown>>(
  args: ListPageArgs<Row>,
): Promise<Page<Row>> {
  const terms = parseSort(args.query.sort, args.spec);
  const binding = bindingFor(terms, args.filters);
  const where = args.query.cursor
    ? keysetWhere(terms, decodeCursor(args.query.cursor, terms, binding))
    : undefined;

  const rows = await args.fetch({ take: args.query.limit + 1, orderBy: toOrderBy(terms), where });
  const hasMore = rows.length > args.query.limit;
  const data = hasMore ? rows.slice(0, args.query.limit) : rows;
  const last = data.at(-1);

  const page: PageInfo = {
    next_cursor: hasMore && last ? encodeCursor(terms, binding, last) : null,
    has_more: hasMore,
  };
  if (args.query.include_total && args.count) page.total = await args.count();
  return { data, page };
}
