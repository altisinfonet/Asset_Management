// Public facade of the tenancy module. Other modules import from here only.
// `Prisma` (the namespace: `Prisma.sql`, `Prisma.JsonNull`, input types...) is re-exported so other
// modules can build values and types without importing the generated client directly. It cannot
// run a query: queries need a `Tx`, and a `Tx` only exists inside withTenantTx / withPreTenantTx.
export { Prisma } from '../generated/prisma/client.js';
export { asBytes } from './bytes.js';
export { isUniqueViolation, prismaCodeOf, sqlStateOf } from './errors.js';
export { TenancyModule } from './tenancy.module.js';
export { TenancyService, type PingResult, type TenancyOptions } from './tenancy.service.js';
export { TenantRepository } from './tenant-repository.js';
export {
  DEFAULT_TX_OPTIONS,
  NoTenantTransactionError,
  currentTenantContext,
  currentTenantTx,
  withPreTenantTx,
  withTenantTx,
  type TenantContext,
  type Tx,
  type TxOptions,
  type TxSource,
} from './tenant-tx.js';
