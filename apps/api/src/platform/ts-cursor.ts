import { ApiProblem } from './problem.js';
import { type SortTerm, bindingFor, decodeCursor, encodeCursor } from './pagination.js';

/**
 * Cursor of the "newest first" lists that are keyed by a microsecond timestamp plus a unique id
 * (the chain-of-custody history, assignment lists). The timestamp travels as the text PostgreSQL
 * formatted it (full microsecond precision, which a JavaScript Date would truncate: rows sharing a
 * millisecond would be skipped or repeated at a page boundary).
 *
 * The list query selects `<ts text> as k0, <id>::text as k1` and orders `(ts desc, id desc)`; this
 * module only encodes and validates the cursor (it carries no SQL).
 */

const TERMS: SortTerm[] = [
  { key: 'ts', column: 'k0', kind: 'string', direction: 'desc' },
  { key: 'id', column: 'k1', kind: 'string', direction: 'desc' },
];

const TS_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SQL fragment (text) that formats a timestamptz column the way the cursor expects. */
export const tsText = (column: string): string =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00"')`;

export interface TsIdCursor {
  /** Binds the cursor to the filters of the list that issued it. */
  binding: string;
  /** The decoded position, undefined on the first page. */
  after?: { ts: string; id: string };
}

const invalid = (): ApiProblem =>
  new ApiProblem({
    code: 'invalid-cursor',
    detail: 'The cursor is not valid for this list. Start again without a cursor.',
    errors: [{ pointer: 'query:cursor', message: 'invalid cursor', code: 'invalid_cursor' }],
  });

/** Decodes `cursor` (400 `invalid-cursor` when it is not one this list issued for these filters). */
export function readTsIdCursor(cursor: string | undefined, filters: unknown): TsIdCursor {
  const binding = bindingFor(TERMS, filters);
  if (!cursor) return { binding };
  const values = decodeCursor(cursor, TERMS, binding);
  const [ts, id] = values as [string, string];
  if (
    typeof ts !== 'string' ||
    !TS_SHAPE.test(ts) ||
    typeof id !== 'string' ||
    !UUID_SHAPE.test(id)
  ) {
    throw invalid();
  }
  const year = Number(ts.slice(0, 4));
  if (Number.isNaN(new Date(ts.replace(/\+00$/, 'Z')).getTime()) || year < 1) throw invalid();
  return { binding, after: { ts, id: id.toLowerCase() } };
}

/** The cursor for the page that follows the page whose last row carries `k0` / `k1`. */
export function nextTsIdCursor(binding: string, last: { k0: string; k1: string }): string {
  return encodeCursor(TERMS, binding, last);
}
