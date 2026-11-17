import type { Params } from 'nestjs-pino';
import pino, { type Logger } from 'pino';
import type { AppConfig } from '../config/env.js';

const redact = ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'];

/** Standalone structured-JSON logger for non-HTTP roles (worker, scheduler, migrate). */
export function createLogger(config: AppConfig): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'assettracker-api', role: config.APP_ROLE, commit: config.GIT_SHA },
    redact,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/** nestjs-pino options: JSON logs, request id propagation, quiet health probes. */
export function pinoHttpParams(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      base: { service: 'assettracker-api', role: config.APP_ROLE, commit: config.GIT_SHA },
      redact,
      timestamp: pino.stdTimeFunctions.isoTime,
      // Request ids come from Fastify (see createApiApp: x-request-id header or a generated UUID).
      autoLogging: {
        // middie may rewrite req.url; originalUrl keeps the full path.
        ignore: (req) =>
          ((req as { originalUrl?: string }).originalUrl ?? req.url)?.split('?')[0] ===
          '/v1/health',
      },
      customProps: () => ({ context: 'http' }),
    },
  };
}
