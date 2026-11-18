import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProblemFilter } from './problem.filter.js';
import {
  ApiProblem,
  codeForStatus,
  DEFAULT_PROBLEM_TYPE_BASE,
  PROBLEM_CATALOG,
  problem,
  toProblemBody,
} from './problem.js';

const filter = new ProblemFilter('https://errors.example/p/');
const RID = 'req-0001';

describe('toProblemBody', () => {
  it('builds an RFC 9457 document with a stable type URI, code and request id', () => {
    expect(toProblemBody('not-found', { requestId: RID, detail: 'No such asset.' })).toEqual({
      type: `${DEFAULT_PROBLEM_TYPE_BASE}/not-found`,
      title: 'Not found',
      status: 404,
      code: 'not-found',
      detail: 'No such asset.',
      request_id: RID,
    });
  });

  it('honours a custom base and omits empty optional members', () => {
    const body = toProblemBody('conflict', { base: 'https://x.example/problems///' });
    expect(body).toEqual({
      type: 'https://x.example/problems/conflict',
      title: 'Conflict',
      status: 409,
      code: 'conflict',
    });
    expect(toProblemBody('validation', { errors: [] })).not.toHaveProperty('errors');
  });

  it('every catalog entry is a 4xx/5xx with a title (codes are API surface)', () => {
    for (const [code, entry] of Object.entries(PROBLEM_CATALOG)) {
      expect(entry.status, code).toBeGreaterThanOrEqual(400);
      expect(entry.title.length, code).toBeGreaterThan(3);
      expect(code).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
    expect(PROBLEM_CATALOG['precondition-failed'].status).toBe(412);
    expect(PROBLEM_CATALOG['precondition-required'].status).toBe(428);
    expect(PROBLEM_CATALOG['idempotency-key-reuse'].status).toBe(422);
    expect(PROBLEM_CATALOG['idempotency-key-in-flight'].status).toBe(409);
  });
});

describe('ProblemFilter.render', () => {
  it('renders an ApiProblem with its headers', () => {
    const r = filter.render(problem.unauthorized(), RID, '/v1/assets?x=1');
    expect(r.status).toBe(401);
    expect(r.headers).toEqual({ 'WWW-Authenticate': 'Bearer' });
    expect(r.body).toMatchObject({
      type: 'https://errors.example/p/unauthorized',
      code: 'unauthorized',
      request_id: RID,
      instance: '/v1/assets',
    });
  });

  it('renders ZodError as 422 validation with pointers', () => {
    const parsed = z.object({ a: z.string() }).safeParse({ a: 1 });
    const r = filter.render(parsed.error, RID);
    expect(r.status).toBe(422);
    expect(r.body.errors).toEqual([
      expect.objectContaining({ pointer: '/a', code: 'invalid_type' }),
    ]);
  });

  it('maps Nest HttpExceptions by status', () => {
    expect(filter.render(new NotFoundException('Cannot GET /x'), RID).body).toMatchObject({
      status: 404,
      code: 'not-found',
      detail: 'Cannot GET /x',
    });
    expect(filter.render(new BadRequestException('bad'), RID).body.code).toBe('bad-request');
    // 5xx details are never copied from the exception
    const r = filter.render(new ServiceUnavailableException('db password is x'), RID);
    expect(r.status).toBe(503);
    expect(r.body.detail).toBeUndefined();
  });

  it('maps Fastify client errors (invalid JSON, payload too large, wrong media type)', () => {
    const fst = (statusCode: number, message: string) =>
      Object.assign(new Error(message), { statusCode });
    expect(filter.render(fst(400, 'Body is not valid JSON'), RID).body).toMatchObject({
      code: 'bad-request',
      status: 400,
    });
    expect(filter.render(fst(413, 'too large'), RID).body.code).toBe('payload-too-large');
    expect(filter.render(fst(415, 'Unsupported Media Type'), RID).body.code).toBe(
      'unsupported-media-type',
    );
  });

  it('turns an untranslated unique/foreign-key violation into 409 conflict', () => {
    expect(filter.render({ code: '23505' }, RID).body.code).toBe('conflict');
    expect(
      filter.render(
        {
          code: 'P2002',
          clientVersion: '7',
          meta: { driverAdapterError: { cause: { originalCode: '23505' } } },
        },
        RID,
      ).status,
    ).toBe(409);
  });

  it('answers 500 with a generic message and never the exception text', () => {
    const r = filter.render(new Error('password=hunter2 at /srv/app/secret.ts:12'), RID);
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: 'internal', request_id: RID });
    expect(JSON.stringify(r.body)).not.toMatch(/hunter2|secret\.ts/);
    expect(filter.render('a string was thrown', RID).status).toBe(500);
    expect(filter.render(undefined, RID).status).toBe(500);
  });
});

describe('codeForStatus', () => {
  it('covers the statuses the framework produces on its own', () => {
    expect(
      [400, 401, 403, 404, 405, 409, 412, 413, 415, 422, 428, 429, 503, 500, 418].map(
        codeForStatus,
      ),
    ).toEqual([
      'bad-request',
      'unauthorized',
      'forbidden',
      'not-found',
      'method-not-allowed',
      'conflict',
      'precondition-failed',
      'payload-too-large',
      'unsupported-media-type',
      'validation',
      'precondition-required',
      'too-many-requests',
      'unavailable',
      'internal',
      'bad-request',
    ]);
  });
});

describe('ApiProblem', () => {
  it('is an HttpException with the catalog status', () => {
    const p = new ApiProblem({ code: 'precondition-failed', detail: 'stale' });
    expect(p.getStatus()).toBe(412);
    expect(p.message).toBe('stale');
    expect(p.code).toBe('precondition-failed');
  });
});
