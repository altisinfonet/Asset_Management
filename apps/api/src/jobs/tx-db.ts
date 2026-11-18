import type { Db } from 'pg-boss';
import { Prisma, type Tx } from '../tenancy/index.js';

/**
 * Adapts the caller's Prisma transaction to pg-boss's `db: { executeSql }` hook, so
 * `boss.send(..., { db })` inserts the job in the SAME transaction as the business change:
 * committed together or not at all (architecture 5.2 "transactional enqueue").
 *
 * pg-boss hands over SQL text with PostgreSQL `$n` placeholders. Prisma's own pg-boss adapter calls
 * `$queryRawUnsafe`, which this repository bans (lint), so the text is split on the placeholders and
 * rebuilt as a `Prisma.Sql`: every value stays a bound parameter, nothing is concatenated into the
 * SQL. A placeholder used twice is bound twice (same value), which Postgres treats identically.
 *
 * The statements pg-boss issues for `send` are single statements (`json_to_recordset($1::text::json)`),
 * which is what Prisma's prepared-statement protocol requires.
 */
export function dbFromTx(tx: Tx): Db {
  return {
    async executeSql(text: string, values?: unknown[]) {
      const { parts, reordered } = splitPlaceholders(text, values);
      const strings = Object.assign([...parts], {
        raw: [...parts],
      }) as unknown as TemplateStringsArray;
      const rows: unknown = await tx.$queryRaw(Prisma.sql(strings, ...reordered));
      return { rows: Array.isArray(rows) ? rows : [] };
    },
  };
}

/** Splits `text` on `$n` and returns the literal parts plus the values in order of appearance. */
export function splitPlaceholders(
  text: string,
  values: unknown[] = [],
): { parts: string[]; reordered: unknown[] } {
  const parts: string[] = [];
  const reordered: unknown[] = [];
  const re = /\$(\d+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    parts.push(text.slice(last, match.index));
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= values.length) {
      throw new Error(
        `pg-boss statement references $${index + 1} but ${values.length} values were given`,
      );
    }
    reordered.push(values[index]);
    last = re.lastIndex;
  }
  parts.push(text.slice(last));
  return { parts, reordered };
}
