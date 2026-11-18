import type { FieldOption } from './custom-fields.js';

/** Row -> API object mappers (openapi schemas Category, Manufacturer, AssetModel, ...). */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const isoDate = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

interface Stamped {
  id: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}
const stamps = (r: Stamped) => ({
  id: r.id,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
  archived_at: iso(r.archived_at),
});

export const categoryDto = (
  r: Stamped & {
    name: string;
    kind: string;
    tag_prefix: string | null;
    description: string | null;
  },
) => ({
  ...stamps(r),
  name: r.name,
  kind: r.kind,
  tag_prefix: r.tag_prefix,
  description: r.description,
});

export const manufacturerDto = (
  r: Stamped & {
    name: string;
    url: string | null;
    support_url: string | null;
    support_email: string | null;
    support_phone: string | null;
    notes: string | null;
  },
) => ({
  ...stamps(r),
  name: r.name,
  url: r.url,
  support_url: r.support_url,
  support_email: r.support_email,
  support_phone: r.support_phone,
  notes: r.notes,
});

export const vendorDto = (
  r: Stamped & {
    name: string;
    contact_name: string | null;
    contact_email: string | null;
    phone: string | null;
    url: string | null;
    address: string | null;
    notes: string | null;
  },
) => ({
  ...stamps(r),
  name: r.name,
  contact_name: r.contact_name,
  contact_email: r.contact_email,
  phone: r.phone,
  url: r.url,
  address: r.address,
  notes: r.notes,
});

export const modelDto = (
  r: Stamped & {
    category_id: string;
    manufacturer_id: string | null;
    name: string;
    model_number: string | null;
    default_depreciation_months: number | null;
    eol_date: Date | null;
    notes: string | null;
  },
) => ({
  ...stamps(r),
  category_id: r.category_id,
  manufacturer_id: r.manufacturer_id,
  name: r.name,
  model_number: r.model_number,
  default_depreciation_months: r.default_depreciation_months,
  eol_date: isoDate(r.eol_date),
  notes: r.notes,
});

export const statusLabelDto = (
  r: Stamped & {
    name: string;
    state_type: string;
    color: string | null;
    description: string | null;
    position: number;
    is_default: boolean;
  },
) => ({
  ...stamps(r),
  name: r.name,
  state_type: r.state_type,
  color: r.color,
  description: r.description,
  position: r.position,
  is_default: r.is_default,
});

export const customFieldDto = (
  r: Stamped & {
    category_id: string | null;
    key: string;
    label: string;
    data_type: string;
    required: boolean;
    options: unknown;
    validation: unknown;
    help_text: string | null;
    position: number;
    show_in_list: boolean;
  },
) => ({
  ...stamps(r),
  category_id: r.category_id,
  key: r.key,
  label: r.label,
  data_type: r.data_type,
  required: r.required,
  options: normaliseOptions(r.options),
  validation: (r.validation as Record<string, unknown> | null) ?? null,
  help_text: r.help_text,
  position: r.position,
  show_in_list: r.show_in_list,
});

/**
 * Options are stored as `[{value, label?}]`. Rows written by earlier seeds hold plain strings;
 * they read back in the canonical shape.
 */
export function normaliseOptions(raw: unknown): FieldOption[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((o): FieldOption[] => {
    if (typeof o === 'string') return [{ value: o, label: o }];
    if (o && typeof o === 'object' && typeof (o as { value?: unknown }).value === 'string') {
      const { value, label } = o as { value: string; label?: unknown };
      return [typeof label === 'string' ? { value, label } : { value }];
    }
    return [];
  });
}
