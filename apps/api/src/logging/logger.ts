import type { Params } from 'nestjs-pino';
import pino, { type Logger, type LoggerOptions } from 'pino';
import type { AppConfig } from '../config/env.js';
import { currentRequestContext } from '../context/request-context.js';
import { currentTenantContext } from '../tenancy/index.js';

/**
 * Field names whose VALUE is never logged, at the top level and up to three levels deep
 * (`body.password`, `req.body.user.password`...). Pino replaces the value with `[REDACTED]` before
 * serialisation, so nothing downstream (stdout, a log shipper) ever sees it. `redaction.test.ts`
 * proves it for every name in this list.
 */
export const REDACTED_LOG_FIELDS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'sessionToken',
  'resetToken',
  'inviteToken',
  'secret',
  'clientSecret',
  'apiKey',
  'api_key',
  'privateKey',
  'masterKey',
  'dataKey',
  'totp',
  'totpSecret',
  'totpCode',
  'otp',
  'recoveryCode',
  'recoveryCodes',
  'authorization',
  'cookie',
  'smtpUrl',
  'databaseUrl',
] as const;

const NESTING = ['', '*.', '*.*.', '*.*.*.'];

export const redact: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  ...NESTING.flatMap((prefix) => REDACTED_LOG_FIELDS.map((field) => `${prefix}${field}`)),
];

/**
 * Correlation fields added to EVERY log line from ambient state: the request context (set per HTTP
 * request and per job) and the tenant transaction. Absent values are omitted, not null.
 */
export function correlationFields(): Record<string, string> {
  const ctx = currentRequestContext();
  const tenantTx = currentTenantContext();
  const out: Record<string, string> = {};
  const requestId = ctx?.requestId ?? tenantTx?.requestId;
  const tenantId = ctx?.tenantId ?? tenantTx?.tenantId;
  const actorId = ctx?.actorId ?? tenantTx?.actorId;
  if (requestId) out.request_id = requestId;
  if (tenantId) out.tenant_id = tenantId;
  if (actorId) out.actor_id = actorId;
  return out;
}

function baseOptions(config: AppConfig): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    base: { service: 'assettracker-api', role: config.APP_ROLE, commit: config.GIT_SHA },
    redact: { paths: redact, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin: correlationFields,
  };
}

/** Standalone structured-JSON logger for non-HTTP roles (worker, scheduler, migrate). */
export function createLogger(config: AppConfig, destination?: pino.DestinationStream): Logger {
  return pino(baseOptions(config), destination);
}

/** nestjs-pino options: JSON logs, request id propagation, quiet health probes. */
export function pinoHttpParams(config: AppConfig): Params {
  return {
    pinoHttp: {
      ...baseOptions(config),
      // Request ids come from Fastify (see createApiApp: x-request-id header or a generated UUID).
      autoLogging: {
        // middie may rewrite req.url; originalUrl keeps the full path.
        ignore: (req) => {
          const url = ((req as { originalUrl?: string }).originalUrl ?? req.url)?.split('?')[0];
          return url === '/v1/health' || url === '/healthz' || url === '/readyz';
        },
      },
      customProps: () => ({ context: 'http' }),
    },
  };
}
