import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/env.js';

/** Builds (but does not listen) the HTTP app; shared by main.ts and the e2e tests. */
export async function createApiApp(config: AppConfig): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    new FastifyAdapter({
      trustProxy: true,
      // Reuse an incoming x-request-id (e.g. from the ALB/CloudFront) or mint a UUID.
      requestIdHeader: 'x-request-id',
      genReqId: () => randomUUID(),
    }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('v1');
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply) => {
      reply.header('x-request-id', request.id);
    });
  app.enableShutdownHooks();
  return app;
}
