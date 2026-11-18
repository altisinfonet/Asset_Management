import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { uuidv7 } from '../src/ids/uuidv7.js';
import { counters, DemoModule } from './support/demo-module.js';
import {
  createFixtureTenant,
  dbEnabled,
  env,
  type FixtureTenant,
  mode,
  newTenancy,
  withClient,
} from './support/db.js';

/**
 * API conventions (M1-PLAT-02) end to end: real Nest + Fastify app, real PostgreSQL (direct or
 * through PgBouncer, like the isolation suite), fixture routes over the `asset` table
 * (test/support/demo-module.ts). Covers problem+json, request id propagation, the zod pipe, cursor
 * pagination, ETag/If-Match and Idempotency-Key including concurrent duplicates.
 */
describe.skipIf(!dbEnabled)(`API conventions (${mode})`, () => {
  const tenancy = newTenancy();
  let app: NestFastifyApplication;
  let A: FixtureTenant;
  let B: FixtureTenant;
  const principalA = uuidv7();
  const principalA2 = uuidv7();
  const principalB = uuidv7();

  beforeAll(async () => {
    A = await createFixtureTenant(tenancy, 'ConvA');
    B = await createFixtureTenant(tenancy, 'ConvB');
    app = await createApiApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: env.databaseUrl!,
        LOG_LEVEL: 'silent',
        GIT_SHA: 'e2e',
        // A duplicate request waits this long for the first before answering 409.
        IDEMPOTENCY_LOCK_TIMEOUT_MS: '500',
      }),
      [DemoModule],
      // These fixtures fake authentication with their own guard (see support/demo-module.ts).
      { auth: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
  });

  beforeEach(() => {
    counters.executions = 0;
  });

  const as = (tenant: FixtureTenant, principal: string, extra: Record<string, string> = {}) => ({
    'x-test-tenant': tenant.id,
    'x-test-principal': principal,
    ...extra,
  });
  const post = (url: string, payload: unknown, headers: Record<string, string>) =>
    app.inject({ method: 'POST', url, payload: payload as object, headers });
  const tag = (prefix: string) => `${prefix}-${uuidv7().slice(-8)}`;
  const problemOf = (res: { json: () => unknown }) =>
    res.json() as {
      type: string;
      title: string;
      status: number;
      code: string;
      detail?: string;
      request_id?: string;
      errors?: Array<{ pointer: string; message: string; code?: string }>;
    };

  // ------------------------------------------------------------------ problem+json, request id

  describe('errors are RFC 9457 problem+json with a request id', () => {
    it('unknown route: 404 problem, request id in header and body', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/nope',
        headers: { 'x-request-id': 'trace-abc123' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(res.headers['x-request-id']).toBe('trace-abc123');
      expect(problemOf(res)).toMatchObject({
        type: 'https://api.assettracker.test/problems/not-found',
        title: 'Not found',
        status: 404,
        code: 'not-found',
        request_id: 'trace-abc123',
      });
    });

    it('malformed JSON body is a 400 problem, not a stack trace', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/demo/assets',
        headers: { ...as(A, principalA), 'content-type': 'application/json' },
        payload: '{"asset_tag": ',
      });
      expect(res.statusCode).toBe(400);
      expect(problemOf(res)).toMatchObject({ code: 'bad-request', status: 400 });
      expect(res.headers['content-type']).toMatch(/problem\+json/);
    });

    it('unsupported content type is a 415 problem', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/demo/assets',
        headers: { ...as(A, principalA), 'content-type': 'application/xml' },
        payload: '<a/>',
      });
      expect(res.statusCode).toBe(415);
      expect(problemOf(res).code).toBe('unsupported-media-type');
    });

    it('an unexpected exception is a 500 problem that leaks nothing', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/demo/boom' });
      expect(res.statusCode).toBe(500);
      const body = problemOf(res);
      expect(body).toMatchObject({ code: 'internal', status: 500 });
      expect(body.request_id).toBe(res.headers['x-request-id']);
      expect(res.body).not.toMatch(/hunter2|secret internal|stack|at .*\(/);
    });

    it('401 without a credential carries WWW-Authenticate', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/demo/assets' });
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(problemOf(res).code).toBe('unauthorized');
    });

    it('a unique-constraint violation nobody translated is a 409 problem, not a 500', async () => {
      const t = tag('DUP');
      expect((await post('/v1/demo/assets', { asset_tag: t }, as(A, principalA))).statusCode).toBe(
        201,
      );
      const again = await post('/v1/demo/assets', { asset_tag: t }, as(A, principalA));
      expect(again.statusCode).toBe(409);
      expect(problemOf(again).code).toBe('conflict');
    });
  });

  describe('request id propagation', () => {
    it('reuses a safe X-Request-Id, mints a UUID otherwise, and never echoes an unsafe value', async () => {
      const safe = await app.inject({
        method: 'GET',
        url: '/v1/version',
        headers: { 'x-request-id': 'req-12345.A:b' },
      });
      expect(safe.headers['x-request-id']).toBe('req-12345.A:b');

      const minted = await app.inject({ method: 'GET', url: '/v1/version' });
      expect(minted.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

      const unsafe = await app.inject({
        method: 'GET',
        url: '/v1/version',
        headers: { 'x-request-id': 'bad id with spaces <script>' },
      });
      expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(unsafe.headers['x-request-id']).not.toContain('script');
    });

    it('reaches the database: app.request_id inside the tenant transaction is the request id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/demo/request-id',
        headers: as(A, principalA, { 'x-request-id': 'trace-to-db-1' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ request_id: 'trace-to-db-1', actor_id: principalA });
    });

    it('concurrent requests keep their own ids', async () => {
      const ids = Array.from({ length: 20 }, (_, i) => `concurrent-${i}-${uuidv7().slice(-6)}`);
      const results = await Promise.all(
        ids.map((id) =>
          app.inject({
            method: 'GET',
            url: '/v1/demo/request-id',
            headers: as(A, principalA, { 'x-request-id': id }),
          }),
        ),
      );
      expect(results.map((r) => (r.json() as { request_id: string }).request_id)).toEqual(ids);
    });
  });

  // ------------------------------------------------------------------ zod validation pipe

  describe('zod validation pipe', () => {
    it('body failures are 422 validation with JSON-pointer errors[]', async () => {
      const res = await post(
        '/v1/demo/assets',
        { asset_tag: 'has space', name: 5, extra: true },
        as(A, principalA),
      );
      expect(res.statusCode).toBe(422);
      const body = problemOf(res);
      expect(body).toMatchObject({ code: 'validation', status: 422 });
      const pointers = body.errors!.map((e) => e.pointer).sort();
      expect(pointers).toEqual(['/', '/asset_tag', '/name'].sort());
      expect(body.errors!.find((e) => e.pointer === '/asset_tag')).toMatchObject({
        message: 'must not contain whitespace',
        code: 'pattern',
      });
    });

    it('a missing body is a 422, not a crash', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/demo/assets',
        headers: as(A, principalA),
      });
      expect(res.statusCode).toBe(422);
      expect(problemOf(res).code).toBe('validation');
    });

    it('query failures are 400 bad-request with query:<name> pointers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/demo/assets?limit=500',
        headers: as(A, principalA),
      });
      expect(res.statusCode).toBe(400);
      expect(problemOf(res)).toMatchObject({
        code: 'bad-request',
        errors: [expect.objectContaining({ pointer: 'query:limit' })],
      });
      expect(problemOf(res).detail).toMatch(/limit/);
    });

    it('valid input is coerced and passed through', async () => {
      const res = await post(
        '/v1/demo/assets',
        { asset_tag: tag('OK'), name: 'Valid' },
        as(A, principalA),
      );
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name: 'Valid', version: 1 });
    });
  });

  // ------------------------------------------------------------------ cursor pagination

  describe('cursor pagination', () => {
    let tenant: FixtureTenant;
    beforeAll(async () => {
      tenant = await createFixtureTenant(tenancy, 'ConvPage'); // 5 assets ISO-001..005
      for (let i = 6; i <= 23; i++) {
        const res = await post(
          '/v1/demo/assets',
          { asset_tag: `ISO-${String(i).padStart(3, '0')}`, name: `n${i}` },
          as(tenant, principalA),
        );
        expect(res.statusCode).toBe(201);
      }
    });

    const page = async (qs: string) => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/demo/assets?${qs}`,
        headers: as(tenant, principalA),
      });
      return {
        res,
        body: res.json() as {
          data: Array<{ id: string; asset_tag: string }>;
          page: { next_cursor: string | null; has_more: boolean; total?: number };
        },
      };
    };

    it('walks every row exactly once in order, ascending and descending', async () => {
      for (const sort of ['asset_tag', '-asset_tag', '-created_at,asset_tag']) {
        const seen: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const { res, body } = await page(
            `limit=5&sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`,
          );
          expect(res.statusCode).toBe(200);
          expect(body.data.length).toBeLessThanOrEqual(5);
          seen.push(...body.data.map((r) => r.asset_tag));
          cursor = body.page.next_cursor;
          expect(body.page.has_more).toBe(cursor !== null);
          pages++;
        } while (cursor);
        expect(pages).toBe(5); // 23 rows / 5
        expect(new Set(seen).size).toBe(23);
        const expected = [...seen].sort();
        if (sort === 'asset_tag') expect(seen).toEqual(expected);
        if (sort === '-asset_tag') expect(seen).toEqual([...expected].reverse());
      }
    });

    it('include_total=true adds the count; the default omits it', async () => {
      expect((await page('limit=5')).body.page).not.toHaveProperty('total');
      expect((await page('limit=5&include_total=true')).body.page.total).toBe(23);
    });

    it('the last page has next_cursor null and has_more false', async () => {
      const { body } = await page('limit=200');
      expect(body.data).toHaveLength(23);
      expect(body.page).toEqual({ next_cursor: null, has_more: false });
    });

    it('a cursor is bound to its sort and filters: reuse elsewhere is 400 invalid-cursor', async () => {
      const first = (await page('limit=5&sort=asset_tag')).body.page.next_cursor!;
      const otherSort = await page(`limit=5&sort=-asset_tag&cursor=${first}`);
      expect(otherSort.res.statusCode).toBe(400);
      expect(problemOf(otherSort.res).code).toBe('invalid-cursor');
      const otherFilter = await page(`limit=5&sort=asset_tag&q=ISO-00&cursor=${first}`);
      expect(otherFilter.res.statusCode).toBe(400);
      expect(problemOf(otherFilter.res).code).toBe('invalid-cursor');
    });

    it('garbage and tampered cursors are 400, never a 500', async () => {
      for (const cursor of [
        'not-a-cursor',
        Buffer.from('{"v":2}').toString('base64url'),
        Buffer.from('[]').toString('base64url'),
      ]) {
        const { res } = await page(`limit=5&cursor=${cursor}`);
        expect(res.statusCode, cursor).toBe(400);
        expect(problemOf(res).code).toBe('invalid-cursor');
      }
    });

    it('an unknown sort key is a 400 listing the allowed keys', async () => {
      const { res } = await page('sort=password');
      expect(res.statusCode).toBe(400);
      expect(problemOf(res).detail).toMatch(/asset_tag/);
    });

    it('filters apply to every page and to the total', async () => {
      const { body } = await page('limit=3&q=ISO-01&include_total=true&sort=asset_tag');
      expect(body.page.total).toBe(10); // ISO-010..ISO-019
      expect(body.data.every((r) => r.asset_tag.startsWith('ISO-01'))).toBe(true);
    });

    it('a tenant only pages through its own rows', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/demo/assets?limit=200',
        headers: as(A, principalA),
      });
      const rows = (res.json() as { data: Array<{ id: string }> }).data;
      expect(rows.some((r) => A.assetIds.includes(r.id))).toBe(true);
      expect(rows.some((r) => tenant.assetIds.includes(r.id))).toBe(false);
    });
  });

  // ------------------------------------------------------------------ ETag / If-Match

  describe('ETag and If-Match on assets', () => {
    const create = async () => {
      const res = await post(
        '/v1/demo/assets',
        { asset_tag: tag('ET'), name: 'first' },
        as(A, principalA),
      );
      return { id: (res.json() as { id: string }).id, etag: res.headers.etag as string };
    };
    const patch = (id: string, ifMatch: string | undefined, name: string) =>
      app.inject({
        method: 'PATCH',
        url: `/v1/demo/assets/${id}`,
        headers: { ...as(A, principalA), ...(ifMatch ? { 'if-match': ifMatch } : {}) },
        payload: { name },
      });

    it('create and GET carry W/"<version>"', async () => {
      const { id, etag } = await create();
      expect(etag).toBe('W/"1"');
      const got = await app.inject({
        method: 'GET',
        url: `/v1/demo/assets/${id}`,
        headers: as(A, principalA),
      });
      expect(got.headers.etag).toBe('W/"1"');
    });

    it('PATCH without If-Match is 428 precondition-required', async () => {
      const { id } = await create();
      const res = await patch(id, undefined, 'x');
      expect(res.statusCode).toBe(428);
      expect(problemOf(res).code).toBe('precondition-required');
    });

    it('PATCH with the current ETag succeeds and returns the next ETag', async () => {
      const { id, etag } = await create();
      const res = await patch(id, etag, 'second');
      expect(res.statusCode).toBe(200);
      expect(res.headers.etag).toBe('W/"2"');
      expect(res.json()).toMatchObject({ name: 'second', version: 2 });
    });

    it('PATCH with a stale ETag is 412 precondition-failed and changes nothing', async () => {
      const { id, etag } = await create();
      expect((await patch(id, etag, 'second')).statusCode).toBe(200);
      const stale = await patch(id, etag, 'third');
      expect(stale.statusCode).toBe(412);
      expect(problemOf(stale)).toMatchObject({ code: 'precondition-failed', status: 412 });
      expect(problemOf(stale).detail).toContain('W/"2"');
      const got = await app.inject({
        method: 'GET',
        url: `/v1/demo/assets/${id}`,
        headers: as(A, principalA),
      });
      expect(got.json()).toMatchObject({ name: 'second', version: 2 });
    });

    it('a malformed If-Match is 400, and * matches any existing resource', async () => {
      const { id } = await create();
      expect((await patch(id, 'banana', 'x')).statusCode).toBe(400);
      expect((await patch(id, '*', 'star')).statusCode).toBe(200);
    });

    it('two racing updates with the same ETag: exactly one wins, the other gets 412', async () => {
      const { id, etag } = await create();
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => patch(id, etag, `racer-${i}`)),
      );
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes.filter((c) => c === 200)).toHaveLength(1);
      expect(codes.filter((c) => c === 412)).toHaveLength(5);
    });

    it('DELETE requires If-Match too', async () => {
      const { id, etag } = await create();
      const missing = await app.inject({
        method: 'DELETE',
        url: `/v1/demo/assets/${id}`,
        headers: as(A, principalA),
      });
      expect(missing.statusCode).toBe(428);
      const stale = await app.inject({
        method: 'DELETE',
        url: `/v1/demo/assets/${id}`,
        headers: as(A, principalA, { 'if-match': 'W/"99"' }),
      });
      expect(stale.statusCode).toBe(412);
      const ok = await app.inject({
        method: 'DELETE',
        url: `/v1/demo/assets/${id}`,
        headers: as(A, principalA, { 'if-match': etag }),
      });
      expect(ok.statusCode).toBe(204);
    });

    it('If-None-Match with the current ETag answers 304', async () => {
      const { id, etag } = await create();
      const res = await app.inject({
        method: 'GET',
        url: `/v1/demo/assets/${id}`,
        headers: as(A, principalA, { 'if-none-match': etag }),
      });
      expect(res.statusCode).toBe(304);
    });

    it("another tenant's asset is 404, with or without If-Match (no existence oracle)", async () => {
      const foreign = A.assetIds[0]!;
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/demo/assets/${foreign}`,
        headers: { ...as(B, principalB), 'if-match': 'W/"1"' },
        payload: { name: 'hijack' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ------------------------------------------------------------------ Idempotency-Key

  describe('Idempotency-Key', () => {
    const key = () => `key-${uuidv7()}`;
    const rowsFor = (tenant: FixtureTenant, assetTag: string) =>
      tenancy.withTenantTx({ tenantId: tenant.id }, (trx) =>
        trx.asset.count({ where: { asset_tag: assetTag } }),
      );

    it('replays the stored response (status, body, ETag, Location) without running the handler again', async () => {
      const k = key();
      const t = tag('IDEM');
      const first = await post(
        '/v1/demo/assets',
        { asset_tag: t, name: 'once' },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(first.statusCode).toBe(201);
      expect(first.headers['idempotent-replayed']).toBeUndefined();

      const second = await post(
        '/v1/demo/assets',
        { asset_tag: t, name: 'once' },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(second.statusCode).toBe(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.json()).toEqual(first.json());
      expect(second.headers.etag).toBe(first.headers.etag);
      expect(second.headers.location).toBe(first.headers.location);
      expect(counters.executions).toBe(1);
      expect(await rowsFor(A, t)).toBe(1);
    });

    it('the same key with a different body is 422 idempotency-key-reuse', async () => {
      const k = key();
      const t = tag('REUSE');
      await post('/v1/demo/assets', { asset_tag: t }, as(A, principalA, { 'idempotency-key': k }));
      const other = await post(
        '/v1/demo/assets',
        { asset_tag: tag('REUSE2') },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(other.statusCode).toBe(422);
      expect(problemOf(other)).toMatchObject({ code: 'idempotency-key-reuse', status: 422 });
      expect(counters.executions).toBe(1);
    });

    it('the same key on a different path or method is also reuse; key order in the body is irrelevant', async () => {
      const k = key();
      const t = tag('PATH');
      const a = await post(
        '/v1/demo/assets',
        { asset_tag: t, name: 'x' },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(a.statusCode).toBe(201);
      const reordered = await post(
        '/v1/demo/assets',
        { name: 'x', asset_tag: t },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(reordered.headers['idempotent-replayed']).toBe('true');
      const otherPath = await post(
        '/v1/demo/assets/checkout-like',
        { asset_tag: t, name: 'x' },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(otherPath.statusCode).toBe(422);
      expect(problemOf(otherPath).code).toBe('idempotency-key-reuse');
    });

    it('is scoped to the principal and the tenant: the same key elsewhere is a different key', async () => {
      const k = key();
      const t1 = tag('SCOPE1');
      const t2 = tag('SCOPE2');
      const t3 = tag('SCOPE3');
      const a = await post(
        '/v1/demo/assets',
        { asset_tag: t1 },
        as(A, principalA, { 'idempotency-key': k }),
      );
      const a2 = await post(
        '/v1/demo/assets',
        { asset_tag: t2 },
        as(A, principalA2, { 'idempotency-key': k }),
      );
      const b = await post(
        '/v1/demo/assets',
        { asset_tag: t3 },
        as(B, principalB, { 'idempotency-key': k }),
      );
      expect([a.statusCode, a2.statusCode, b.statusCode]).toEqual([201, 201, 201]);
      expect(counters.executions).toBe(3);
    });

    it('concurrent duplicates: the handler runs once, every caller gets the same 201, the rest are replays', async () => {
      const k = key();
      const t = tag('RACE');
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          post(
            '/v1/demo/assets',
            { asset_tag: t, name: 'race', delay_ms: 150 },
            as(A, principalA, { 'idempotency-key': k }),
          ),
        ),
      );
      expect(responses.map((r) => r.statusCode)).toEqual(Array(8).fill(201));
      expect(counters.executions).toBe(1);
      expect(responses.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(7);
      expect(new Set(responses.map((r) => (r.json() as { id: string }).id)).size).toBe(1);
      expect(await rowsFor(A, t)).toBe(1);
    });

    it('a duplicate that outlives the wait gets 409 idempotency-key-in-flight; a later retry replays', async () => {
      const k = key();
      const t = tag('SLOW');
      const slow = post(
        '/v1/demo/assets',
        { asset_tag: t, delay_ms: 1500 },
        as(A, principalA, { 'idempotency-key': k }),
      );
      await new Promise((r) => setTimeout(r, 200)); // let the first claim the key
      const early = await post(
        '/v1/demo/assets',
        { asset_tag: t, delay_ms: 1500 },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(early.statusCode).toBe(409);
      expect(problemOf(early)).toMatchObject({ code: 'idempotency-key-in-flight', status: 409 });
      expect(early.headers['retry-after']).toBe('1');

      const first = await slow;
      expect(first.statusCode).toBe(201);
      const retry = await post(
        '/v1/demo/assets',
        { asset_tag: t, delay_ms: 1500 },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(retry.statusCode).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(counters.executions).toBe(1);
    });

    it('a failed request rolls back the claim and its writes: the retry runs again', async () => {
      const k = key();
      const t = tag('FAIL');
      const first = await post(
        '/v1/demo/assets/fail-after-write',
        { asset_tag: t },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(first.statusCode).toBe(409);
      expect(await rowsFor(A, t)).toBe(0);
      const second = await post(
        '/v1/demo/assets/fail-after-write',
        { asset_tag: t },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(second.statusCode).toBe(409);
      expect(second.headers['idempotent-replayed']).toBeUndefined();
      expect(counters.executions).toBe(2);
    });

    it('rejects a malformed key (400) and, on a required route, a missing key (400)', async () => {
      const short = await post(
        '/v1/demo/assets',
        { asset_tag: tag('K') },
        as(A, principalA, { 'idempotency-key': 'short' }),
      );
      expect(short.statusCode).toBe(400);
      expect(problemOf(short).code).toBe('idempotency-key-invalid');
      const spaced = await post(
        '/v1/demo/assets',
        { asset_tag: tag('K') },
        as(A, principalA, { 'idempotency-key': 'has spaces in it' }),
      );
      expect(spaced.statusCode).toBe(400);

      const missing = await post(
        '/v1/demo/assets/checkout-like',
        { asset_tag: tag('K') },
        as(A, principalA),
      );
      expect(missing.statusCode).toBe(400);
      expect(problemOf(missing).code).toBe('idempotency-key-required');
      const ok = await post(
        '/v1/demo/assets/checkout-like',
        { asset_tag: tag('K') },
        as(A, principalA, { 'idempotency-key': key() }),
      );
      expect(ok.statusCode).toBe(201);
    });

    it('without a key a mutating request just runs (and a validation failure is not stored)', async () => {
      const t = tag('NOKEY');
      expect((await post('/v1/demo/assets', { asset_tag: t }, as(A, principalA))).statusCode).toBe(
        201,
      );
      const k = key();
      const bad = await post(
        '/v1/demo/assets',
        { asset_tag: 'bad tag' },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(bad.statusCode).toBe(422);
      const fixed = await post(
        '/v1/demo/assets',
        { asset_tag: 'bad tag' },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(fixed.statusCode).toBe(422); // same body, same failure: nothing was stored, nothing replayed
    });

    it('an expired key is replaced: the same key runs again after 24 hours', async () => {
      const k = key();
      const first = await post(
        '/v1/demo/assets',
        { asset_tag: tag('EXP1') },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(first.statusCode).toBe(201);
      // Age the record as the owner role (a tenant context is still required by FORCE RLS).
      await withClient(env.migratorUrl!, async (c) => {
        await c.query('BEGIN');
        await c.query("select set_config('app.tenant_id', $1, true)", [A.id]);
        const r = await c.query(
          "update app.idempotency_key set expires_at = now() - interval '1 minute' where key = $1",
          [k],
        );
        expect(r.rowCount).toBe(1);
        await c.query('COMMIT');
      });
      const t2 = tag('EXP2');
      const again = await post(
        '/v1/demo/assets',
        { asset_tag: t2 },
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(again.statusCode).toBe(201);
      expect(again.headers['idempotent-replayed']).toBeUndefined();
      expect(counters.executions).toBe(2);
    });

    it('stores the key row inside the tenant: only that tenant sees it', async () => {
      const k = key();
      await post(
        '/v1/demo/assets',
        { asset_tag: tag('ROW') },
        as(A, principalA, { 'idempotency-key': k }),
      );
      const count = (tenant: FixtureTenant) =>
        tenancy.withTenantTx({ tenantId: tenant.id }, (trx) =>
          trx.idempotency_key.count({ where: { key: k } }),
        );
      expect(await count(A)).toBe(1);
      expect(await count(B)).toBe(0);
    });

    it('safe methods and unauthenticated routes ignore the header', async () => {
      const get = await app.inject({
        method: 'GET',
        url: '/v1/demo/public',
        headers: { 'idempotency-key': 'whatever-key-123' },
      });
      expect(get.statusCode).toBe(200);
    });
  });

  // ------------------------------------------------------------------ bulk

  describe('bulk convention', () => {
    it('answers 200 with a result per item in order and a summary; failed items do not block the rest', async () => {
      const taken = tag('BULKTAKEN');
      await post('/v1/demo/assets', { asset_tag: taken }, as(A, principalA));
      const fresh1 = tag('BULK1');
      const fresh2 = tag('BULK2');
      const res = await post(
        '/v1/demo/assets/bulk',
        { items: [{ asset_tag: fresh1 }, { asset_tag: taken }, { asset_tag: fresh2 }] },
        as(A, principalA),
      );
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        results: Array<{ index: number; status: number; error?: { code: string } }>;
        summary: unknown;
      };
      expect(body.results.map((r) => [r.index, r.status])).toEqual([
        [0, 201],
        [1, 409],
        [2, 201],
      ]);
      expect(body.results[1]!.error!.code).toBe('conflict');
      expect(body.summary).toEqual({ total: 3, succeeded: 2, failed: 1 });
    });

    it('more than the maximum is 422; and a keyed bulk request replays as a whole', async () => {
      const tooMany = await post(
        '/v1/demo/assets/bulk',
        { items: Array.from({ length: 6 }, () => ({ asset_tag: tag('BULKMAX') })) },
        as(A, principalA),
      );
      expect(tooMany.statusCode).toBe(422);
      expect(problemOf(tooMany).errors?.[0]?.pointer).toBe('/items');

      const k = `key-${uuidv7()}`;
      const payload = { items: [{ asset_tag: tag('BULKK1') }, { asset_tag: tag('BULKK2') }] };
      const first = await post(
        '/v1/demo/assets/bulk',
        payload,
        as(A, principalA, { 'idempotency-key': k }),
      );
      const again = await post(
        '/v1/demo/assets/bulk',
        payload,
        as(A, principalA, { 'idempotency-key': k }),
      );
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.json()).toEqual(first.json());
    });
  });

  // ------------------------------------------------------------------ probes

  describe('probes (M1-PLAT-01)', () => {
    it('/healthz is liveness (no /v1 prefix)', async () => {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });

    it('/readyz: database reachable and every shipped migration applied', async () => {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        status: string;
        checks: { migrations: { applied: number; expected: number } };
      };
      expect(body.status).toBe('ready');
      expect(body.checks.migrations.applied).toBeGreaterThanOrEqual(
        body.checks.migrations.expected,
      );
    });

    it('/v1/health still answers', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/health' });
      expect(res.statusCode).toBe(200);
    });
  });
});
