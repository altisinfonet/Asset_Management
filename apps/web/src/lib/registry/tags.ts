export interface TagTemplate {
  prefix: string;
  width: number;
  use_category_prefix: boolean;
}

/** The numbering template a tenant starts with (same defaults as the API). */
export const DEFAULT_TAG_TEMPLATE: TagTemplate = {
  prefix: '',
  width: 5,
  use_category_prefix: true,
};

/**
 * The generated tag for counter `n`: template prefix, then the category prefix (when the template
 * asks for it), then the zero-padded counter (`AT-LAP-00042`). Mirrors the API's `formatAssetTag`.
 */
export function formatTag(
  template: TagTemplate,
  categoryPrefix: string | null | undefined,
  n: number,
): string {
  const category = template.use_category_prefix ? (categoryPrefix ?? '') : '';
  return `${template.prefix}${category}${String(n).padStart(template.width, '0')}`;
}
