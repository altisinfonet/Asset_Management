import 'reflect-metadata';
import { createApiApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
import { runMigrate } from './db/run-migrate.js';
import { createLogger } from './logging/logger.js';
import {
  initTracing,
  onScrape,
  setDbPool,
  shutdownTracing,
  startOpsServer,
} from './observability/index.js';
import { runSchedulerRole } from './roles/scheduler.js';
import { runWorkerRole } from './roles/worker.js';
import { seedDemoData } from './seed/seed.js';
import { TenancyService } from './tenancy/index.js';

/**
 * One image, many roles: `node dist/main.js <api|worker|scheduler|migrate>`.
 * The role can also come from APP_ROLE; the command-line argument wins.
 */
async function main(): Promise<void> {
  const config = loadConfig({ ...process.env, APP_ROLE: process.argv[2] ?? process.env.APP_ROLE });
  const logger = createLogger(config);
  const tracing = initTracing({
    endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: config.OTEL_SERVICE_NAME,
    role: config.APP_ROLE,
  });
  if (tracing) logger.info('OpenTelemetry tracing enabled');
  process.once('beforeExit', () => void shutdownTracing());

  switch (config.APP_ROLE) {
    case 'api': {
      const app = await createApiApp(config);
      // /metrics lives on its own internal port, never on the public listener. Hooks can only be
      // added before the server listens.
      if (config.OPS_ENABLED) {
        const ops = await startOpsServer({ host: config.OPS_HOST, port: config.OPS_PORT });
        const tenancy = app.get(TenancyService);
        onScrape(() => setDbPool(tenancy.poolStats()));
        app
          .getHttpAdapter()
          .getInstance()
          .addHook('onClose', async () => ops.close());
        logger.info({ ops_port: ops.port }, 'ops server listening (/metrics)');
      }
      await app.listen({ port: config.PORT, host: config.HOST });
      return; // the HTTP server keeps the process alive; shutdown hooks handle SIGTERM
    }
    case 'worker':
      await runWorkerRole(config, logger);
      await shutdownTracing();
      return process.exit(0); // graceful shutdown finished; do not wait for stray handles
    case 'scheduler':
      await runSchedulerRole(config, logger);
      await shutdownTracing();
      return process.exit(0);
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
