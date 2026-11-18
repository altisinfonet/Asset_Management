import { z } from 'zod';

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
    SMTP_URL: z.string().min(1).optional(),

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
    } else if (!env.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: `required when APP_ROLE=${env.APP_ROLE}`,
      });
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
