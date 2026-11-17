import { AsyncLocalStorage } from 'node:async_hooks';
import { type Kysely, sql, type Transaction } from 'kysely';
import { z } from 'zod';
import type { Database } from './database.js';

/** A transaction handle over the typed schema. */
export type Tx = Transaction<Database>;

/** Who and what a tenant transaction acts for. Only `tenantId` is required. */
export interface TenantContext {
  tenantId: string;
  /** user id, api key id or system job id: becomes `app.actor_id` for the transaction. */
  actorId?: string;
  /** correlation id: becomes `app.request_id` for the transaction. */
  requestId?: string;
}

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

/** The slice of Kysely that `withTenantTx` needs (lets unit tests pass a fake). */
export type TxSource = Pick<Kysely<Database>, 'transaction'>;

/**
 * Runs `fn` inside an explicit transaction with the tenant context set transaction-locally:
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

  return source.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true),
                     set_config('app.actor_id', ${actorId}, true),
                     set_config('app.request_id', ${reqId}, true)`.execute(trx);
    return active.run(
      { trx, ctx: { tenantId, actorId: ctx.actorId, requestId: ctx.requestId } },
      () => fn(trx),
    );
  });
}

/**
 * Runs `fn` in a transaction with NO tenant context, for the pre-tenant `identity` lookups and the
 * control plane (tables with no RLS). Tenant tables return zero rows here (fail closed).
 */
export function withPreTenantTx<T>(source: TxSource, fn: (trx: Tx) => Promise<T>): Promise<T> {
  return source.transaction().execute(fn);
}
