import type { ModuleMetadata } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule, type AppModuleOptions } from './app.module.js';
import type { AppConfig } from './config/env.js';
import { runWithRequestContext } from './context/request-context.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './platform/index.js';

/** Routes served outside the `/v1` prefix: orchestrator probes (liveness, readiness). */
export const UNVERSIONED_ROUTES = ['healthz', 'readyz'];

/** Builds (but does not listen) the HTTP app; shared by main.ts and the e2e tests. */
export async function createApiApp(
  config: AppConfig,
  extraImports: ModuleMetadata['imports'] = [],
  moduleOptions: AppModuleOptions = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config, extraImports, moduleOptions),
    new FastifyAdapter({
      trustProxy: true,
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
  // The request id follows the request everywhere (logs, problem documents, `app.request_id`).
  fastify.addHook('onRequest', (request, _reply, done) => {
    runWithRequestContext({ requestId: request.id }, done);
  });
  fastify.addHook('onSend', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
  app.enableShutdownHooks();
  return app;
}
