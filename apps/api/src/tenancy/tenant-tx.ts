import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
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
  const reqId = ctx.requestId === undefined ? '' : requestId.parse(ctx.requestId);

  const outer = active.getStore();
  if (outer) {
    if (outer.ctx.tenantId !== tenantId) {
      throw new Error(
        `nested withTenantTx for a different tenant (${tenantId}) inside tenant ${outer.ctx.tenantId}`,
      );
    }
    return fn(outer.trx);
  }

  return source.$transaction(
    async (trx) => {
      await trx.$executeRaw`select set_config('app.tenant_id', ${tenantId}, true),
                                   set_config('app.actor_id', ${actorId}, true),
                                   set_config('app.request_id', ${reqId}, true)`;
      return active.run(
        { trx, ctx: { tenantId, actorId: ctx.actorId, requestId: ctx.requestId } },
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
