import { z } from 'zod';
import { parseTrustProxy } from './trust-proxy.js';

export const APP_ROLES = ['api', 'worker', 'scheduler', 'migrate'] as const;
export type AppRole = (typeof APP_ROLES)[number];

const postgresUrl = z
  .string()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// or postgresql:// URL');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ROLE: z.enum(APP_ROLES).default('api'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    /** Runtime role (`app_user`), through PgBouncer in transaction mode. */
    DATABASE_URL: postgresUrl.optional(),
    /** Owner role (`app_owner`), DIRECT to Postgres. Used only by the `migrate` role. */
    MIGRATOR_DATABASE_URL: postgresUrl.optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /** `migrate` role only: also create the demo tenants (dev; refused when NODE_ENV=production). */
    SEED_DEMO_DATA: z.stringbool().default(false),

    /** Prefix of the `type` URI in problem+json documents (`<base>/<code>`). */
    PROBLEM_TYPE_BASE: z.url().default('https://api.assettracker.test/problems'),
    /** How long a duplicate Idempotency-Key request waits for the first before answering 409. */
    IDEMPOTENCY_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(3_000),

    S3_ENDPOINT: z.url().optional(),

    /**
     * Which reverse proxies' `X-Forwarded-For` the API believes (see `trust-proxy.ts`): `false`
     * (default: nobody), a hop count, or a comma list of proxy IPs/CIDRs. Per-IP throttling and
     * audit rows use the resulting client address, so production must NOT leave this open.
     */
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((value, ctx) => {
        try {
          return parseTrustProxy(value);
        } catch (err) {
          ctx.addIssue({ code: 'custom', message: (err as Error).message });
          return z.NEVER;
        }
      }),

    /** SMTP relay, e.g. `smtp://mailpit:1025` (dev) or `smtps://user:pass@smtp.example.com:465`. */
    SMTP_URL: z.string().min(1).optional(),
    /** RFC 5322 From header of every outgoing mail. */
    MAIL_FROM: z.string().min(3).default('Asset Tracker <no-reply@assettracker.local>'),

    /**
     * `scheduler` role only: owner role (app_owner), DIRECT to Postgres. Runs the single pg-boss
     * maintenance instance (supervise) and the owner-only maintenance jobs. Falls back to
     * MIGRATOR_DATABASE_URL.
     */
    MAINTENANCE_DATABASE_URL: postgresUrl.optional(),

    /** Self-hosted KeyProvider: 32-byte master key, base64. Prefer the *_FILE form (Docker secret). */
    MASTER_KEY: z.string().min(1).optional(),
    MASTER_KEY_FILE: z.string().min(1).optional(),
    MASTER_KEY_ID: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,32}$/)
      .default('mk1'),
    /** Previous master key, kept while data keys are re-wrapped after a rotation. */
    MASTER_KEY_PREVIOUS: z.string().min(1).optional(),
    MASTER_KEY_PREVIOUS_FILE: z.string().min(1).optional(),
    MASTER_KEY_PREVIOUS_ID: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,32}$/)
      .optional(),

    /** Background jobs (pg-boss). Polling only: LISTEN/NOTIFY does not work behind PgBouncer. */
    JOBS_POLL_SECONDS: z.coerce.number().min(1).max(2).default(1),
    JOBS_LOCAL_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
    /** Max concurrently running jobs of one tenant per worker process (fairness). */
    JOBS_TENANT_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
    JOBS_POOL_MAX: z.coerce.number().int().min(1).max(20).default(4),

    /** Outbox relay (worker role). */
    OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),

    /** Scheduler cron producers re-evaluate this often (jobs are deduplicated per time slot). */
    SCHEDULER_TICK_SECONDS: z.coerce.number().int().min(1).max(3600).default(15),

    /** Internal operations server: /metrics (all roles), /healthz and /readyz (worker, scheduler). */
    OPS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
    OPS_HOST: z.string().min(1).default('0.0.0.0'),
    OPS_ENABLED: z.stringbool().default(true),

    /** OpenTelemetry tracing is off unless an OTLP endpoint is configured. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_SERVICE_NAME: z.string().min(1).default('assettracker'),

    // --- authentication (M1-AUTH, src/auth) ---------------------------------------------------
    /** Base URL of the web app: invitation and password reset links are built from it. */
    WEB_BASE_URL: z.url().default('http://localhost:3001'),
    /** `<slug>.<suffix>` hostnames identify a tenant (vanity host); a host that disagrees with the credential's tenant is refused. */
    TENANT_HOST_SUFFIX: z.string().min(1).optional(),
    /** A browser session ends after this long without activity... */
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    /** ...and, regardless of activity, after this long. */
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(720).default(12),
    /** Failed logins (or re-authentications) per account (hashed email) before `429 account-locked`. */
    LOGIN_MAX_FAILURES_PER_ACCOUNT: z.coerce.number().int().min(1).max(1000).default(5),
    /** Failed attempts per client IP before `429 too-many-requests`. */
    LOGIN_MAX_FAILURES_PER_IP: z.coerce.number().int().min(1).max(10_000).default(30),
    /** Fixed throttling window; also the lockout duration. */
    AUTH_THROTTLE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    /** argon2id parameters (OWASP minimum: m=19 MiB, t=2, p=1). Lower them only in tests. */
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(8).max(1_048_576).default(19_456),
    ARGON2_TIME_COST: z.coerce.number().int().min(1).max(20).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),
    /** Optional online breached-password check (HIBP k-anonymity range API; only a 5-char hash prefix leaves the server). */
    BREACHED_PASSWORD_ONLINE: z.stringbool().default(false),
    BREACHED_PASSWORD_API_URL: z.url().default('https://api.pwnedpasswords.com/range'),
    INVITATION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    /** Issuer shown in authenticator apps. */
    TOTP_ISSUER: z.string().min(1).max(60).default('Asset Tracker'),

    APP_VERSION: z.string().min(1).optional(),
    GIT_SHA: z.string().min(1).default('dev'),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ROLE === 'migrate') {
      if (!env.MIGRATOR_DATABASE_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['MIGRATOR_DATABASE_URL'],
          message: 'required when APP_ROLE=migrate',
        });
      }
    } else {
      if (!env.DATABASE_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message: `required when APP_ROLE=${env.APP_ROLE}`,
        });
      }
      if (
        env.APP_ROLE === 'scheduler' &&
        !env.MAINTENANCE_DATABASE_URL &&
        !env.MIGRATOR_DATABASE_URL
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['MAINTENANCE_DATABASE_URL'],
          message: 'required when APP_ROLE=scheduler (owner role, direct connection)',
        });
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Validates an environment (defaults to process.env) and returns typed config, or throws. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  // Treat empty strings (common in compose/.env files) as unset so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`),
    );
  }
  return result.data;
}
