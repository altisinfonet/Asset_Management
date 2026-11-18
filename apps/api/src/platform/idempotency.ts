import { createHash } from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { Prisma, sqlStateOf, TenancyService } from '../tenancy/index.js';
import { ApiProblem } from './problem.js';

/**
 * Idempotency-Key handling for POST/PUT/PATCH/DELETE (M1-PLAT-02, openapi "Idempotency").
 *
 * How it works (one transaction per keyed request, so "applied once" and "recorded once" cannot
 * diverge):
 *   1. open the tenant transaction for the authenticated principal (the handler's own
 *      `withTenantTx` calls for the same tenant JOIN it);
 *   2. claim the key: `INSERT ... ON CONFLICT DO NOTHING` into `app.idempotency_key`
 *      (tenant, principal, key). A concurrent duplicate blocks on the unique index until the first
 *      request commits or rolls back, then replays or takes over; after `lockTimeoutMs` it gets
 *      `409 idempotency-key-in-flight`;
 *   3. the key already exists: a different method/path/body is `422 idempotency-key-reuse`,
 *      otherwise the stored response is replayed (status, ETag/Location, body) with
 *      `Idempotent-Replayed: true`, and the handler does not run;
 *   4. the key is new: run the handler, store its response in the claimed row, commit with the
 *      handler's own writes.
 * A handler that fails rolls everything back, including the claim: the retry runs again. Keys
 * expire after 24 hours (`expires_at`); an expired row is replaced.
 */

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** 8-255 printable ASCII characters, no spaces (matches the table's length check). */
const KEY_PATTERN = /^[\x21-\x7e]{8,255}$/;
/** Response headers worth replaying; everything else is regenerated per request. */
const REPLAYED_HEADERS = ['etag', 'location'] as const;

const IDEMPOTENCY_REQUIRED = 'platform:idempotency-required';

/** Marks a route that must carry an Idempotency-Key (check-out, check-in, transfer, import commit...). */
export const IdempotencyRequired = () => SetMetadata(IDEMPOTENCY_REQUIRED, true);

export const IDEMPOTENCY_OPTIONS = Symbol('IDEMPOTENCY_OPTIONS');
export interface IdempotencyOptions {
  /** How long a concurrent duplicate waits for the first request before answering 409. */
  lockTimeoutMs: number;
}
export const DEFAULT_IDEMPOTENCY_OPTIONS: IdempotencyOptions = { lockTimeoutMs: 3_000 };

/** Deterministic JSON (sorted keys) so the same logical body always hashes the same. */
export function canonicalJson(value: unknown): string {
  const normalise = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalise);
    if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, normalise(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(normalise(value ?? null));
}

/** sha-256 of the parts of a request that define "the same request". */
export function requestHash(req: { query?: unknown; body?: unknown }): string {
  return createHash('sha256')
    .update(canonicalJson({ query: req.query ?? {}, body: req.body ?? null }))
    .digest('hex');
}

type Outcome =
  | { kind: 'fresh'; result: unknown }
  | { kind: 'replay'; status: number; headers: Record<string, string>; body: unknown };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly reflector: Reflector,
    private readonly options: IdempotencyOptions = DEFAULT_IDEMPOTENCY_OPTIONS,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    if (!MUTATING_METHODS.has(request.method)) return next.handle();

    const header = request.headers[IDEMPOTENCY_KEY_HEADER];
    const required = this.reflector.getAllAndOverride<boolean | undefined>(IDEMPOTENCY_REQUIRED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (header === undefined) {
      if (required) {
        throw new ApiProblem({
          code: 'idempotency-key-required',
          detail:
            'This operation requires an Idempotency-Key header (8-255 characters) so it can be retried safely.',
        });
      }
      return next.handle();
    }
    const key = Array.isArray(header) ? header.join(',') : header;
    if (!KEY_PATTERN.test(key)) {
      throw new ApiProblem({
        code: 'idempotency-key-invalid',
        detail: 'The Idempotency-Key header must be 8-255 visible ASCII characters without spaces.',
      });
    }
    const principal = request.principal;
    // No credential, no tenant to scope the key to: public routes (login...) ignore the header.
    if (!principal) return next.handle();

    return from(this.run(request, reply, next, principal, key));
  }

  private async run(
    request: FastifyRequest,
    reply: FastifyReply,
    next: CallHandler,
    principal: NonNullable<FastifyRequest['principal']>,
    key: string,
  ): Promise<unknown> {
    const path = request.url.split('?')[0]!;
    const hash = requestHash({ query: request.query, body: request.body });
    const { tenantId, principalId } = principal;

    let outcome: Outcome;
    try {
      outcome = await this.tenancy.withTenantTx(
        { tenantId, actorId: principalId, requestId: request.id },
        async (trx): Promise<Outcome> => {
          // Wait for a concurrent duplicate, but not forever.
          const [lockRow] = await trx.$queryRaw<Array<{ previous: string }>>`
            select current_setting('lock_timeout') as previous`;
          await trx.$executeRaw`select set_config('lock_timeout', ${`${this.options.lockTimeoutMs}ms`}, true)`;

          await trx.idempotency_key.deleteMany({
            where: {
              tenant_id: tenantId,
              principal_id: principalId,
              key,
              expires_at: { lt: new Date() },
            },
          });
          const claimed = await trx.idempotency_key.createMany({
            data: [
              {
                tenant_id: tenantId,
                principal_id: principalId,
                key,
                method: request.method,
                path,
                request_hash: hash,
              },
            ],
            skipDuplicates: true,
          });
          await trx.$executeRaw`select set_config('lock_timeout', ${lockRow!.previous}, true)`;

          if (claimed.count === 0) {
            const row = await trx.idempotency_key.findUniqueOrThrow({
              where: {
                tenant_id_principal_id_key: { tenant_id: tenantId, principal_id: principalId, key },
              },
            });
            if (row.method !== request.method || row.path !== path || row.request_hash !== hash) {
              throw new ApiProblem({
                code: 'idempotency-key-reuse',
                detail:
                  'This Idempotency-Key was already used with a different request (method, path, query or body). Use a new key for a new operation.',
              });
            }
            if (row.state !== 'completed' || row.response_status === null) {
              throw new ApiProblem({
                code: 'idempotency-key-in-flight',
                detail:
                  'A request with this Idempotency-Key is still being processed. Retry shortly.',
                headers: { 'Retry-After': '1' },
              });
            }
            return {
              kind: 'replay',
              status: row.response_status,
              headers: (row.response_headers ?? {}) as Record<string, string>,
              body: row.response_body,
            };
          }

          const result = await lastValueFrom(next.handle(), { defaultValue: undefined });
          // Store what a replay must reproduce: the JSON the client received.
          const body =
            result === undefined
              ? undefined
              : (JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue);
          const headers: Record<string, string> = {};
          for (const name of REPLAYED_HEADERS) {
            const value = reply.getHeader(name);
            if (typeof value === 'string') headers[name] = value;
          }
          await trx.idempotency_key.update({
            where: {
              tenant_id_principal_id_key: { tenant_id: tenantId, principal_id: principalId, key },
            },
            data: {
              state: 'completed',
              response_status: reply.statusCode,
              response_headers: headers,
              response_body: body === undefined ? Prisma.JsonNull : body,
            },
          });
          return { kind: 'fresh', result };
        },
      );
    } catch (err) {
      // 55P03 lock_not_available: the first request is still running past our wait.
      if (sqlStateOf(err) === '55P03') {
        throw new ApiProblem({
          code: 'idempotency-key-in-flight',
          detail: 'A request with this Idempotency-Key is still being processed. Retry shortly.',
          headers: { 'Retry-After': '1' },
        });
      }
      throw err;
    }

    if (outcome.kind === 'fresh') return outcome.result;
    void reply.status(outcome.status);
    for (const [name, value] of Object.entries(outcome.headers)) void reply.header(name, value);
    void reply.header(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return outcome.body === null ? undefined : outcome.body;
  }
}
