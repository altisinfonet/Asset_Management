import { AsyncLocalStorage } from 'node:async_hooks';

/** Who performs an action; `app.audit_log.actor_type`. */
export type ActorType = 'user' | 'api_key' | 'integration' | 'system';

/**
 * Ambient per-request data (M1-PLAT-02: request id propagation). Set once per HTTP request by the
 * Fastify `onRequest` hook in `createApiApp`, and once per job by the worker wrapper; read by the
 * problem filter, the logger bindings, the audit writer and `withTenantTx`, which writes the request
 * id into `app.request_id` so audit rows and logs correlate. Outside a request (CLI) the store is
 * empty and everything falls back to "no request id".
 *
 * The object is mutable on purpose: the authentication guard learns the tenant and actor AFTER the
 * `onRequest` hook created the context, and calls {@link bindRequestIdentity} so logs, spans and
 * audit rows of the rest of the request carry them.
 */
export interface RequestContext {
  requestId: string;
  /** Client address (after trust-proxy resolution); recorded on audit rows. */
  ip?: string;
  userAgent?: string;
  /** Set by authentication / the job wrapper. Absent = anonymous request. */
  tenantId?: string;
  actorId?: string;
  actorType?: ActorType;
  /**
   * M2-LOC-03 (ED-26): the location subtrees the request is limited to, as the ids of their root
   * locations; `null` or absent = not limited (an org-wide grant). Set by the auth guard from the
   * grants that give the route's permission; every `withTenantTx` of the request inherits it.
   */
  locationScope?: readonly string[] | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `ctx` as the ambient request context (also for everything `fn` awaits). */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The ambient request context, if the caller runs inside a request. */
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The ambient request id, if any. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Records who the request acts for (called by the auth guard once the credential is verified).
 * No-op outside a request context.
 */
export function bindRequestIdentity(identity: {
  tenantId?: string;
  actorId?: string;
  actorType?: ActorType;
  locationScope?: readonly string[] | null;
}): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  if (identity.tenantId !== undefined) ctx.tenantId = identity.tenantId;
  if (identity.actorId !== undefined) ctx.actorId = identity.actorId;
  if (identity.actorType !== undefined) ctx.actorType = identity.actorType;
  if (identity.locationScope !== undefined) ctx.locationScope = identity.locationScope;
}
