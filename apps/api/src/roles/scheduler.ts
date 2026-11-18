import { NestFactory } from '@nestjs/core';
import type { ModuleMetadata } from '@nestjs/common';
import { Logger as NestPinoLogger } from 'nestjs-pino';
import type { Logger } from 'pino';
import { AppModule } from '../app.module.js';
import type { AppConfig } from '../config/env.js';
import { ControlPlaneService } from '../control-plane/index.js';
import {
  JobHandlerRegistry,
  JobWorker,
  JobsRuntime,
  MaintenanceInstance,
  Scheduler,
} from '../jobs/index.js';
import { onScrape, setDbPool, startOpsServer } from '../observability/index.js';
import { TenancyService } from '../tenancy/index.js';
import { Heartbeat, waitForShutdownSignal } from './lifecycle.js';

const HEARTBEAT_MS = 10_000;
const HEARTBEAT_MAX_AGE_MS = 3 * HEARTBEAT_MS + 5_000;

/**
 * The `scheduler` role (M1-PLAT-07). The one process with the OWNER database connection
 * (`MAINTENANCE_DATABASE_URL`, direct, never through the pooler):
 *   1. the pg-boss MAINTENANCE instance (`supervise` on): expiry of hung jobs, retention, archival,
 *      queue statistics. Runtime instances have supervise off, so this is the single place it runs
 *      (two schedulers are safe: pg-boss serialises maintenance with advisory locks);
 *   2. the cron PRODUCERS (`jobs/scheduler.ts`): per-tenant fan-out (tenants enumerated from the
 *      control plane) with singleton keys, so replicas never duplicate a job;
 *   3. a worker for the scheduler-runner queues that need owner privileges (partition rotation).
 * Everything else (enqueue, fetch) goes through the normal `app_user` runtime instance.
 */
export async function runSchedulerRole(
  config: AppConfig,
  logger: Logger,
  extraImports: ModuleMetadata['imports'] = [],
): Promise<void> {
  const ownerUrl = config.MAINTENANCE_DATABASE_URL ?? config.MIGRATOR_DATABASE_URL!;
  const app = await NestFactory.createApplicationContext(AppModule.register(config, extraImports), {
    bufferLogs: true,
  });
  app.useLogger(app.get(NestPinoLogger));
  // No enableShutdownHooks(): the role owns its signal handling (lifecycle.ts) and closes the app last.

  const tenancy = app.get(TenancyService);
  const controlPlane = app.get(ControlPlaneService);
  const runtime = app.get(JobsRuntime);

  const maintenance = new MaintenanceInstance(ownerUrl, logger);
  await maintenance.start();

  const boss = await runtime.get();
  const ownerJobs = new JobWorker(
    { boss, tenancy, controlPlane, registry: app.get(JobHandlerRegistry), logger },
    {
      runner: 'scheduler',
      pollingIntervalSeconds: config.JOBS_POLL_SECONDS,
      localConcurrency: 1,
      tenantConcurrency: config.JOBS_TENANT_CONCURRENCY,
    },
  );
  const queues = await ownerJobs.start();

  const scheduler = new Scheduler({ queue: runtime.queue, controlPlane, logger });
  scheduler.start(config.SCHEDULER_TICK_SECONDS);

  const heartbeat = new Heartbeat();
  heartbeat.start(
    HEARTBEAT_MS,
    async () => {
      await tenancy.ping();
    },
    (err) => logger.error({ err }, 'scheduler heartbeat failed'),
  );
  onScrape(() => setDbPool(tenancy.poolStats()));

  const ops = config.OPS_ENABLED
    ? await startOpsServer(
        { host: config.OPS_HOST, port: config.OPS_PORT },
        {
          live: () => heartbeat.isFresh(HEARTBEAT_MAX_AGE_MS),
          ready: async () => {
            await tenancy.ping();
            return { ok: runtime.started && maintenance.started, queues };
          },
        },
      )
    : undefined;

  logger.info({ queues, ops_port: ops?.port }, 'scheduler role started');
  await waitForShutdownSignal(logger, 'scheduler');

  heartbeat.stop();
  await scheduler.stop();
  await ownerJobs.stop();
  await maintenance.stop();
  await ops?.close();
  await app.close();
  logger.info('scheduler role stopped');
}
