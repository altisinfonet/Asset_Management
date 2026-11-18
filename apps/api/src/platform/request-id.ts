import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Printable, log-safe, bounded: anything else is replaced, never echoed (log/header injection). */
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * The id of a request: the caller's `X-Request-Id` when it is safe to echo (1-128 chars of
 * `A-Za-z0-9._:-`, e.g. an ALB/CloudFront trace id or a client UUID), otherwise a fresh UUID.
 * The id is returned in `X-Request-Id`, in every problem document, in the logs and in
 * `app.request_id` inside tenant transactions.
 */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  return candidate !== undefined && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}
