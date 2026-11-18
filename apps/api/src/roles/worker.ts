import { NestFactory } from '@nestjs/core';
import type { ModuleMetadata } from '@nestjs/common';
import { Logger as NestPinoLogger } from 'nestjs-pino';
import type { Logger } from 'pino';
import { AppModule } from '../app.module.js';
import type { AppConfig } from '../config/env.js';
import { ControlPlaneService } from '../control-plane/index.js';
import { JobAdmin, JobHandlerRegistry, JobWorker, JobsRuntime } from '../jobs/index.js';
import { onScrape, setDbPool, startOpsServer } from '../observability/index.js';
import { OutboxRelay, OutboxSubscribers } from '../outbox/index.js';
import { TenancyService } from '../tenancy/index.js';
import { Heartbeat, waitForShutdownSignal } from './lifecycle.js';

const HEARTBEAT_MS = 10_000;
/** `/healthz` fails after three missed heartbeats. */
const HEARTBEAT_MAX_AGE_MS = 3 * HEARTBEAT_MS + 5_000;

/**
 * The `worker` role (M1-PLAT-07). One process, three jobs:
 *   1. pg-boss workers for every worker-runner queue (`mail.send`, `tenant.heartbeat`, and whatever
 *      domain modules register), polling every 1-2 s, each job inside `withTenantTx(payload.tenantId)`;
 *   2. the outbox relay: per active tenant, claim pending events (SKIP LOCKED) and dispatch them to
 *      the in-process subscribers, with backoff and dead-lettering;
 *   3. the internal ops server: `/healthz` (fresh heartbeat), `/readyz` (database + pg-boss up),
 *      `/metrics`, and the read-only dead-letter listing `/admin/jobs/dead-letter`.
 * Stops gracefully on SIGTERM: stop fetching, finish running jobs, drain the relay, flush traces.
 */
export async function runWorkerRole(
  config: AppConfig,
  logger: Logger,
  extraImports: ModuleMetadata['imports'] = [],
): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule.register(config, extraImports), {
    bufferLogs: true,
  });
  app.useLogger(app.get(NestPinoLogger));
  // No enableShutdownHooks(): the role owns its signal handling (lifecycle.ts) and closes the app last.

  const tenancy = app.get(TenancyService);
  const controlPlane = app.get(ControlPlaneService);
  const runtime = app.get(JobsRuntime);
  const registry = app.get(JobHandlerRegistry);

  const boss = await runtime.get();
  const worker = new JobWorker(
    { boss, tenancy, controlPlane, registry, logger },
    {
      runner: 'worker',
      pollingIntervalSeconds: config.JOBS_POLL_SECONDS,
      localConcurrency: config.JOBS_LOCAL_CONCURRENCY,
      tenantConcurrency: config.JOBS_TENANT_CONCURRENCY,
    },
  );
  const queues = await worker.start();

  const relay = new OutboxRelay({
    tenancy,
    tenants: () => controlPlane.listActiveTenants(),
    subscribers: app.get(OutboxSubscribers),
    logger,
    options: { maxAttempts: config.OUTBOX_MAX_ATTEMPTS },
  });
  relay.start(config.OUTBOX_RELAY_INTERVAL_MS);

  const heartbeat = new Heartbeat();
  heartbeat.start(
    HEARTBEAT_MS,
    async () => {
      await tenancy.ping();
    },
    (err) => logger.error({ err }, 'worker heartbeat failed'),
  );
  onScrape(() => setDbPool(tenancy.poolStats()));

  const admin = new JobAdmin(() => runtime.get());
  const ops = config.OPS_ENABLED
    ? await startOpsServer(
        { host: config.OPS_HOST, port: config.OPS_PORT },
        {
          live: () => heartbeat.isFresh(HEARTBEAT_MAX_AGE_MS),
          ready: async () => {
            await tenancy.ping();
            return { ok: runtime.started, queues };
          },
          routes: {
            '/admin/jobs/dead-letter': async (_req, url) => ({
              body: { data: await admin.deadLetters(Number(url.searchParams.get('limit') ?? 100)) },
            }),
          },
        },
      )
    : undefined;

  logger.info({ queues, ops_port: ops?.port }, 'worker role started');
  await waitForShutdownSignal(logger, 'worker');

  heartbeat.stop();
  await relay.stop();
  await worker.stop();
  await ops?.close();
  await app.close();
  logger.info('worker role stopped');
}
