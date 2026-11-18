import { ApiError, getVersion } from '@assettracker/api-client';
import { describe, expect, it } from 'vitest';
import { createWebApi, ETagStore, ifMatch, toUiError } from './api';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

describe('toUiError', () => {
  it('maps statuses to kinds and catalogue keys', () => {
    expect(toUiError(new ApiError('x', 401)).kind).toBe('unauthorized');
    expect(toUiError(new ApiError('x', 403)).messageKey).toBe('error.forbidden');
    expect(toUiError(new ApiError('x', 412)).kind).toBe('stale');
    expect(toUiError(new ApiError('x', 428)).kind).toBe('precondition_required');
    expect(toUiError(new ApiError('x', 429)).kind).toBe('rate_limited');
    expect(toUiError(new ApiError('x', 503)).kind).toBe('server');
    expect(toUiError(new ApiError('x', 418)).kind).toBe('unknown');
  });

  it('reads problem+json code, request id and field errors', () => {
    const err = new ApiError('x', 422, {
      code: 'validation_failed',
      request_id: 'req-1',
      errors: [{ pointer: '/name', message: 'required' }],
    });
    expect(toUiError(err)).toMatchObject({
      kind: 'validation',
      code: 'validation_failed',
      requestId: 'req-1',
      fieldErrors: [{ pointer: '/name', message: 'required' }],
    });
  });

  it('falls back to the header request id, and treats fetch TypeErrors as network errors', () => {
    expect(toUiError(new ApiError('x', 500, {}), 'hdr-9').requestId).toBe('hdr-9');
    expect(toUiError(new TypeError('Failed to fetch')).kind).toBe('network');
    expect(toUiError('boom').kind).toBe('unknown');
  });
});

describe('createWebApi', () => {
  it('calls same-origin /v1 paths and remembers ETags', async () => {
    const seen: string[] = [];
    const fake = (async (input: RequestInfo | URL) => {
      seen.push(new URL((input as Request).url).pathname);
      return jsonResponse(
        { name: 'api', version: '1', commit: 'abc', role: 'api' },
        { headers: { etag: 'W/"3"' } },
      );
    }) as typeof fetch;
    const api = createWebApi(fake);
    await getVersion(api.http);
    expect(seen).toEqual(['/v1/version']);
    expect(api.etags.etagFor('/v1/version')).toBe('W/"3"');
    expect(ifMatch(api.etags.etagFor('/v1/version'))).toEqual({ 'If-Match': 'W/"3"' });
    expect(ifMatch(undefined)).toEqual({});
  });

  it('turns a failed call into a UiError carrying the response request id', async () => {
    const fake = (async () =>
      jsonResponse(
        { title: 'nope' },
        { status: 500, headers: { 'x-request-id': 'req-7' } },
      )) as typeof fetch;
    const api = createWebApi(fake);
    const err = await getVersion(api.http).catch((e: unknown) => api.toUiError(e));
    expect(err).toMatchObject({ kind: 'server', requestId: 'req-7' });
  });
});

describe('ETagStore', () => {
  it('forgets entries', () => {
    const store = new ETagStore();
    store.record('/v1/assets/1', new Response('{}', { headers: { etag: 'W/"1"' } }));
    expect(store.etagFor('/v1/assets/1')).toBe('W/"1"');
    store.forget('/v1/assets/1');
    expect(store.etagFor('/v1/assets/1')).toBeUndefined();
  });
});
