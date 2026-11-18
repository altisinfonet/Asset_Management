import { SpanKind, SpanStatusCode, context, trace, type Span } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';
import { runWithRequestContext, type RequestContext } from '../context/request-context.js';
import { httpDuration, httpRequests, statusClass } from './metrics.js';
import { startSpan } from './tracing.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The ambient context of this request (also available through AsyncLocalStorage). */
    requestContext?: RequestContext;
    obsStart?: bigint;
    obsSpan?: Span;
  }
}

/**
 * Per-request plumbing, installed once on the Fastify instance:
 *  - the request context (request id, client ip, user agent) for `AsyncLocalStorage` consumers: the
 *    logger mixin, the problem filter, `withTenantTx`, the audit writer;
 *  - RED metrics per route PATTERN (rate: `http_requests_total`, errors: its 5xx series, duration:
 *    `http_request_duration_seconds`);
 *  - a server span per request (no-op unless tracing is on) carrying `request_id`, `http.route`,
 *    status, and, once authentication has bound it, `tenant_id` (an attribute, never a metric label).
 */
export function registerHttpObservability(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', (request, _reply, done) => {
    const ctx: RequestContext = {
      requestId: request.id,
      ip: request.ip,
      userAgent: headerString(request.headers['user-agent']),
    };
    request.requestContext = ctx;
    request.obsStart = process.hrtime.bigint();
    const span = startSpan(
      `${request.method} ${request.url.split('?')[0]}`,
      {
        'http.request.method': request.method,
        request_id: request.id,
      },
      SpanKind.SERVER,
    );
    request.obsSpan = span;
    // Run the rest of the request lifecycle inside both the request context and the span's context.
    runWithRequestContext(ctx, () => context.with(trace.setSpan(context.active(), span), done));
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions?.url ?? 'unmatched';
    const status = reply.statusCode;
    const seconds =
      Number(process.hrtime.bigint() - (request.obsStart ?? process.hrtime.bigint())) / 1e9;
    httpRequests.inc({ method: request.method, route, status: String(status) });
    httpDuration.observe(
      { method: request.method, route, status_class: statusClass(status) },
      seconds,
    );

    const span = request.obsSpan;
    if (span) {
      const tenantId = request.requestContext?.tenantId ?? request.principal?.tenantId;
      span.setAttributes({
        'http.route': route,
        'http.response.status_code': status,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      });
      if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
    done();
  });
}

const headerString = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;
