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

    /** Runtime role (`app`), through PgBouncer in transaction mode. */
    DATABASE_URL: postgresUrl.optional(),
    /** Owner role (`migrator`), DIRECT to Postgres. Used only by the `migrate` role. */
    MIGRATOR_DATABASE_URL: postgresUrl.optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    S3_ENDPOINT: z.url().optional(),
    SMTP_URL: z.string().min(1).optional(),

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
