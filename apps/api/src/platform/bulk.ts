import { ApiProblem, type FieldError, problem, toProblemBody } from './problem.js';
import type { ProblemBody } from './problem.js';

/**
 * Bulk convention (M1-PLAT-02): one request carries up to `max` items (default 100) and the
 * response lists a result per item, in request order:
 *
 *   200 { results: [ { index: 0, status: 201, data: {...} },
 *                    { index: 1, status: 422, error: { type, title, status, code, errors[] } } ],
 *         summary: { total: 2, succeeded: 1, failed: 1 } }
 *
 * The HTTP status is 200 whenever the request itself was well-formed; item outcomes are in the
 * body. Items run sequentially in order. `run` must report expected failures by throwing an
 * {@link ApiProblem} (validation, not found, conflict) BEFORE writing: when the request runs under an
 * Idempotency-Key everything shares one transaction, so a database error inside an item aborts the
 * whole request (it is rolled back and answered as a normal error), not just that item.
 */
export const DEFAULT_BULK_MAX = 100;

export interface BulkItemResult<T> {
  index: number;
  status: number;
  data?: T;
  error?: ProblemBody;
}

export interface BulkResponse<T> {
  results: Array<BulkItemResult<T>>;
  summary: { total: number; succeeded: number; failed: number };
}

export interface BulkOptions {
  /** Maximum number of items; more is `422 validation` pointing at the array. */
  max?: number;
  /** Status reported for a successful item (default 200; use 201 for bulk create). */
  successStatus?: number;
  /** `type` URI base for item problems. */
  typeBase?: string;
  requestId?: string;
  /** JSON pointer of the items array, for the over-limit error (default `/items`). */
  pointer?: string;
}

export async function runBulk<I, O>(
  items: readonly I[],
  run: (item: I, index: number) => Promise<O>,
  options: BulkOptions = {},
): Promise<BulkResponse<O>> {
  const max = options.max ?? DEFAULT_BULK_MAX;
  if (items.length === 0) {
    throw problem.validation([
      {
        pointer: options.pointer ?? '/items',
        message: 'must contain at least 1 item',
        code: 'too_small',
      },
    ]);
  }
  if (items.length > max) {
    const errors: FieldError[] = [
      {
        pointer: options.pointer ?? '/items',
        message: `must contain at most ${max} items (got ${items.length})`,
        code: 'too_big',
      },
    ];
    throw problem.validation(errors, `A bulk request accepts at most ${max} items.`);
  }

  const results: Array<BulkItemResult<O>> = [];
  for (const [index, item] of items.entries()) {
    try {
      results.push({ index, status: options.successStatus ?? 200, data: await run(item, index) });
    } catch (err) {
      if (!(err instanceof ApiProblem)) throw err; // unexpected: fail the whole request
      results.push({
        index,
        status: err.getStatus(),
        error: toProblemBody(err.code, {
          base: options.typeBase,
          detail: err.detail,
          errors: err.errors,
          requestId: options.requestId,
        }),
      });
    }
  }
  const failed = results.filter((r) => r.error).length;
  return {
    results,
    summary: { total: results.length, succeeded: results.length - failed, failed },
  };
}
