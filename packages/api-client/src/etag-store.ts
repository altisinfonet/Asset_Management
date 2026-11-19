/** Per-resource ETag memory (`GET` / create / update responses), keyed by request pathname. */
export class ETagStore {
  private readonly etags = new Map<string, string>();
  private lastFailedRequestId: string | undefined;

  /** `remember: false` only tracks the failed request id (an action path has no ETag of its own). */
  record(path: string, response: Response, remember = true): void {
    const etag = response.headers.get('etag');
    if (etag && remember) this.etags.set(path, etag);
    if (!response.ok) this.lastFailedRequestId = response.headers.get('x-request-id') ?? undefined;
  }

  /** ETag to send as `If-Match` when writing `path`; undefined when it was never read. */
  etagFor(path: string): string | undefined {
    return this.etags.get(path);
  }

  forget(path: string): void {
    this.etags.delete(path);
  }

  /** Request id of the most recent failed call (fallback when the body has none). */
  get failedRequestId(): string | undefined {
    return this.lastFailedRequestId;
  }
}

/** Headers for a conditional write. */
export function ifMatch(etag: string | undefined): Record<string, string> {
  return etag ? { 'If-Match': etag } : {};
}
