import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { TenancyService } from '../tenancy/index.js';
import { canonicalJson, IdempotencyInterceptor, requestHash } from './idempotency.js';
import type { ApiProblem } from './problem.js';

const TENANT = '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e5f';
const PRINCIPAL = '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e61';
const KEY = 'a-perfectly-fine-key-1';

describe('canonicalJson / requestHash', () => {
  it('ignores key order and undefined members, keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: [2, 1] }, u: undefined })).toBe(
      canonicalJson({ a: { c: [2, 1], d: 1 }, b: 1 }),
    );
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('hashes body and query; a different value changes the hash', () => {
    const base = requestHash({ body: { a: 1 }, query: {} });
    expect(requestHash({ body: { a: 1 } })).toBe(base);
    expect(requestHash({ body: { a: 2 } })).not.toBe(base);
    expect(requestHash({ body: { a: 1 }, query: { x: '1' } })).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---- the interceptor, against fakes ---------------------------------------------------------

interface StoredRow {
  method: string;
  path: string;
  request_hash: string;
  state: string;
  response_status: number | null;
  response_headers: Record<string, string> | null;
  response_body: unknown;
}

function harness(opts: {
  method?: string;
  headers?: Record<string, string>;
  principal?: { tenantId: string; principalId: string } | null;
  required?: boolean;
  existing?: StoredRow;
  body?: unknown;
  createManyError?: unknown;
}) {
  const updates: Array<{ data: Record<string, unknown> }> = [];
  const trx = {
    $queryRaw: async () => [{ previous: '0' }],
    $executeRaw: async () => 0,
    idempotency_key: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => {
        if (opts.createManyError) throw opts.createManyError;
        return { count: opts.existing ? 0 : 1 };
      },
      findUniqueOrThrow: async () => opts.existing,
      update: async (args: { data: Record<string, unknown> }) => void updates.push(args),
    },
  };
  const tenancy = { withTenantTx: async (_ctx: unknown, fn: (t: unknown) => unknown) => fn(trx) };
  const reply = {
    statusCode: 201,
    headers: { etag: 'W/"1"' } as Record<string, string>,
    getHeader(name: string) {
      return this.headers[name];
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    header(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  const request = {
    method: opts.method ?? 'POST',
    url: '/v1/assets?x=1',
    id: 'req-1',
    headers: opts.headers ?? {},
    body: opts.body ?? { a: 1 },
    query: { x: '1' },
    principal:
      opts.principal === null
        ? undefined
        : (opts.principal ?? { tenantId: TENANT, principalId: PRINCIPAL }),
  };
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    getHandler: () => 'h',
    getClass: () => 'c',
  } as unknown as ExecutionContext;
  const reflector = { getAllAndOverride: () => opts.required } as unknown as Reflector;
  const interceptor = new IdempotencyInterceptor(tenancy as unknown as TenancyService, reflector, {
    lockTimeoutMs: 500,
  });
  const handler = vi.fn(() => of({ created: true }));
  const next = { handle: handler } as unknown as CallHandler;
  return { interceptor, context, next, handler, reply, updates, request };
}

const problemOf = async (fn: () => unknown): Promise<ApiProblem> => {
  try {
    await fn();
  } catch (err) {
    return err as ApiProblem;
  }
  throw new Error('expected a problem');
};

describe('IdempotencyInterceptor (decisions before the database)', () => {
  it('passes safe methods straight through, even with a key', async () => {
    const h = harness({ method: 'GET', headers: { 'idempotency-key': KEY } });
    await lastValueFrom(h.interceptor.intercept(h.context, h.next));
    expect(h.handler).toHaveBeenCalledOnce();
    expect(h.updates).toEqual([]);
  });

  it('passes through when no key was sent, unless the route requires one (400)', async () => {
    const plain = harness({});
    await lastValueFrom(plain.interceptor.intercept(plain.context, plain.next));
    expect(plain.handler).toHaveBeenCalledOnce();

    const required = harness({ required: true });
    const err = await problemOf(() =>
      required.interceptor.intercept(required.context, required.next),
    );
    expect(err.getStatus()).toBe(400);
    expect(err.code).toBe('idempotency-key-required');
    expect(required.handler).not.toHaveBeenCalled();
  });

  it.each(['short', 'has spaces in it', 'tab\tkey-1234', 'k'.repeat(256), 'ünïcödé-key-123'])(
    'rejects a malformed key %j with 400 idempotency-key-invalid',
    async (key) => {
      const h = harness({ headers: { 'idempotency-key': key } });
      const err = await problemOf(() => h.interceptor.intercept(h.context, h.next));
      expect(err.code).toBe('idempotency-key-invalid');
      expect(err.getStatus()).toBe(400);
    },
  );

  it('accepts 8 and 255 character keys', async () => {
    for (const key of ['abcdefgh', 'k'.repeat(255)]) {
      const h = harness({ headers: { 'idempotency-key': key } });
      await lastValueFrom(h.interceptor.intercept(h.context, h.next));
      expect(h.handler).toHaveBeenCalledOnce();
    }
  });

  it('ignores the header on unauthenticated requests (nothing to scope the key to)', async () => {
    const h = harness({ headers: { 'idempotency-key': KEY }, principal: null });
    await lastValueFrom(h.interceptor.intercept(h.context, h.next));
    expect(h.handler).toHaveBeenCalledOnce();
    expect(h.updates).toEqual([]);
  });
});

describe('IdempotencyInterceptor (claim outcomes)', () => {
  const hash = requestHash({ body: { a: 1 }, query: { x: '1' } });
  const stored = (over: Partial<StoredRow> = {}): StoredRow => ({
    method: 'POST',
    path: '/v1/assets',
    request_hash: hash,
    state: 'completed',
    response_status: 201,
    response_headers: { etag: 'W/"1"', location: '/v1/assets/1' },
    response_body: { id: '1' },
    ...over,
  });

  it('a new key runs the handler once and stores the response in the claimed row', async () => {
    const h = harness({ headers: { 'idempotency-key': KEY } });
    const result = await lastValueFrom(h.interceptor.intercept(h.context, h.next) as never);
    expect(result).toEqual({ created: true });
    expect(h.handler).toHaveBeenCalledOnce();
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]!.data).toMatchObject({
      state: 'completed',
      response_status: 201,
      response_headers: { etag: 'W/"1"' },
      response_body: { created: true },
    });
    expect(h.reply.headers['idempotent-replayed']).toBeUndefined();
  });

  it('an existing completed key with the same request replays status, headers and body without the handler', async () => {
    const h = harness({ headers: { 'idempotency-key': KEY }, existing: stored() });
    const result = await lastValueFrom(h.interceptor.intercept(h.context, h.next) as never);
    expect(result).toEqual({ id: '1' });
    expect(h.handler).not.toHaveBeenCalled();
    expect(h.reply.statusCode).toBe(201);
    expect(h.reply.headers).toMatchObject({
      etag: 'W/"1"',
      location: '/v1/assets/1',
      'idempotent-replayed': 'true',
    });
  });

  it.each([
    ['body', { request_hash: 'f'.repeat(64) }],
    ['path', { path: '/v1/other' }],
    ['method', { method: 'PATCH' }],
  ])(
    'same key, different %s: 422 idempotency-key-reuse and the handler never runs',
    async (_what, over) => {
      const h = harness({ headers: { 'idempotency-key': KEY }, existing: stored(over) });
      const err = await problemOf(() =>
        lastValueFrom(h.interceptor.intercept(h.context, h.next) as never),
      );
      expect(err.code).toBe('idempotency-key-reuse');
      expect(err.getStatus()).toBe(422);
      expect(h.handler).not.toHaveBeenCalled();
    },
  );

  it('a stored row that never completed is reported as in flight (409, Retry-After)', async () => {
    const h = harness({
      headers: { 'idempotency-key': KEY },
      existing: stored({ state: 'in_flight', response_status: null }),
    });
    const err = await problemOf(() =>
      lastValueFrom(h.interceptor.intercept(h.context, h.next) as never),
    );
    expect(err.code).toBe('idempotency-key-in-flight');
    expect(err.getStatus()).toBe(409);
    expect(err.extraHeaders['Retry-After']).toBe('1');
  });

  it('a lock timeout while waiting for the first request is 409 in-flight (SQLSTATE 55P03)', async () => {
    const h = harness({
      headers: { 'idempotency-key': KEY },
      createManyError: Object.assign(new Error('canceling statement due to lock timeout'), {
        code: '55P03',
      }),
    });
    const err = await problemOf(() =>
      lastValueFrom(h.interceptor.intercept(h.context, h.next) as never),
    );
    expect(err.code).toBe('idempotency-key-in-flight');
    expect(h.handler).not.toHaveBeenCalled();
  });

  it('other database errors are not disguised', async () => {
    const boom = new Error('connection reset');
    const h = harness({ headers: { 'idempotency-key': KEY }, createManyError: boom });
    await expect(lastValueFrom(h.interceptor.intercept(h.context, h.next) as never)).rejects.toBe(
      boom,
    );
  });
});
