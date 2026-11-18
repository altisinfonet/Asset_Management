/**
 * Error thrown for every non-2xx answer of the typed client. `body` is the parsed
 * `application/problem+json` document (RFC 9457) when the server sent one; `request_id` is
 * filled from the `X-Request-Id` header when the body has none.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
    /** From the `Retry-After` header of a 429 response (whole seconds). */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Stable machine code from the problem body (`invalid-credentials`, `validation`, ...). */
  get code(): string | undefined {
    const body = this.body as { code?: unknown } | undefined;
    return typeof body?.code === 'string' ? body.code : undefined;
  }
}
