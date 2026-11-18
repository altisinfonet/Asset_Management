import { ensurePartitions, withOwnerClient } from '../db/maintenance.js';
import type { JobHandlerRegistry } from './registry.js';

/**
 * The first real jobs (M1-PLAT-07):
 *  - `tenant.heartbeat`: a no-op per-tenant tick. It proves the whole path scheduler -> pg-boss ->
 *    worker -> tenant transaction on every deployment, and is what the tests observe.
 *  - `maintenance.partition-rotate`: rolls the monthly partition window of every partitioned table
 *    forward (`app.ensure_partitions`). That function is executable by the OWNER role only, so the
 *    handler is bound to the scheduler role, which holds the direct owner connection.
 */
export function registerBuiltinJobs(
  registry: JobHandlerRegistry,
  options: { ownerDatabaseUrl?: string },
): void {
  registry.registerTenant('tenant.heartbeat', async (payload, ctx) => {
    ctx.logger.debug({ tenant_id: ctx.tenantId, bucket: payload.bucket }, 'tenant heartbeat');
  });

  registry.registerSystem('maintenance.partition-rotate', async (_payload, ctx) => {
    const url = options.ownerDatabaseUrl;
    if (!url)
      throw new Error('partition rotation needs the owner connection (MAINTENANCE_DATABASE_URL)');
    const created = await withOwnerClient(
      url,
      (client) => ensurePartitions(client),
      'partition-rotate',
    );
    ctx.logger.info({ created }, 'partition rotation done');
  });
}
