import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';
import { EMAIL_MODES } from './types.js';

/** Request schemas of the notification endpoints (openapi tag Notifications). */

export const uuidParam = z.uuid();
/** A notification type in a path: the shape only; whether it is registered is the service's 404. */
export const typeParam = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .max(500)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).max(10));

export const notificationListSchema = listQuerySchema
  .pick({ limit: true, cursor: true })
  .extend({ unread: bool.optional() });
export type NotificationListQuery = z.output<typeof notificationListSchema>;

export const preferenceUpdateSchema = z
  .strictObject({
    in_app: z.boolean().optional(),
    email: z.enum(EMAIL_MODES as [string, ...string[]]).optional(),
  })
  .refine((v) => v.in_app !== undefined || v.email !== undefined, {
    message: 'send at least one of in_app and email',
  });
export type PreferenceUpdate = z.output<typeof preferenceUpdateSchema>;

export const ruleUpdateSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    recipient_roles: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{1,62}$/))
      .max(20)
      .nullable()
      .optional(),
  })
  .refine((v) => v.enabled !== undefined || v.recipient_roles !== undefined, {
    message: 'send at least one of enabled and recipient_roles',
  });
export type RuleUpdate = z.output<typeof ruleUpdateSchema>;

const instant = z.iso
  .datetime({ offset: true })
  .refine((v) => new Date(v).getUTCFullYear() >= 1, 'year must be 1 or later');

export const deliveryListSchema = listQuerySchema.pick({ limit: true, cursor: true }).extend({
  user_id: z.uuid().optional(),
  type: z.string().min(1).max(64).optional(),
  channel: z.enum(['in_app', 'email']).optional(),
  status: csv(z.enum(['delivered', 'queued', 'deferred', 'skipped', 'failed'])).optional(),
  from: instant.optional(),
  to: instant.optional(),
});
export type DeliveryListQuery = z.output<typeof deliveryListSchema>;
