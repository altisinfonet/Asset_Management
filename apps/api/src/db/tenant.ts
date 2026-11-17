import type { PoolClient } from 'pg';
import { z } from 'zod';

const tenantIdSchema = z.uuid();

/** The slice of `pg.Pool` that `runWithTenant` needs (lets tests pass a fake). */
export interface ClientSource {
  connect(): Promise<PoolClient>;
}

/**
 * Runs `fn` inside a transaction with `app.tenant_id` set via `set_config(..., true)`
 * (transaction-local), so row-level security policies see the tenant and nothing leaks to the
 * next borrower of a pooled (PgBouncer transaction-mode) connection.
 *
 * Never use a session-level SET for tenant context: it survives the transaction and leaks.
 */
export async function runWithTenant<T>(
  source: ClientSource,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const id = tenantIdSchema.parse(tenantId);
  const client = await source.connect();
  try {
    await client.query('BEGIN');
    await client.query("select set_config('app.tenant_id', $1, true)", [id]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original error is the one worth surfacing.
    }
    throw err;
  } finally {
    client.release();
  }
}
