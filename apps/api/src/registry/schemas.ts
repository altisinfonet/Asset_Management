import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';

/**
 * Request schemas of the registry endpoints (openapi `components.schemas`). Bodies are strict:
 * unknown fields are a 422. Update schemas carry NO defaults (RFC 7396 merge semantics: an omitted
 * field is unchanged), so defaults are applied by the services on create only.
 */

/** A string without NUL bytes (PostgreSQL text and jsonb cannot store them: it would be a 500). */
function str() {
  return z.string().refine((v) => !v.includes('\u0000'), 'must not contain NUL characters');
}
export const uuidParam = z.uuid();

/** `exclude` (default) | `include` | `only`. */
export const archivedParam = z.enum(['exclude', 'include', 'only']).default('exclude');
export type ArchivedFilter = z.output<typeof archivedParam>;

const trimmed = (min: number, max: number) => str().trim().min(min).max(max);
const nullableText = (max: number) => str().trim().max(max).nullable();
/** A calendar date PostgreSQL accepts (year 0000 passes the format check but not the database). */
const isoDate = z.iso
  .date()
  .refine((v) => new Date(`${v}T00:00:00Z`).getUTCFullYear() >= 1, 'year must be 1 or later');
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
    .pipe(z.array(item).max(200));

// ---------------------------------------------------------------------------------- categories

export const CATEGORY_KINDS = ['asset', 'accessory', 'consumable', 'component', 'license'] as const;
const tagPrefix = str().regex(/^[A-Z0-9-]{1,12}$/, 'must be 1-12 of A-Z, 0-9 and -');

export const categoryCreateSchema = z.strictObject({
  name: trimmed(1, 100),
  kind: z.enum(CATEGORY_KINDS).optional(),
  tag_prefix: tagPrefix.nullable().optional(),
  description: nullableText(2000).optional(),
});
export const categoryUpdateSchema = z.strictObject({
  name: trimmed(1, 100).optional(),
  kind: z.enum(CATEGORY_KINDS).optional(),
  tag_prefix: tagPrefix.nullable().optional(),
  description: nullableText(2000).optional(),
});
export type CategoryCreate = z.output<typeof categoryCreateSchema>;
export type CategoryUpdate = z.output<typeof categoryUpdateSchema>;

export const categoryListSchema = listQuerySchema.extend({
  q: str().min(1).max(200).optional(),
  archived: archivedParam,
  kind: z.enum(CATEGORY_KINDS).optional(),
});

// -------------------------------------------------------------------------------- manufacturers

const optionalUrl = z.url().max(2000).nullable();
export const manufacturerCreateSchema = z.strictObject({
  name: trimmed(1, 200),
  url: optionalUrl.optional(),
  support_url: optionalUrl.optional(),
  support_email: z.email().max(320).nullable().optional(),
  support_phone: nullableText(100).optional(),
  notes: nullableText(10_000).optional(),
});
export const manufacturerUpdateSchema = manufacturerCreateSchema.partial();
export type ManufacturerCreate = z.output<typeof manufacturerCreateSchema>;
export type ManufacturerUpdate = z.output<typeof manufacturerUpdateSchema>;

export const nameListSchema = listQuerySchema.extend({
  q: str().min(1).max(200).optional(),
  archived: archivedParam,
});

// ------------------------------------------------------------------------------------- vendors

export const vendorCreateSchema = z.strictObject({
  name: trimmed(1, 200),
  contact_name: nullableText(200).optional(),
  contact_email: z.email().max(320).nullable().optional(),
  phone: nullableText(100).optional(),
  url: optionalUrl.optional(),
  address: nullableText(1000).optional(),
  notes: nullableText(10_000).optional(),
});
export const vendorUpdateSchema = vendorCreateSchema.partial();
export type VendorCreate = z.output<typeof vendorCreateSchema>;
export type VendorUpdate = z.output<typeof vendorUpdateSchema>;

// -------------------------------------------------------------------------------------- models

export const modelCreateSchema = z.strictObject({
  category_id: z.uuid(),
  manufacturer_id: z.uuid().nullable().optional(),
  name: trimmed(1, 200),
  model_number: nullableText(200).optional(),
  default_depreciation_months: z.number().int().min(0).max(1200).nullable().optional(),
  eol_date: isoDate.nullable().optional(),
  notes: nullableText(10_000).optional(),
});
export const modelUpdateSchema = modelCreateSchema.partial().extend({
  /** M2-FILE-03: the model's picture, an image attachment whose owner is this model. */
  image_attachment_id: z.uuid().nullable().optional(),
});
export type ModelCreate = z.output<typeof modelCreateSchema>;
export type ModelUpdate = z.output<typeof modelUpdateSchema>;

export const modelListSchema = listQuerySchema.extend({
  q: str().min(1).max(200).optional(),
  archived: archivedParam,
  category_id: z.uuid().optional(),
  manufacturer_id: z.uuid().optional(),
});

// ------------------------------------------------------------------------------ status labels

export const STATE_TYPES = [
  'deployable',
  'deployed',
  'pending',
  'undeployable',
  'archived',
  'lost',
] as const;
export type StateType = (typeof STATE_TYPES)[number];

const color = str().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour');
export const statusLabelCreateSchema = z.strictObject({
  name: trimmed(1, 100),
  state_type: z.enum(STATE_TYPES),
  color: color.nullable().optional(),
  description: nullableText(1000).optional(),
  position: z.number().int().min(0).max(100_000).optional(),
  is_default: z.boolean().optional(),
});
export const statusLabelUpdateSchema = statusLabelCreateSchema.partial();
export type StatusLabelCreate = z.output<typeof statusLabelCreateSchema>;
export type StatusLabelUpdate = z.output<typeof statusLabelUpdateSchema>;

export const statusLabelListSchema = listQuerySchema.extend({
  archived: archivedParam,
  state_type: csv(z.enum(STATE_TYPES)).optional(),
});

// ---------------------------------------------------------------------------- custom fields

export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
  'url',
  'email',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const fieldKey = str().regex(/^[a-z][a-z0-9_]{0,62}$/, 'must match ^[a-z][a-z0-9_]{0,62}$');
const fieldOption = z.strictObject({
  value: str().min(1).max(100),
  label: str().min(1).max(100).optional(),
});

export const customFieldCreateSchema = z.strictObject({
  category_id: z.uuid().nullable().optional(),
  key: fieldKey,
  label: trimmed(1, 100),
  data_type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  options: z.array(fieldOption).max(500).nullable().optional(),
  validation: z.record(str(), z.unknown()).nullable().optional(),
  help_text: nullableText(1000).optional(),
  position: z.number().int().min(0).max(100_000).optional(),
  show_in_list: z.boolean().optional(),
});
export const customFieldUpdateSchema = customFieldCreateSchema.partial();
export type CustomFieldCreate = z.output<typeof customFieldCreateSchema>;
export type CustomFieldUpdate = z.output<typeof customFieldUpdateSchema>;

export const customFieldListSchema = listQuerySchema.extend({
  q: str().min(1).max(200).optional(),
  archived: archivedParam,
  category_id: z.uuid().optional(),
});

// ------------------------------------------------------------------------ asset tag template

export const assetTagTemplateSchema = z.strictObject({
  prefix: z
    .string()
    .regex(/^[A-Z0-9-]{0,12}$/, 'must be up to 12 of A-Z, 0-9 and -')
    .default(''),
  width: z.number().int().min(1).max(12).default(5),
  use_category_prefix: z.boolean().default(true),
});
export type AssetTagTemplate = z.output<typeof assetTagTemplateSchema>;

// -------------------------------------------------------------------------------------- assets

const money = z.strictObject({
  amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: str().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code such as USD'),
});
const assetTag = z
  .string()
  .min(1)
  .max(64)
  .regex(/^\S+$/, 'must not contain whitespace')
  .refine((v) => !/\p{Cc}/u.test(v), 'must not contain control characters');
const customData = z
  .record(str().min(1).max(63), z.unknown())
  .refine((v) => !JSON.stringify(v).includes('\\u0000'), 'must not contain NUL characters');

export const assetUpdateSchema = z.strictObject({
  asset_tag: assetTag.optional(),
  name: nullableText(200).optional(),
  serial: nullableText(200).optional(),
  category_id: z.uuid().optional(),
  model_id: z.uuid().nullable().optional(),
  status_id: z.uuid().optional(),
  location_id: z.uuid().nullable().optional(),
  company_id: z.uuid().optional(),
  vendor_id: z.uuid().nullable().optional(),
  parent_asset_id: z.uuid().nullable().optional(),
  purchase_date: isoDate.nullable().optional(),
  purchase_cost: money.nullable().optional(),
  order_number: nullableText(200).optional(),
  warranty_end: isoDate.nullable().optional(),
  notes: nullableText(10_000).optional(),
  custom_data: customData.optional(),
  external_source: nullableText(100).optional(),
  external_id: nullableText(200).optional(),
  /** M2-FILE-03: the asset's primary picture, an image attachment whose owner is this asset. */
  image_attachment_id: z.uuid().nullable().optional(),
});
// A picture is an attachment OF the asset, so it can only be set once the asset exists.
export const assetCreateSchema = assetUpdateSchema
  .omit({ image_attachment_id: true })
  .extend({ category_id: z.uuid() });
export type AssetCreate = z.output<typeof assetCreateSchema>;
export type AssetUpdate = z.output<typeof assetUpdateSchema>;

/** Fields a clone may copy from its source (never the tag, serial, label code or external ids). */
export const CLONE_FIELDS = [
  'name',
  'model_id',
  'status_id',
  'vendor_id',
  'location_id',
  'parent_asset_id',
  'purchase_date',
  'purchase_cost',
  'order_number',
  'warranty_end',
  'notes',
  'custom_data',
] as const;
export type CloneField = (typeof CLONE_FIELDS)[number];

export const cloneSchema = z.strictObject({
  count: z.number().int().min(1).max(100).default(1),
  /** Which fields to copy from the source; default: all of them. */
  copy_fields: z.array(z.enum(CLONE_FIELDS)).max(CLONE_FIELDS.length).optional(),
  /** Explicit tags (one per copy); otherwise the numbering template generates them. */
  asset_tags: z.array(assetTag).min(1).max(100).optional(),
});
export type CloneBody = z.output<typeof cloneSchema>;

/** A bulk edit applies the same changes to every listed asset. */
export const bulkUpdateSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(100),
  changes: z
    .strictObject({
      status_id: z.uuid(),
      category_id: z.uuid(),
      model_id: z.uuid().nullable(),
      vendor_id: z.uuid().nullable(),
      custom_data: customData,
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, 'must change at least one field'),
});
export const bulkIdsSchema = z.strictObject({ ids: z.array(z.uuid()).min(1).max(100) });
export type BulkUpdateBody = z.output<typeof bulkUpdateSchema>;

export const ASSET_SORTS = [
  'created_at',
  'updated_at',
  'asset_tag',
  'name',
  'purchase_date',
  'warranty_end',
] as const;

export const ASSET_EXPANDS = ['model', 'category', 'location', 'vendor'] as const;

/** Filters that exist in the contract but need M2 tables: refused (400) until they exist. */
export const M2_ONLY_ASSET_FILTERS = [
  'include_sublocations',
  'assigned_person_id',
  'assigned',
  'loaner_pool_id',
] as const;

export const assetListSchema = listQuerySchema.extend({
  q: str().min(1).max(200).optional(),
  archived: archivedParam,
  tag: str().min(1).max(200).optional(),
  serial: str().min(1).max(200).optional(),
  status_id: csv(z.uuid()).optional(),
  state_type: csv(z.enum(STATE_TYPES)).optional(),
  category_id: csv(z.uuid()).optional(),
  model_id: csv(z.uuid()).optional(),
  manufacturer_id: z.uuid().optional(),
  location_id: z.uuid().optional(),
  company_id: z.uuid().optional(),
  vendor_id: z.uuid().optional(),
  parent_asset_id: z.uuid().optional(),
  warranty_end_before: isoDate.optional(),
  warranty_end_after: isoDate.optional(),
  purchase_date_from: isoDate.optional(),
  purchase_date_to: isoDate.optional(),
  updated_since: z.iso
    .datetime({ offset: true })
    .refine((v) => new Date(v).getUTCFullYear() >= 1, 'year must be 1 or later')
    .optional(),
  expand: csv(z.enum(ASSET_EXPANDS)).optional(),
});
export type AssetListQuery = z.output<typeof assetListSchema>;

export const assetGetSchema = z.object({ expand: csv(z.enum(ASSET_EXPANDS)).optional() });

export const scanResolveSchema = z.object({ code: str().min(1).max(200) });

export const SEARCH_TYPES = ['asset', 'model', 'category', 'person', 'location'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
export const searchSchema = z.object({
  q: str().trim().min(1).max(200),
  types: csv(z.enum(SEARCH_TYPES)).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(5),
});
