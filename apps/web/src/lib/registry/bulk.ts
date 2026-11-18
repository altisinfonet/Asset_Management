import { ApiError } from '@assettracker/api-client';
import { getApi, type UiError } from '@/lib/api';
import type { BulkAssetResult } from './types';

/**
 * Bulk operations on assets over the contract's bulk endpoints (`POST /v1/assets/bulk-update`,
 * `bulk-archive`, `bulk-restore`): one request takes up to 100 ids and answers `200` with one
 * result per id (the status the single-asset call would have returned, and the problem document
 * when it failed); a failing item never rolls back the others. A selection larger than the
 * limit is sent in chunks of 100.
 */
export const BULK_MAX = 100;

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

/** Turns one result of a bulk response (or a failure of the whole request) into a `UiError`. */
function itemError(status: number, problem: unknown): UiError {
  return getApi().toUiError(new ApiError(`bulk item failed with ${status}`, status, problem));
}

export async function runBulk(
  items: BulkItem[],
  call: (ids: string[]) => Promise<BulkAssetResult>,
  options: { onProgress?: (done: number, total: number) => void } = {},
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (let start = 0; start < items.length; start += BULK_MAX) {
    const chunk = items.slice(start, start + BULK_MAX);
    try {
      const response = await call(chunk.map((item) => item.id));
      const byIndex = new Map(response.results.map((r) => [r.index, r]));
      chunk.forEach((item, index) => {
        const result = byIndex.get(index);
        if (result && result.status >= 200 && result.status < 300) {
          results.push({ item, ok: true });
        } else {
          results.push({
            item,
            ok: false,
            error: itemError(result?.status ?? 500, result?.error),
          });
        }
      });
    } catch (err) {
      // The whole request failed (validation, permission, session ended): every item of it did.
      const error = getApi().toUiError(err);
      for (const item of chunk) results.push({ item, ok: false, error });
    }
    options.onProgress?.(results.length, items.length);
  }
  return results;
}
