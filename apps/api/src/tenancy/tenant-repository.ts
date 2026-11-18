import { currentTenantContext, currentTenantTx, type TenantContext, type Tx } from './tenant-tx.js';

/**
 * Base class of every repository that touches tenant data (architecture A1: the only DB access
 * path). The Prisma transaction client is reachable only through `this.db`, which exists only
 * inside `withTenantTx`; anywhere else it throws {@link NoTenantTransactionError}.
 *
 *   class AssetRepository extends TenantRepository {
 *     findByTag(tag: string) {
 *       return this.db.asset.findFirst({ where: { asset_tag: tag } });
 *     }
 *   }
 *
 * Tenant scoping is enforced by RLS in the database; repositories must still never accept a
 * tenant id from callers (use `this.context.tenantId` when one is needed, for example in INSERTs).
 * Ids are application-generated UUIDv7 (`uuidv7()`) and passed explicitly on create. Partitioned
 * tables (`audit_log`) and anything Prisma cannot model go through `this.db.$queryRaw` /
 * `$executeRaw` tagged templates only (the `*Unsafe` variants are banned by ESLint).
 */
export abstract class TenantRepository {
  /** Transaction-bound Prisma client. Throws outside `withTenantTx`. */
  protected get db(): Tx {
    return currentTenantTx();
  }

  /** The tenant context of the enclosing transaction. Throws outside `withTenantTx`. */
  protected get context(): TenantContext {
    currentTenantTx(); // throws NoTenantTransactionError when there is no active transaction
    return currentTenantContext()!;
  }
}
