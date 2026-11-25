import { Prisma } from '../generated/prisma/client.js';
import { currentTenantContext, type Tx } from './tenant-tx.js';

/**
 * M2-LOC-03 location scoping (ED-07, ED-26). A principal whose grants for the route's permission
 * are all location-scoped may only see and change records inside those location subtrees. The
 * scope travels with the tenant transaction ({@link TenantContext.locationScope}: the ROOT ids of
 * the subtrees); this file turns it into predicates.
 *
 * Enforcement is an application-layer predicate, not row-level security (RLS stays tenant-only,
 * ED-07). Under RLS, `ancestor_ids @> / &&` is not leakproof and cannot drive an index (ADR 0005),
 * so the subtree is resolved against the tenant's (small) location table and the hot tables are
 * filtered with `location_id IN (...)` / `= ANY(...)`: plain uuid equality, which is leakproof and
 * uses the existing `(tenant_id, location_id)` btree indexes.
 *
 * A record with NO location is outside every subtree: a scoped principal never sees it.
 */

/** Root ids of the subtrees the current transaction is limited to; null = not limited. */
export function currentLocationScope(): readonly string[] | null {
  return currentTenantContext()?.locationScope ?? null;
}

/** True when the current transaction is location-scoped. */
export function isLocationScoped(): boolean {
  return currentLocationScope() !== null;
}

const uuidArray = (ids: readonly string[]) =>
  Prisma.sql`array[${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[]`;

/**
 * SQL predicate "`column` is a location inside the scope" (`true` when not scoped). `column` is a
 * trusted SQL fragment (for example Prisma.sql`a.location_id`). A NULL column is never inside.
 */
export function locationScopeSql(column: Prisma.Sql): Prisma.Sql {
  const roots = currentLocationScope();
  if (roots === null) return Prisma.sql`true`;
  if (roots.length === 0) return Prisma.sql`false`;
  return Prisma.sql`(${column} in (select sl.id from app.location sl
      where sl.ancestor_ids && ${uuidArray(roots)}))`;
}

/**
 * Ids of every location (archived ones included) inside the scope, or null when not scoped. Read
 * fresh on every call (never cached), so a location created earlier in the same transaction counts.
 */
export async function scopedLocationIds(trx: Tx): Promise<string[] | null> {
  const roots = currentLocationScope();
  if (roots === null) return null;
  if (roots.length === 0) return [];
  const rows = await trx.$queryRaw<Array<{ id: string }>>`
    select id from app.location where ancestor_ids && ${uuidArray(roots)}`;
  return rows.map((r) => r.id);
}

/**
 * Prisma `where` fragment for a `location_id`-style column: `{}` when not scoped, otherwise
 * `{ [field]: { in: ids } }` (NULL never matches).
 */
export async function locationScopeWhere<K extends string>(
  trx: Tx,
  field: K,
): Promise<Partial<Record<K, { in: string[] }>>> {
  const ids = await scopedLocationIds(trx);
  if (ids === null) return {};
  return { [field]: { in: ids } } as Record<K, { in: string[] }>;
}

/** Is location `id` inside the scope? (Always true when not scoped; false for null when scoped.) */
export async function locationInScope(trx: Tx, id: string | null | undefined): Promise<boolean> {
  const roots = currentLocationScope();
  if (roots === null) return true;
  if (!id || roots.length === 0) return false;
  const rows = await trx.$queryRaw<Array<{ one: number }>>`
    select 1 as one from app.location where id = ${id}::uuid and ancestor_ids && ${uuidArray(roots)}`;
  return rows.length > 0;
}

/** Is asset `id` inside the scope? (true when not scoped; a missing asset is false). */
export async function assetInScope(trx: Tx, id: string): Promise<boolean> {
  if (currentLocationScope() === null) return true;
  const rows = await trx.$queryRaw<Array<{ one: number }>>`
    select 1 as one from app.asset a where a.id = ${id}::uuid
       and ${locationScopeSql(Prisma.sql`a.location_id`)}`;
  return rows.length > 0;
}

/** Is person `id` inside the scope (their home location is)? true when not scoped. */
export async function personInScope(trx: Tx, id: string): Promise<boolean> {
  if (currentLocationScope() === null) return true;
  const rows = await trx.$queryRaw<Array<{ one: number }>>`
    select 1 as one from app.person p where p.id = ${id}::uuid
       and ${locationScopeSql(Prisma.sql`p.location_id`)}`;
  return rows.length > 0;
}
