// Public facade of the observability module (M1-OPS-01): metrics, tracing, the internal ops server
// and the Fastify hooks that feed them.
export { registerHttpObservability } from './http.js';
export {
  httpDuration,
  httpRequests,
  jobDuration,
  jobsProcessed,
  onScrape,
  outboxEvents,
  registry,
  renderMetrics,
  setDbPool,
  setQueueDepth,
  statusClass,
} from './metrics.js';
export {
  startOpsServer,
  type OpsHandler,
  type OpsResponse,
  type OpsServerOptions,
  type RunningOpsServer,
} from './ops-server.js';
export {
  SpanKind,
  SpanStatusCode,
  initTracing,
  shutdownTracing,
  startSpan,
  withSpan,
  type TracingOptions,
} from './tracing.js';
