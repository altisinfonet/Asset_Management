import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ambient per-request data (M1-PLAT-02: request id propagation). Set once per HTTP request by the
 * Fastify `onRequest` hook in `createApiApp`; read by the problem filter, the logger bindings and
 * `withTenantTx`, which writes it into `app.request_id` so audit rows and logs correlate. Outside a
 * request (CLI, jobs) the store is empty and everything falls back to "no request id".
 */
export interface RequestContext {
  requestId: string;
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
