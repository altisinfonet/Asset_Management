import { z } from 'zod';

const MIB = 1024 * 1024;

/** Default upload cap per tenant tier (M2-FILE-01: "size caps configurable per tenant tier"). */
export const TIER_MAX_BYTES: Readonly<Record<string, number>> = {
  free: 10 * MIB,
  starter: 25 * MIB,
  pro: 50 * MIB,
  enterprise: 100 * MIB,
  self_hosted: 100 * MIB,
};
const FALLBACK_MAX_BYTES = 10 * MIB;

/** `PUT /v1/settings/files` body: what a tenant administrator may change. */
export const filesSettingsSchema = z.strictObject({
  /** Re-encode every uploaded image without EXIF/GPS (the original object is replaced). */
  strip_exif_original: z.boolean(),
  /** Lower the upload cap below the tier default; null = the tier default. */
  max_upload_bytes: z.number().int().min(1024).max(2_147_483_647).nullable(),
});
export type FilesSettingsInput = z.output<typeof filesSettingsSchema>;

export interface FilesSettings extends FilesSettingsInput {
  /** The cap that applies: min(override ?? tier default, FILES_MAX_BYTES_CEILING). */
  effective_max_upload_bytes: number;
  tier_max_upload_bytes: number;
}

export const DEFAULT_FILES_SETTINGS: FilesSettingsInput = {
  strip_exif_original: false,
  max_upload_bytes: null,
};

/** Reads `app.tenant.settings.files` defensively (it is a free-form jsonb object). */
export function parseFilesSettings(raw: unknown): FilesSettingsInput {
  const parsed = filesSettingsSchema.safeParse(
    raw && typeof raw === 'object' ? { ...DEFAULT_FILES_SETTINGS, ...(raw as object) } : {},
  );
  return parsed.success ? parsed.data : DEFAULT_FILES_SETTINGS;
}

export function tierMaxBytes(plan: string): number {
  return TIER_MAX_BYTES[plan] ?? FALLBACK_MAX_BYTES;
}

export function effectiveMaxBytes(
  plan: string,
  settings: FilesSettingsInput,
  ceiling: number,
): number {
  const tier = tierMaxBytes(plan);
  const wanted =
    settings.max_upload_bytes === null ? tier : Math.min(settings.max_upload_bytes, tier);
  return Math.min(wanted, ceiling);
}

export function toFilesSettings(
  plan: string,
  settings: FilesSettingsInput,
  ceiling: number,
): FilesSettings {
  return {
    ...settings,
    effective_max_upload_bytes: effectiveMaxBytes(plan, settings, ceiling),
    tier_max_upload_bytes: Math.min(tierMaxBytes(plan), ceiling),
  };
}
