import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { currentRequestContext, currentRequestId } from '../context/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * A transaction handle over the Prisma schema (`tx.asset.findMany()`, `tx.$queryRaw`...). It exists
 * only inside {@link withTenantTx} / {@link withPreTenantTx}; there is no other way to obtain one.
 */
export type Tx = Prisma.TransactionClient;

/** Who and what a tenant transaction acts for. Only `tenantId` is required. */
export interface TenantContext {
  tenantId: string;
  /** user id, api key id or system job id: becomes `app.actor_id` for the transaction. */
  actorId?: string;
  /** correlation id: becomes `app.request_id` for the transaction. */
  requestId?: string;
  /**
   * M2-LOC-03 (ED-26): root ids of the location subtrees the transaction may see and change; `null`
   * = not limited. Absent = inherit the ambient request's scope (set by the auth guard), so every
   * transaction of a scoped request is scoped without each caller passing it. Jobs that act for a
   * user (an export, an import commit) pass it explicitly.
   */
  locationScope?: readonly string[] | null;
}

/** Interactive transaction limits (Prisma defaults to 2 s wait / 5 s run, too tight for imports). */
export interface TxOptions {
  /** Max time to wait for a connection from the pool. */
  maxWaitMs?: number;
  /** Max time the callback may run before Prisma rolls the transaction back. */
  timeoutMs?: number;
}

export const DEFAULT_TX_OPTIONS = { maxWaitMs: 5_000, timeoutMs: 30_000 } as const;

const uuid = z.uuid();
const requestId = z.string().max(200);

export class NoTenantTransactionError extends Error {
  constructor() {
    super(
      'TenantRepository was used outside withTenantTx(): tenant data is only reachable inside an explicit tenant transaction',
    );
    this.name = 'NoTenantTransactionError';
  }
}

interface Active {
  trx: Tx;
  ctx: TenantContext;
}
const active = new AsyncLocalStorage<Active>();

/** The transaction opened by the enclosing `withTenantTx`, or throws {@link NoTenantTransactionError}. */
export function currentTenantTx(): Tx {
  const store = active.getStore();
  if (!store) throw new NoTenantTransactionError();
  return store.trx;
}

/** The context of the enclosing `withTenantTx`, if any. */
export function currentTenantContext(): TenantContext | undefined {
  return active.getStore()?.ctx;
}

/** The slice of PrismaClient that the helpers need (lets unit tests pass a fake). */
export interface TxSource {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
}

/**
 * Runs `fn` inside an interactive Prisma transaction with the tenant context set transaction-locally:
 *
 *   BEGIN; select set_config('app.tenant_id' | 'app.actor_id' | 'app.request_id', $n, true); ...; COMMIT
 *
 * `is_local = true` makes the settings vanish at COMMIT/ROLLBACK, so nothing leaks to the next
 * borrower of a pooled (PgBouncer transaction-mode) connection. NEVER use a session-level SET for
 * tenant context (spike finding F3); a test greps the sources for it.
 *
 * Data, audit row and outbox row written inside `fn` commit or roll back together. Nested calls
 * for the same tenant join the outer transaction; a different tenant is an error.
 */
export async function withTenantTx<T>(
  source: TxSource,
  ctx: TenantContext,
  fn: (trx: Tx) => Promise<T>,
  options: TxOptions = {},
): Promise<T> {
  // Validate before touching the database: the tenant id never reaches SQL unchecked.
  const tenantId = uuid.parse(ctx.tenantId);
  const actorId = ctx.actorId === undefined ? '' : uuid.parse(ctx.actorId);
  const effectiveRequestId = ctx.requestId ?? currentRequestId();
  const reqId = effectiveRequestId === undefined ? '' : requestId.parse(effectiveRequestId);

  const scope =
    ctx.locationScope !== undefined
      ? ctx.locationScope
      : (currentRequestContext()?.locationScope ?? null);
  const locationScope = scope === null ? null : scope.map((id) => uuid.parse(id));

  const outer = active.getStore();
  if (outer) {
    if (outer.ctx.tenantId !== tenantId) {
      throw new Error(
        `nested withTenantTx for a different tenant (${tenantId}) inside tenant ${outer.ctx.tenantId}`,
      );
    }
    // M2-LOC-03 (ED-26): an explicit scope on a nested call (a job acting for a scoped user inside
    // the job's own transaction) narrows the context for that call to the intersection of both
    // scopes; it never widens a scoped one.
    if (ctx.locationScope !== undefined && locationScope !== null) {
      return runWithLocationScope(locationScope, () => fn(outer.trx));
    }
    return fn(outer.trx);
  }

  return source.$transaction(
    async (trx) => {
      await trx.$executeRaw`select set_config('app.tenant_id', ${tenantId}, true),
                                   set_config('app.actor_id', ${actorId}, true),
                                   set_config('app.request_id', ${reqId}, true)`;
      return active.run(
        {
          trx,
          ctx: { tenantId, actorId: ctx.actorId, requestId: effectiveRequestId, locationScope },
        },
        () => fn(trx),
      );
    },
    {
      maxWait: options.maxWaitMs ?? DEFAULT_TX_OPTIONS.maxWaitMs,
      timeout: options.timeoutMs ?? DEFAULT_TX_OPTIONS.timeoutMs,
    },
  );
}

/**
 * M2-LOC-03 (ED-26): the intersection of two location scopes (root ids of subtrees; `null` = not
 * limited): the roots of either side that lie inside a subtree of the other. `[]` = nothing.
 */
export async function intersectLocationScopes(
  trx: Tx,
  a: readonly string[] | null,
  b: readonly string[] | null,
): Promise<readonly string[] | null> {
  if (a === null) return b;
  if (b === null) return a;
  const ids = [...new Set([...a, ...b])].map((id) => uuid.parse(id));
  if (ids.length === 0) return [];
  const rows = await trx.$queryRaw<Array<{ id: string; ancestor_ids: string[] }>>`
    select id, ancestor_ids from app.location where id = any(${ids}::uuid[])`;
  const ancestors = new Map(rows.map((r) => [r.id, r.ancestor_ids]));
  const inside = (root: string, others: readonly string[]) =>
    others.some((o) => ancestors.get(root)?.includes(o) ?? false);
  const out = new Set<string>();
  for (const r of a) if (inside(r, b)) out.add(r);
  for (const r of b) if (inside(r, a)) out.add(r);
  return [...out].sort();
}

/**
 * M2-LOC-03 (ED-26): runs `fn` inside the enclosing tenant transaction, narrowed to `scope` (the
 * intersection with the current scope): a worker job acting for a scoped user, or a service that
 * also needs a second permission whose grants are scoped differently. `null` leaves the context
 * as it is; the result is never wider than the current scope. Throws outside a tenant transaction.
 */
export async function runWithLocationScope<T>(
  scope: readonly string[] | null,
  fn: () => T | Promise<T>,
): Promise<T> {
  const store = active.getStore();
  if (!store) throw new NoTenantTransactionError();
  if (scope === null) return fn();
  const current = store.ctx.locationScope ?? null;
  const locationScope = await intersectLocationScopes(store.trx, current, scope);
  if (locationScope === current) return fn();
  return active.run({ trx: store.trx, ctx: { ...store.ctx, locationScope } }, fn);
}

/**
 * Runs `fn` in a transaction with NO tenant context, for the pre-tenant `identity` lookups and the
 * control plane (tables with no RLS). Tenant tables return zero rows here (fail closed).
 */
export function withPreTenantTx<T>(
  source: TxSource,
  fn: (trx: Tx) => Promise<T>,
  options: TxOptions = {},
): Promise<T> {
  return source.$transaction(fn, {
    maxWait: options.maxWaitMs ?? DEFAULT_TX_OPTIONS.maxWaitMs,
    timeout: options.timeoutMs ?? DEFAULT_TX_OPTIONS.timeoutMs,
  });
}
