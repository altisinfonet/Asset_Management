import type { Tx } from '../tenancy/index.js';

/**
 * Runs `fn` inside a savepoint of the open tenant transaction: when it throws, everything it wrote
 * is rolled back and the transaction stays usable (a failed statement would otherwise poison it).
 * Bulk operations use it so one failing item cannot take the others down (M1-REG-09). The savepoint
 * name is a constant: savepoints do not nest in this code.
 */
export async function inSavepoint<T>(trx: Tx, fn: () => Promise<T>): Promise<T> {
  await trx.$executeRaw`savepoint registry_item`;
  try {
    const result = await fn();
    await trx.$executeRaw`release savepoint registry_item`;
    return result;
  } catch (err) {
    await trx.$executeRaw`rollback to savepoint registry_item`;
    await trx.$executeRaw`release savepoint registry_item`;
    throw err;
  }
}
