import { getApi, type UiError } from '@/lib/api';

/**
 * Bulk operations on assets. The contract has no bulk endpoint yet (M1-REG-09), so the client
 * applies the change one asset at a time with a small concurrency limit: each item reads its own
 * ETag, writes with `If-Match` and reports its own result, so one failure never stops the rest.
 * When a bulk endpoint lands this module is the only place that changes.
 */
export interface BulkItem {
  id: string;
  /** What to show for the item in the results (the asset tag). */
  label: string;
}

export interface BulkResult {
  item: BulkItem;
  ok: boolean;
  error?: UiError;
}

export async function runBulk(
  items: BulkItem[],
  operation: (item: BulkItem) => Promise<unknown>,
  options: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<BulkResult[]> {
  const results: BulkResult[] = new Array<BulkResult>(items.length);
  const concurrency = Math.max(1, options.concurrency ?? 4);
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index]!;
      try {
        await operation(item);
        results[index] = { item, ok: true };
      } catch (err) {
        results[index] = { item, ok: false, error: getApi().toUiError(err) };
      }
      done += 1;
      options.onProgress?.(done, items.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
