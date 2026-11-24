import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';

/**
 * Request schemas of the department endpoints (openapi `Department`, `DepartmentCreate`,
 * `DepartmentUpdate`). Bodies are strict; the update schema has no defaults (RFC 7396 merge semantics).
 */

const str = () =>
  z.string().refine((v) => !v.includes('\u0000'), 'must not contain NUL characters');
const trimmed = (min: number, max: number) => str().trim().min(min).max(max);
const nullableText = (max: number) => str().trim().max(max).nullable();
export const uuidParam = z.uuid();

/** An empty code is "no code" (a form that clears the field sends ""): the schema says so once. */
const code = str()
  .trim()
  .max(50)
  .nullable()
  .transform((v) => (v === '' ? null : v));

export const departmentCreateSchema = z.strictObject({
  name: trimmed(1, 200),
  code: code.optional(),
  description: nullableText(2000).optional(),
  manager_person_id: z.uuid().nullable().optional(),
});
export const departmentUpdateSchema = z.strictObject({
  name: trimmed(1, 200).optional(),
  code: code.optional(),
  description: nullableText(2000).optional(),
  manager_person_id: z.uuid().nullable().optional(),
});
export type DepartmentCreate = z.output<typeof departmentCreateSchema>;
export type DepartmentUpdate = z.output<typeof departmentUpdateSchema>;

export const departmentListSchema = listQuerySchema.extend({
  q: str().min(1).max(200).optional(),
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
});
export type DepartmentListQuery = z.output<typeof departmentListSchema>;

/** `DELETE /v1/departments/{id}?reassign_to=<id>`: move the people and assets there, then archive. */
export const departmentArchiveSchema = z.object({
  reassign_to: z.uuid().optional(),
});
export type DepartmentArchiveQuery = z.output<typeof departmentArchiveSchema>;
