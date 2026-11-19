import createClient, { type Client, type Middleware } from 'openapi-fetch';
import { ApiError } from './errors.js';
import { ETagStore } from './etag-store.js';
import type { paths } from './generated/schema.js';

/**
 * Typed REST client generated from docs/engineering/openapi.yaml (`pnpm --filter
 * @assettracker/api-client generate`). Paths, parameters, request bodies and responses are all
 * checked against the contract at compile time.
 *
 * Cross-cutting behaviour lives in one middleware so screens never repeat it:
 *  - `X-CSRF-Token` on every cookie-authenticated mutation (token supplied by `getCsrfToken`);
 *  - a fresh `Idempotency-Key` on every POST / PATCH / PUT / DELETE outside `/v1/auth/`;
 *  - `If-Match` from the ETag remembered for the exact resource path (GET / PATCH / PUT / DELETE only),
 *    unless the caller passed one. A POST path (a create or an action such as checkout, move, dispose)
 *    never records or replays an ETag: it is not a resource with a version of its own;
 *  - every ETag is remembered per path; a `204` forgets it;
 *  - any non-2xx answer throws `ApiError` carrying the parsed problem+json body and request id.
 */
export type TypedClient = Client<paths>;

export interface TypedClientOptions {
  /** Empty or omitted means same-origin (the production default). */
  baseUrl?: string;
  fetch?: typeof fetch;
  etags?: ETagStore;
  getCsrfToken?: () => string | undefined;
  /** Called for every response after it was recorded, before an `ApiError` is thrown. */
  onResponse?: (info: { pathname: string; response: Response; problemCode?: string }) => void;
  newIdempotencyKey?: () => string;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

function defaultIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createTypedClient(options: TypedClientOptions = {}): TypedClient {
  const etags = options.etags ?? new ETagStore();
  const newKey = options.newIdempotencyKey ?? defaultIdempotencyKey;
  const baseFetch = options.fetch ?? ((request: RequestInfo | URL) => globalThis.fetch(request));
  // `Request` needs an absolute URL, so "same-origin" means this page's origin in a browser.
  const baseUrl = (
    options.baseUrl || (typeof globalThis.location === 'object' ? globalThis.location.origin : '')
  ).replace(/\/$/, '');

  const middleware: Middleware = {
    onRequest({ request }) {
      request.headers.set('accept', 'application/json, application/problem+json');
      if (SAFE_METHODS.has(request.method)) return request;
      const csrf = options.getCsrfToken?.();
      if (csrf && !request.headers.has('x-csrf-token')) request.headers.set('x-csrf-token', csrf);
      // Auth endpoints (secrets in the response, throttled sign-in) take no Idempotency-Key.
      const path = new URL(request.url).pathname;
      if (!path.startsWith('/v1/auth/') && !request.headers.has('idempotency-key')) {
        request.headers.set('idempotency-key', newKey());
      }
      // A POST path is a collection (create) or an action on a resource (checkout, move, ...): neither
      // is a resource with a version of its own, so there is nothing to replay. Any If-Match an action
      // needs (the asset's version the user saw) is passed explicitly by the caller.
      const etag = request.method === 'POST' ? undefined : etags.etagFor(path);
      if (etag && !request.headers.has('if-match')) request.headers.set('if-match', etag);
      return request;
    },

    async onResponse({ request, response }) {
      const pathname = new URL(request.url).pathname;
      // The ETag of a POST answer belongs to the resource it created or acted on, never to the POST
      // path itself: `/v1/assets/{id}/checkout` answers with the asset's new version, and replaying
      // it on the next checkout would be a stale precondition.
      etags.record(pathname, response, request.method !== 'POST');
      // A create answers with the new resource's ETag; remember it under the resource path (the
      // Location is a child of the collection that was posted to). An action's Location points at a
      // different resource than the ETag describes (check-out: asset ETag, assignment Location).
      const location = response.headers.get('location');
      if (location && response.ok) {
        const created = new URL(location, request.url).pathname;
        if (request.method !== 'POST' || created.startsWith(`${pathname}/`)) {
          etags.record(created, response);
        }
      }

      if (response.ok) {
        if (!SAFE_METHODS.has(request.method) && response.status === 204) etags.forget(pathname);
        options.onResponse?.({ pathname, response });
        const type = response.headers.get('content-type') ?? '';
        if (response.status !== 204 && !type.includes('json')) {
          const text = await response.clone().text();
          // A 200 that is not JSON means a proxy or the SPA fallback answered instead of the API.
          if (text) {
            throw new ApiError(`${request.method} ${pathname} returned a non-JSON body`, 502);
          }
        }
        return response;
      }

      const requestId = response.headers.get('x-request-id') ?? undefined;
      let parsed: unknown;
      try {
        const text = await response.clone().text();
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }
      const problem =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      const body = { ...problem, request_id: problem.request_id ?? requestId };
      options.onResponse?.({
        pathname,
        response,
        problemCode: typeof problem.code === 'string' ? problem.code : undefined,
      });
      throw new ApiError(
        `${request.method} ${pathname} failed with ${response.status}`,
        response.status,
        body,
        parseRetryAfter(response.headers.get('retry-after')),
      );
    },
  };

  const client = createClient<paths>({
    baseUrl,
    fetch: (request) => baseFetch(request),
    // The contract sends arrays comma-separated (`status_id=a,b`) and custom fields as `cf[key]=v`.
    querySerializer: {
      array: { style: 'form', explode: false },
      object: { style: 'deepObject', explode: true },
    },
  });
  client.use(middleware);
  return client;
}
