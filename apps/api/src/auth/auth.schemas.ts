import { z } from 'zod';

/** Request bodies of the auth and access endpoints (openapi `components.schemas`). Strict: unknown fields are a 422. */

const email = z.string().trim().toLowerCase().pipe(z.email().max(320));
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
/** Policy codes (`too-short`...) come from PasswordService, so only an upper bound is enforced here. */
const passwordInput = z.string().max(4096);

export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1).max(1024),
  tenant_slug: slug.optional(),
});

export const mfaVerifySchema = z.strictObject({
  challenge_id: z.string().min(1).max(256),
  method: z.enum(['totp', 'webauthn', 'recovery_code']),
  code: z.string().min(1).max(4096),
});

export const forgotPasswordSchema = z.strictObject({ email });

export const resetPasswordSchema = z.strictObject({
  token: z.string().min(16).max(256),
  password: passwordInput,
});

export const acceptInvitationSchema = z.strictObject({
  token: z.string().min(16).max(256),
  password: passwordInput,
  display_name: z.string().trim().min(1).max(200),
});

export const invitationTokenParam = z.string().min(16).max(256);

export const totpCode = z.string().regex(/^[0-9 ]{6,8}$/, 'must be a 6-digit code');

export const mfaConfirmSchema = z.strictObject({ code: totpCode });

export const reauthSchema = z
  .strictObject({
    password: z.string().max(1024).optional(),
    totp_code: totpCode.optional(),
  })
  .refine((v) => v.password !== undefined || v.totp_code !== undefined, {
    message: 'Send the current password or a current TOTP code.',
    path: ['password'],
  });

export const uuidParam = z.uuid();

export const roleAssignmentSchema = z.strictObject({
  role_id: z.uuid(),
  scope_type: z.enum(['tenant', 'company', 'location']).default('tenant'),
  company_id: z.uuid().nullish(),
  location_id: z.uuid().nullish(),
});

const localeField = z.string().min(2).max(35).nullable();
const timezoneField = z.string().min(1).max(64).nullable();

export const userCreateSchema = z.strictObject({
  email,
  display_name: z.string().trim().min(1).max(200),
  status: z.enum(['invited', 'active', 'disabled']).optional(),
  locale: localeField.optional(),
  timezone: timezoneField.optional(),
  role_assignments: z.array(roleAssignmentSchema).min(1).max(20),
  send_invite: z.boolean().default(true),
});

export const userUpdateSchema = z.strictObject({
  email: email.optional(),
  display_name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['invited', 'active', 'disabled']).optional(),
  locale: localeField.optional(),
  timezone: timezoneField.optional(),
  role_assignments: z.array(roleAssignmentSchema).min(1).max(20).optional(),
});

export const userListQuerySchema = z.object({
  status: z.enum(['invited', 'active', 'disabled']).optional(),
  role_id: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  archived: z.enum(['exclude', 'include', 'only']).optional(),
});

export const apiKeyCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  scopes: z
    .array(z.string().regex(/^[a-z_]+:[a-z_*]+$/))
    .min(1)
    .max(100),
  expires_at: z.iso.datetime({ offset: true }).nullish(),
});

export type LoginBody = z.output<typeof loginSchema>;
export type MfaVerifyBody = z.output<typeof mfaVerifySchema>;
export type ReauthBody = z.output<typeof reauthSchema>;
export type RoleAssignmentBody = z.output<typeof roleAssignmentSchema>;
export type UserCreateBody = z.output<typeof userCreateSchema>;
export type UserUpdateBody = z.output<typeof userUpdateSchema>;
