import { describe, expect, it, vi } from 'vitest';
import { ApiError, createTypedClient, ETagStore } from './index.js';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

function setup(respond: (request: Request) => Response | Promise<Response>) {
  const seen: Request[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const request = input as Request;
    seen.push(request.clone());
    return respond(request);
  }) as unknown as typeof fetch;
  const etags = new ETagStore();
  const client = createTypedClient({
    baseUrl: 'http://api.test',
    fetch: fetchImpl,
    etags,
    getCsrfToken: () => 'csrf-1',
    newIdempotencyKey: () => 'idem-key-0001',
  });
  return { client, etags, seen };
}

describe('typed client', () => {
  it('serialises arrays comma-separated and custom fields as cf[key]', async () => {
    const { client, seen } = setup(() =>
      json({ data: [], page: { next_cursor: null, has_more: false } }),
    );
    await client.GET('/v1/assets', {
      params: {
        query: {
          status_id: ['a', 'b'],
          limit: 10,
          cf: { screen_size: '11.6' },
          sort: ['-created_at'],
        },
      },
    });
    const url = new URL(seen[0]!.url);
    expect(url.searchParams.get('status_id')).toBe('a,b');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('cf[screen_size]')).toBe('11.6');
    expect(url.searchParams.get('sort')).toBe('-created_at');
  });

  it('remembers the ETag of a read and sends it as If-Match on the write, with CSRF and an idempotency key', async () => {
    const { client, etags, seen } = setup((request) =>
      request.method === 'GET'
        ? json({ id: 'a1' }, { headers: { etag: 'W/"3"' } })
        : json({ id: 'a1' }, { headers: { etag: 'W/"4"' } }),
    );
    await client.GET('/v1/assets/{id}', { params: { path: { id: 'a1' } } });
    expect(etags.etagFor('/v1/assets/a1')).toBe('W/"3"');

    await client.PATCH('/v1/assets/{id}', {
      params: { path: { id: 'a1' }, header: { 'If-Match': 'W/"3"' } },
      body: { name: 'New name' },
    });
    const write = seen[1]!;
    expect(write.headers.get('if-match')).toBe('W/"3"');
    expect(write.headers.get('x-csrf-token')).toBe('csrf-1');
    expect(write.headers.get('idempotency-key')).toBe('idem-key-0001');
    expect(etags.etagFor('/v1/assets/a1')).toBe('W/"4"');
    // reads carry none of the write headers
    expect(seen[0]!.headers.get('x-csrf-token')).toBeNull();
    expect(seen[0]!.headers.get('idempotency-key')).toBeNull();
  });

  it('fills If-Match from memory when the caller did not pass one', async () => {
    const { client, seen } = setup((request) =>
      request.method === 'GET'
        ? json({ id: 'a1' }, { headers: { etag: 'W/"7"' } })
        : new Response(null, { status: 204 }),
    );
    await client.GET('/v1/assets/{id}', { params: { path: { id: 'a1' } } });
    // The contract types `If-Match` as required, so a caller states it; the middleware only
    // fills in an absent header (e.g. restore after the list screen read the asset).
    await client.DELETE('/v1/assets/{id}', {
      params: { path: { id: 'a1' }, header: {} as { 'If-Match': string } },
    });
    expect(seen[1]!.headers.get('if-match')).toBe('W/"7"');
  });

  it('throws ApiError with the problem body, request id and Retry-After', async () => {
    const { client } = setup(() =>
      json(
        { type: 'x', title: 'Too many', status: 429, code: 'too-many-requests' },
        { status: 429, headers: { 'x-request-id': 'req-9', 'retry-after': '12' } },
      ),
    );
    const err = (await client.GET('/v1/assets', {}).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.code).toBe('too-many-requests');
    expect(err.retryAfterSeconds).toBe(12);
    expect((err.body as { request_id?: string }).request_id).toBe('req-9');
  });

  it('reads a non-JSON 200 (SPA fallback instead of the API) as a 502', async () => {
    const { client } = setup(
      () =>
        new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const err = (await client.GET('/v1/assets', {}).catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(502);
  });

  it('forgets the ETag after a 204', async () => {
    const { client, etags } = setup((request) =>
      request.method === 'GET'
        ? json({ id: 'a1' }, { headers: { etag: 'W/"1"' } })
        : new Response(null, { status: 204 }),
    );
    await client.GET('/v1/assets/{id}', { params: { path: { id: 'a1' } } });
    await client.DELETE('/v1/assets/{id}', {
      params: { path: { id: 'a1' }, header: { 'If-Match': 'W/"1"' } },
    });
    expect(etags.etagFor('/v1/assets/a1')).toBeUndefined();
  });
});
