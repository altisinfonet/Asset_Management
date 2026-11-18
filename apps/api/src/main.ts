import 'reflect-metadata';
import { createApiApp } from './app.js';
import { createTemporarySecretBox } from './auth/index.js';
import { ConfigError, loadConfig } from './config/env.js';
import { runMigrate } from './db/run-migrate.js';
import { createLogger } from './logging/logger.js';
import { runIdleRole } from './roles/idle-role.js';
import { seedDemoData } from './seed/seed.js';
import { TenancyService } from './tenancy/index.js';

/**
 * One image, many roles: `node dist/main.js <api|worker|scheduler|migrate>`.
 * The role can also come from APP_ROLE; the command-line argument wins.
 */
async function main(): Promise<void> {
  const config = loadConfig({ ...process.env, APP_ROLE: process.argv[2] ?? process.env.APP_ROLE });
  const logger = createLogger(config);

  switch (config.APP_ROLE) {
    case 'api': {
      const app = await createApiApp(config);
      await app.listen({ port: config.PORT, host: config.HOST });
      return; // the HTTP server keeps the process alive; shutdown hooks handle SIGTERM
    }
    case 'worker':
    case 'scheduler':
      await runIdleRole(config.APP_ROLE, logger);
      return;
    case 'migrate': {
      const { applied, partitionsCreated } = await runMigrate(
        config.MIGRATOR_DATABASE_URL!,
        logger,
      );
      logger.info(
        { applied, partitionsCreated },
        applied.length ? 'migrations applied' : 'no pending migrations',
      );
      if (config.SEED_DEMO_DATA) {
        // Dev only (refused in production). Seeds as the owner role: FORCE RLS still binds it, the
        // tenant context is set per transaction exactly like the runtime path.
        const tenancy = new TenancyService({
          connectionString: config.MIGRATOR_DATABASE_URL!,
          poolMax: 2,
          applicationName: 'assettracker-seed',
        });
        try {
          const { tenants } = await seedDemoData(tenancy, {
            nodeEnv: config.NODE_ENV,
            secretBox: createTemporarySecretBox(), // TEMPORARY: the platform SecretBox when it lands
            logger: { info: (msg) => logger.info(msg) },
          });
          logger.info({ tenants }, 'demo data ready');
        } finally {
          await tenancy.onModuleDestroy();
        }
      }
      return;
    }
  }
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    console.error(JSON.stringify({ level: 'fatal', msg: 'startup failed', err: String(err) }));
    if (err instanceof Error && err.stack) console.error(err.stack);
  }
  process.exit(1);
});
