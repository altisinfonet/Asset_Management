import { currentTenantContext, currentTenantTx, type TenantContext, type Tx } from './tenant-tx.js';

/**
 * Base class of every repository that touches tenant data (architecture A1: the only DB access
 * path). The query builder is reachable only through `this.db`, which exists only inside
 * `withTenantTx`; anywhere else it throws {@link NoTenantTransactionError}.
 *
 *   class AssetRepository extends TenantRepository {
 *     findByTag(tag: string) {
 *       return this.db.selectFrom('app.asset').selectAll().where('asset_tag', '=', tag).executeTakeFirst();
 *     }
 *   }
 *
 * Tenant scoping is enforced by RLS in the database; repositories must still never accept a
 * tenant id from callers (use `this.context.tenantId` when one is needed, for example in INSERTs).
 */
export abstract class TenantRepository {
  /** Transaction-bound query builder. Throws outside `withTenantTx`. */
  protected get db(): Tx {
    return currentTenantTx();
  }

  /** The tenant context of the enclosing transaction. Throws outside `withTenantTx`. */
  protected get context(): TenantContext {
    currentTenantTx(); // throws NoTenantTransactionError when there is no active transaction
    return currentTenantContext()!;
  }
}
