import type { ModuleMetadata } from '@nestjs/common';
import type { FastifyInstance } from 'fastify';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule, type AppModuleOptions } from './app.module.js';
import type { AppConfig } from './config/env.js';
import { toFastifyTrustProxy } from './config/trust-proxy.js';
import { registerHttpObservability } from './observability/index.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './platform/index.js';

/** Routes served outside the `/v1` prefix: orchestrator probes (liveness, readiness). */
export const UNVERSIONED_ROUTES = ['healthz', 'readyz'];

/**
 * Raw upload bodies (M2-FILE-01, local storage driver): `PUT /v1/files/<token>` carries the file
 * bytes under its own content type (image/png, application/pdf, ...). Fastify rejects a content type
 * with no parser, so a catch-all parser hands the request STREAM through, but ONLY for that path;
 * every other route keeps answering 415 for anything but JSON. The stream is never buffered here:
 * the handler counts the bytes against the size the signed token promised.
 */
function registerFileBodyParser(fastify: FastifyInstance): void {
  fastify.addContentTypeParser('*', (request, payload, done) => {
    if (
      request.method === 'PUT' &&
      /^\/v1\/files\/[A-Za-z0-9_.-]+$/.test(request.url.split('?')[0]!)
    ) {
      done(null, payload);
      return;
    }
    done(
      Object.assign(
        new Error(`Unsupported Media Type: ${String(request.headers['content-type'])}`),
        {
          code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE',
          statusCode: 415,
        },
      ),
    );
  });
}

/** Builds (but does not listen) the HTTP app; shared by main.ts and the e2e tests. */
export async function createApiApp(
  config: AppConfig,
  extraImports: ModuleMetadata['imports'] = [],
  moduleOptions: AppModuleOptions = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config, extraImports, moduleOptions),
    new FastifyAdapter({
      // Local-storage file links carry a signed token in the path (up to ~500 characters).
      maxParamLength: 1024,
      trustProxy: toFastifyTrustProxy(config.TRUST_PROXY),
      // Request id: reuse a safe incoming X-Request-Id (ALB/CloudFront trace id, client UUID),
      // otherwise mint a UUID. Fastify's own header handling is off: it would echo any string.
      requestIdHeader: false,
      genReqId: (req: { headers: Record<string, string | string[] | undefined> }) =>
        resolveRequestId(req.headers[REQUEST_ID_HEADER]),
    }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('v1', { exclude: UNVERSIONED_ROUTES });

  const fastify = app.getHttpAdapter().getInstance();
  // The request id (and client ip, user agent) follow the request everywhere: logs, problem
  // documents, `app.request_id`, audit rows; plus RED metrics and a trace span per request.
  registerHttpObservability(fastify);
  registerFileBodyParser(fastify);
  fastify.addHook('onSend', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
  app.enableShutdownHooks();
  return app;
}
