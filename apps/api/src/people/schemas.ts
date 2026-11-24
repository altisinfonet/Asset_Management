import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';

/**
 * Request schemas of the people endpoints (openapi `Person`, `PersonCreate`, `PersonUpdate`).
 * Bodies are strict. The update schema has no defaults (RFC 7396 merge semantics) and carries the two
 * non-persisted fields of a forced deactivation, `force` and `reason`.
 */

const str = () =>
  z.string().refine((v) => !v.includes('\u0000'), 'must not contain NUL characters');
const trimmed = (min: number, max: number) => str().trim().min(min).max(max);
const nullableText = (max: number) => str().trim().max(max).nullable();
const email = z.string().trim().toLowerCase().pipe(z.email().max(320));
export const uuidParam = z.uuid();

export const PERSON_KINDS = ['employee', 'student', 'contractor', 'external'] as const;
export const PERSON_STATUSES = ['active', 'inactive'] as const;

const writable = {
  kind: z.enum(PERSON_KINDS),
  display_name: trimmed(1, 200),
  first_name: nullableText(100),
  last_name: nullableText(100),
  email: email.nullable(),
  phone: nullableText(60),
  employee_ref: nullableText(100),
  /** ED-17: a managed department (`POST /v1/departments`); the free-text `department` is gone. */
  department_id: z.uuid().nullable(),
  job_title: nullableText(200),
  location_id: z.uuid().nullable(),
  company_id: z.uuid(),
  status: z.enum(PERSON_STATUSES),
  notes: nullableText(10_000),
};

export const personCreateSchema = z.strictObject({
  ...writable,
  kind: writable.kind.optional(),
  first_name: writable.first_name.optional(),
  last_name: writable.last_name.optional(),
  email: writable.email.optional(),
  phone: writable.phone.optional(),
  employee_ref: writable.employee_ref.optional(),
  department_id: writable.department_id.optional(),
  job_title: writable.job_title.optional(),
  location_id: writable.location_id.optional(),
  company_id: writable.company_id.optional(),
  status: writable.status.optional(),
  notes: writable.notes.optional(),
});
export const personUpdateSchema = z.strictObject({
  kind: writable.kind.optional(),
  display_name: writable.display_name.optional(),
  first_name: writable.first_name.optional(),
  last_name: writable.last_name.optional(),
  email: writable.email.optional(),
  phone: writable.phone.optional(),
  employee_ref: writable.employee_ref.optional(),
  department_id: writable.department_id.optional(),
  job_title: writable.job_title.optional(),
  location_id: writable.location_id.optional(),
  company_id: writable.company_id.optional(),
  status: writable.status.optional(),
  notes: writable.notes.optional(),
  force: z.boolean().optional(),
  reason: trimmed(1, 500).optional(),
});
/** `POST /v1/people/{id}/link-user` (M2-USR-03). */
export const personLinkUserSchema = z.strictObject({ user_id: z.uuid() });
export type PersonLinkUser = z.output<typeof personLinkUserSchema>;
export type PersonCreate = z.output<typeof personCreateSchema>;
export type PersonUpdate = z.output<typeof personUpdateSchema>;

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .max(2000)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).max(50));
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const personListSchema = listQuerySchema.extend({
  q: str().min(1).max(200).optional(),
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
  kind: csv(z.enum(PERSON_KINDS)).optional(),
  status: z.enum(PERSON_STATUSES).optional(),
  department_id: z.uuid().optional(),
  location_id: z.uuid().optional(),
  employee_ref: str().min(1).max(100).optional(),
  has_login: bool.optional(),
});
export type PersonListQuery = z.output<typeof personListSchema>;
