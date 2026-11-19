import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';

/** Request schemas of the saved-view endpoints (openapi `SavedView`, `SavedViewCreate`, `SavedViewUpdate`, `SavedViewShare`). */

const str = () =>
  z.string().refine((v) => !v.includes('\u0000'), 'must not contain NUL characters');
export const uuidParam = z.uuid();

export const VIEW_RESOURCES = ['assets'] as const;
export type ViewResource = (typeof VIEW_RESOURCES)[number];
/** At most this many views per user and list. */
export const MAX_VIEWS_PER_USER = 50;

/** The filters are the client's own state: the server bounds their size and keeps them verbatim. */
const filters = z
  .record(z.string().max(64), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 12_000, 'must be at most 12 KB of JSON');
const columns = z.array(str().trim().min(1).max(64)).max(40);
const sort = str().trim().min(1).max(64).nullable();
const name = str().trim().min(1).max(100);

export const viewCreateSchema = z.strictObject({
  resource: z.enum(VIEW_RESOURCES).default('assets'),
  name,
  filters: filters.default({}),
  columns: columns.default([]),
  sort: sort.default(null),
});
export type ViewCreate = z.output<typeof viewCreateSchema>;

export const viewUpdateSchema = z.strictObject({
  name: name.optional(),
  filters: filters.optional(),
  columns: columns.optional(),
  sort: sort.optional(),
});
export type ViewUpdate = z.output<typeof viewUpdateSchema>;

export const viewShareSchema = z.strictObject({ shared: z.boolean() });
export type ViewShare = z.output<typeof viewShareSchema>;

export const viewListSchema = listQuerySchema.pick({ limit: true, cursor: true }).extend({
  resource: z.enum(VIEW_RESOURCES).default('assets'),
  scope: z.enum(['all', 'mine', 'shared']).default('all'),
});
export type ViewListQuery = z.output<typeof viewListSchema>;
