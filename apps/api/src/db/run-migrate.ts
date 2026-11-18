import { auditRoles, ensurePartitions, schemaLint, withOwnerClient } from './maintenance.js';
import { provisionJobs } from './provision-jobs.js';
import { migrate, type MigrationLogger } from './migrator.js';

export class SchemaLintError extends Error {
  constructor(readonly violations: string[]) {
    super(`schema lint failed:\n${violations.map((v) => `  - ${v}`).join('\n')}`);
    this.name = 'SchemaLintError';
  }
}

export interface MigrateResult {
  applied: string[];
  partitionsCreated: number;
  /** pg-boss queues ensured (the dead-letter queue first). */
  queues: string[];
}

/**
 * The `migrate` role: apply pending migrations (owner role, DIRECT connection), roll the partition
 * window forward, then gate the deploy on the schema lint and the role audit. A violation fails the
 * run, so a bad migration stops the pipeline before services are updated (architecture 8.5).
 */
export async function runMigrate(
  migratorDatabaseUrl: string,
  logger: MigrationLogger,
  jobsSchema?: string,
): Promise<MigrateResult> {
  const applied = await migrate(migratorDatabaseUrl, logger);
  // pg-boss schema + queues + runtime grants, over the same direct owner connection (M1-PLAT-06).
  const { queues } = await provisionJobs(migratorDatabaseUrl, logger, jobsSchema);
  return withOwnerClient(migratorDatabaseUrl, async (client) => {
    const partitionsCreated = await ensurePartitions(client);
    const violations = [...(await schemaLint(client)), ...(await auditRoles(client))];
    if (violations.length > 0) throw new SchemaLintError(violations);
    return { applied, partitionsCreated, queues };
  });
}
