// Public facade of the tenancy module. Other modules import from here only.
// `sql` is re-exported so other modules can write raw SQL fragments without importing the driver.
export { sql } from 'kysely';
export type { Database, JsonObject } from './database.js';
export { TenancyModule } from './tenancy.module.js';
export { TenancyService, type PingResult, type TenancyOptions } from './tenancy.service.js';
export { TenantRepository } from './tenant-repository.js';
export {
  NoTenantTransactionError,
  currentTenantContext,
  currentTenantTx,
  withPreTenantTx,
  withTenantTx,
  type TenantContext,
  type Tx,
  type TxSource,
} from './tenant-tx.js';
