import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics (M1-OPS-01). One registry per process, scraped on the internal ops port
 * (`/metrics`), never on the public API port.
 *
 * LABEL RULES: labels are low-cardinality and tenant-free. `tenant_id` is deliberately NOT a label
 * anywhere (one series per tenant would explode the TSDB and leak the tenant list into monitoring);
 * it is a span and log attribute instead. `route` is the route PATTERN (`/v1/assets/:id`), never the
 * concrete URL.
 */
export const registry = new Registry();
registry.setDefaultLabels({ service: 'assettracker' });
collectDefaultMetrics({ register: registry });

/** RED: rate and errors from `http_requests_total`, duration from the histogram. */
export const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests by method, route pattern and status code',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration by method, route pattern and status class',
  labelNames: ['method', 'route', 'status_class'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const jobsProcessed = new Counter({
  name: 'jobs_processed_total',
  help: 'Background jobs handled, by queue and result (completed|failed|skipped)',
  labelNames: ['queue', 'result'] as const,
  registers: [registry],
});

export const jobDuration = new Histogram({
  name: 'job_duration_seconds',
  help: 'Background job handler duration by queue',
  labelNames: ['queue'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
  registers: [registry],
});

export const outboxEvents = new Counter({
  name: 'outbox_events_total',
  help: 'Outbox relay outcomes (delivered|failed|dead_lettered)',
  labelNames: ['result'] as const,
  registers: [registry],
});

const dbPool = new Gauge({
  name: 'db_pool_connections',
  help: 'Database connection pool (state = max|total|idle|waiting)',
  labelNames: ['state'] as const,
  registers: [registry],
});

const queueDepth = new Gauge({
  name: 'jobs_queue_depth',
  help: 'Jobs per queue and state (ready|deferred|active|failed)',
  labelNames: ['queue', 'state'] as const,
  registers: [registry],
});

/** Async work done right before each scrape (pool gauges, queue depth). Failures never fail a scrape. */
const scrapeHooks = new Set<() => Promise<void> | void>();

export function onScrape(hook: () => Promise<void> | void): () => void {
  scrapeHooks.add(hook);
  return () => scrapeHooks.delete(hook);
}

export function setDbPool(stats: {
  max: number;
  total: number;
  idle: number;
  waiting: number;
}): void {
  for (const [state, value] of Object.entries(stats)) dbPool.set({ state }, value);
}

export function setQueueDepth(
  queue: string,
  counts: { ready: number; deferred: number; active: number; failed: number },
): void {
  for (const [state, value] of Object.entries(counts)) queueDepth.set({ queue, state }, value);
}

/** Prometheus text exposition of everything, after running the scrape hooks. */
export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  await Promise.all(
    [...scrapeHooks].map(async (hook) => Promise.resolve(hook()).catch(() => undefined)),
  );
  return { contentType: registry.contentType, body: await registry.metrics() };
}

/** `2xx`..`5xx` for a numeric status code. */
export const statusClass = (status: number): string => `${Math.floor(status / 100)}xx`;
