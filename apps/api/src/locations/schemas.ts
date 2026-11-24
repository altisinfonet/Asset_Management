import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';

/**
 * Request schemas of the location endpoints (openapi `Location`, `LocationCreate`, `LocationUpdate`).
 * Bodies are strict; the update schema has no defaults (RFC 7396 merge semantics).
 */

const str = () =>
  z.string().refine((v) => !v.includes('\u0000'), 'must not contain NUL characters');
const trimmed = (min: number, max: number) => str().trim().min(min).max(max);
const nullableText = (max: number) => str().trim().max(max).nullable();
export const uuidParam = z.uuid();

export const LOCATION_KINDS = [
  'site',
  'building',
  'floor',
  'room',
  'storage',
  'vehicle',
  'other',
] as const;

/** Deepest allowed `depth` (a root has depth 0): ten levels. Documented on the `Location` schema. */
export const MAX_LOCATION_DEPTH = 9;

const address = z
  .strictObject({
    line1: nullableText(200).optional(),
    line2: nullableText(200).optional(),
    city: nullableText(100).optional(),
    region: nullableText(100).optional(),
    postal_code: nullableText(40).optional(),
    // ISO 3166-1 alpha-2: exactly two letters, stored upper-case ("no" and "NO" are the same country)
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, 'must be a two-letter country code (ISO 3166-1 alpha-2)')
      .transform((v) => v.toUpperCase())
      .nullable()
      .optional(),
  })
  .nullable();

const writable = {
  parent_id: z.uuid().nullable(),
  company_id: z.uuid(),
  name: trimmed(1, 200),
  kind: z.enum(LOCATION_KINDS),
  code: nullableText(100),
  address,
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  notes: nullableText(10_000),
};

export const locationCreateSchema = z.strictObject({
  ...writable,
  parent_id: writable.parent_id.optional(),
  company_id: writable.company_id.optional(),
  kind: writable.kind.optional(),
  code: writable.code.optional(),
  address: writable.address.optional(),
  latitude: writable.latitude.optional(),
  longitude: writable.longitude.optional(),
  notes: writable.notes.optional(),
});
export const locationUpdateSchema = z.strictObject({
  parent_id: writable.parent_id.optional(),
  company_id: writable.company_id.optional(),
  name: writable.name.optional(),
  kind: writable.kind.optional(),
  code: writable.code.optional(),
  address: writable.address.optional(),
  latitude: writable.latitude.optional(),
  longitude: writable.longitude.optional(),
  notes: writable.notes.optional(),
});
export type LocationCreate = z.output<typeof locationCreateSchema>;
export type LocationUpdate = z.output<typeof locationUpdateSchema>;

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

export const locationListSchema = listQuerySchema.extend({
  q: str().min(1).max(200).optional(),
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
  parent_id: z.uuid().optional(),
  root: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  descendants_of: z.uuid().optional(),
  kind: csv(z.enum(LOCATION_KINDS)).optional(),
  company_id: z.uuid().optional(),
});
export type LocationListQuery = z.output<typeof locationListSchema>;
