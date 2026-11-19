import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';

export const OWNER_TYPES = [
  'asset',
  'asset_model',
  'accessory',
  'consumable',
  'location',
  'person',
  'maintenance_record',
  'assignment',
  'import_job',
] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const ATTACHMENT_KINDS = ['photo', 'document', 'signature', 'import_file', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** A string without NUL bytes (PostgreSQL text cannot store them). */
const text = () =>
  z.string().refine((v) => !v.includes('\u0000'), 'must not contain NUL characters');

export const attachmentCreateSchema = z.strictObject({
  entity_type: z.enum(OWNER_TYPES),
  entity_id: z.uuid(),
  kind: z.enum(ATTACHMENT_KINDS).default('document'),
  filename: text().trim().min(1).max(255),
  content_type: text().trim().min(1).max(200),
  size_bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'must be 64 lower-case hex characters')
    .optional(),
});
export type AttachmentCreate = z.output<typeof attachmentCreateSchema>;

export const attachmentListSchema = listQuerySchema.extend({
  entity_type: z.enum(OWNER_TYPES),
  entity_id: z.uuid(),
  kind: z.enum(ATTACHMENT_KINDS).optional(),
});
export type AttachmentListQuery = z.output<typeof attachmentListSchema>;

export const uuidParam = z.uuid();

/** A file token in a URL path: base64url + one dot, bounded. */
export const tokenParam = z.string().regex(/^[A-Za-z0-9_-]{1,3000}\.[A-Za-z0-9_-]{1,100}$/);
