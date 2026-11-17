import { auditRoles, ensurePartitions, schemaLint, withOwnerClient } from './maintenance.js';
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
}

/**
 * The `migrate` role: apply pending migrations (owner role, DIRECT connection), roll the partition
 * window forward, then gate the deploy on the schema lint and the role audit. A violation fails the
 * run, so a bad migration stops the pipeline before services are updated (architecture 8.5).
 */
export async function runMigrate(
  migratorDatabaseUrl: string,
  logger: MigrationLogger,
): Promise<MigrateResult> {
  const applied = await migrate(migratorDatabaseUrl, logger);
  return withOwnerClient(migratorDatabaseUrl, async (client) => {
    const partitionsCreated = await ensurePartitions(client);
    const violations = [...(await schemaLint(client)), ...(await auditRoles(client))];
    if (violations.length > 0) throw new SchemaLintError(violations);
    return { applied, partitionsCreated };
  });
}
