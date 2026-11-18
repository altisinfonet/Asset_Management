// Public facade of the jobs module (M1-PLAT-06/07). pg-boss never leaks past this directory (and the
// owner-path provisioning in src/db): domain code uses the JOB_QUEUE port and the handler registry.
export { JobAdmin, type DeadLetterEntry } from './admin.js';
export {
  maintenanceBossOptions,
  PGBOSS_SCHEMA,
  provisioningBossOptions,
  runtimeBossOptions,
} from './boss-options.js';
export { registerBuiltinJobs } from './builtin.js';
export {
  DEAD_LETTER_QUEUE,
  PRIORITY,
  QUEUES,
  allQueues,
  queueDefinition,
  type JobPriorityClass,
  type JobRunner,
  type QueueDefinition,
  type QueueName,
} from './catalogue.js';
export {
  PgBossJobQueue,
  TenantPayloadError,
  UnknownQueueError,
  type EnqueueOptions,
} from './job-queue.js';
export { JobsRuntime, registerQueueDepthCollector } from './jobs-runtime.js';
export { JobsModule } from './jobs.module.js';
export { MaintenanceInstance } from './maintenance.js';
export {
  HandlerRegistrationError,
  JobHandlerRegistry,
  type JobContextBase,
  type RegisteredHandler,
  type SystemJobContext,
  type SystemJobHandler,
  type TenantJobContext,
  type TenantJobHandler,
} from './registry.js';
export { PRODUCERS, Scheduler, type Producer, type SchedulerDeps } from './scheduler.js';
export { dbFromTx, splitPlaceholders } from './tx-db.js';
export {
  JobWorker,
  MissingTenantContextError,
  UnknownTenantError,
  type JobWorkerDeps,
  type JobWorkerOptions,
} from './worker.js';
