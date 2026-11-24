import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Deferred bookkeeping writes (M2-OPS-01). While a bulk job (an import batch) runs inside `withBulkSink`, the
 * audit writer, the outbox publisher and the asset-history writer do not insert their rows one statement at a
 * time: they hand the row to the sink, and the job flushes the three buffers with ONE multi-row INSERT each
 * before its transaction commits. The rows are the same, in the same transaction, written by the same code
 * (the writers still validate and build them); only the number of round trips changes, which is most of the
 * cost of creating an asset (four of its six statements).
 *
 * Nothing outside a `withBulkSink` scope is affected. Code that must READ what it just wrote (the audit
 * trail, history, events) must not run inside a scope.
 */
export interface BulkSink {
  audit: Array<Record<string, unknown>>;
  outbox: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
}

const store = new AsyncLocalStorage<BulkSink>();

export const currentBulkSink = (): BulkSink | undefined => store.getStore();

export function withBulkSink<T>(fn: (sink: BulkSink) => Promise<T>): Promise<T> {
  const sink: BulkSink = { audit: [], outbox: [], history: [] };
  return store.run(sink, () => fn(sink));
}
