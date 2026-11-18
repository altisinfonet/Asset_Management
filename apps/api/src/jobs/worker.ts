import type { Logger } from 'pino';
import type { JobResult, JobWithMetadata, PgBoss } from 'pg-boss';
import { type RequestContext, runWithRequestContext } from '../context/request-context.js';
import type { ControlPlaneService } from '../control-plane/index.js';
import { jobDuration, jobsProcessed, withSpan } from '../observability/index.js';
import type { TenancyService } from '../tenancy/index.js';
import { type JobRunner, queueDefinition } from './catalogue.js';
import type {
  JobHandlerRegistry,
  RegisteredHandler,
  SystemJobHandler,
  TenantJobHandler,
} from './registry.js';

const BATCH_SIZE = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A tenant-scoped job arrived without a usable tenant id: refused, never run without context. */
export class MissingTenantContextError extends Error {
  constructor(queue: string, jobId: string) {
    super(
      `job ${jobId} on tenant-scoped queue ${queue} has no valid payload.tenantId; refusing to run`,
    );
    this.name = 'MissingTenantContextError';
  }
}

/** The tenant is unknown to the control plane: a poisoned job that must not retry forever. */
export class UnknownTenantError extends Error {
  constructor(tenantId: string) {
    super(`job for unknown tenant ${tenantId}`);
    this.name = 'UnknownTenantError';
  }
}

export interface JobWorkerOptions {
  runner: JobRunner;
  /** Seconds between polls (1-2 per architecture 5.2; no LISTEN/NOTIFY). */
  pollingIntervalSeconds: number;
  /** Parallel workers per queue in this process. */
  localConcurrency: number;
  /** Max jobs of ONE tenant running at once in this process (fairness). */
  tenantConcurrency: number;
}

export interface JobWorkerDeps {
  boss: PgBoss;
  tenancy: TenancyService;
  controlPlane: Pick<ControlPlaneService, 'resolveTenant'>;
  registry: JobHandlerRegistry;
  logger: Logger;
}

/**
 * Subscribes the handlers of one runner to their queues and wraps every job in the tenant context
 * (architecture 5.2):
 *
 *   fetch (SKIP LOCKED, polling) -> verify the tenant exists and is active (control plane)
 *     -> BEGIN; set_config(app.tenant_id, app.actor_id = job id, app.request_id = job:<id>)
 *     -> handler(payload, { tx }) -> COMMIT -> pg-boss marks the job complete
 *
 * Failure throws back to pg-boss: retry with exponential backoff (catalogue), then the dead-letter
 * queue. A suspended tenant's jobs complete as `skipped`; an unknown tenant's fail (poisoned).
 * No handler can run without tenant context: tenant queues are only reachable through this wrapper,
 * and the wrapper validates `payload.tenantId` before anything else.
 */
export class JobWorker {
  private readonly active = new Set<Promise<void>>();

  constructor(
    private readonly deps: JobWorkerDeps,
    private readonly options: JobWorkerOptions,
  ) {}

  /** Starts polling for every registered handler of this runner. Returns the queue names. */
  async start(): Promise<string[]> {
    const { boss, registry } = this.deps;
    const handlers = registry.forRunner(this.options.runner);
    for (const handler of handlers) {
      await boss.work(
        handler.queue,
        {
          pollingIntervalSeconds: this.options.pollingIntervalSeconds,
          localConcurrency: this.options.localConcurrency,
          // A small batch + burst: a backlog drains at handler speed instead of one job per poll.
          // perJobResults settles each job on its own, so one failure never fails its batch mates.
          batchSize: BATCH_SIZE,
          burstWhenBatchFull: true,
          perJobResults: true,
          includeMetadata: true,
          ...(handler.tenantScoped
            ? { localGroupConcurrency: this.options.tenantConcurrency }
            : {}),
        },
        async (jobs: JobWithMetadata<Record<string, unknown>>[]): Promise<JobResult[]> => {
          const results: JobResult[] = [];
          for (const job of jobs) {
            try {
              await this.track(this.run(handler, job));
              results.push({ id: job.id, status: 'completed' });
            } catch (err) {
              results.push({
                id: job.id,
                status: 'failed',
                output: { error: err instanceof Error ? err.message : String(err) },
              });
            }
          }
          return results;
        },
      );
    }
    return handlers.map((h) => h.queue);
  }

  /** Stops fetching and waits for running jobs (graceful shutdown). */
  async stop(timeoutMs = 20_000): Promise<void> {
    await this.deps.boss.stop({ graceful: true, timeout: timeoutMs }).catch(() => undefined);
    await Promise.allSettled([...this.active]);
  }

  /** Runs ONE job through the full wrapper. Exposed for tests; `start` uses it for every fetched job. */
  async run(
    handler: RegisteredHandler,
    job: JobWithMetadata<Record<string, unknown>>,
  ): Promise<void> {
    const { logger, tenancy, controlPlane } = this.deps;
    const queue = handler.queue;
    const started = performance.now();
    const requestId = `job:${job.id}`;
    const data = job.data ?? {};

    let tenantId: string | undefined;
    if (handler.tenantScoped) {
      const raw = data.tenantId;
      if (typeof raw !== 'string' || !UUID.test(raw)) {
        jobsProcessed.inc({ queue, result: 'failed' });
        throw new MissingTenantContextError(queue, job.id);
      }
      tenantId = raw.toLowerCase();
    }

    const context: RequestContext = {
      requestId,
      actorType: 'system',
      actorId: job.id,
      ...(tenantId ? { tenantId } : {}),
    };
    const base = { jobId: job.id, queue, retryCount: job.retryCount, logger };

    try {
      await runWithRequestContext(context, () =>
        withSpan(
          `job ${queue}`,
          {
            queue,
            job_id: job.id,
            request_id: requestId,
            ...(tenantId ? { tenant_id: tenantId } : {}),
          },
          async () => {
            if (!tenantId) {
              await (handler.handle as SystemJobHandler<Record<string, unknown>>)(data, base);
              jobsProcessed.inc({ queue, result: 'completed' });
              return;
            }
            const entry = await controlPlane.resolveTenant(tenantId);
            if (!entry) throw new UnknownTenantError(tenantId);
            if (entry.status !== 'active') {
              logger.warn(
                { queue, tenant_id: tenantId, status: entry.status },
                'job skipped: tenant not active',
              );
              jobsProcessed.inc({ queue, result: 'skipped' });
              return;
            }
            await tenancy.withTenantTx({ tenantId, actorId: job.id, requestId }, (tx) =>
              (handler.handle as TenantJobHandler<Record<string, unknown>>)(
                { ...data, tenantId: tenantId! },
                { ...base, tenantId: tenantId!, tx },
              ),
            );
            jobsProcessed.inc({ queue, result: 'completed' });
          },
        ),
      );
    } catch (err) {
      jobsProcessed.inc({ queue, result: 'failed' });
      logger.error(
        { queue, job_id: job.id, retry_count: job.retryCount, tenant_id: tenantId, err },
        'job failed',
      );
      throw err;
    } finally {
      jobDuration.observe({ queue }, (performance.now() - started) / 1000);
    }
  }

  private track(p: Promise<void>): Promise<void> {
    this.active.add(p);
    const done = () => this.active.delete(p);
    void p.then(done, done);
    return p;
  }
}

export const isTenantQueue = (queue: string): boolean =>
  queueDefinition(queue)?.tenantScoped ?? false;
