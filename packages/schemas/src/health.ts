import { z } from 'zod';

export const checkStatusSchema = z.enum(['ok', 'error']);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

/** `GET /v1/health` response body. HTTP 200 when status is `ok`, 503 when `degraded`. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    db: z.object({
      status: checkStatusSchema,
      latencyMs: z.number().nonnegative().optional(),
      error: z.string().optional(),
    }),
  }),
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** `GET /v1/version` response body. */
export const versionResponseSchema = z.object({
  name: z.string(),
  version: z.string(),
  commit: z.string(),
  role: z.string(),
});
export type VersionResponse = z.infer<typeof versionResponseSchema>;
