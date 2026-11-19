import { describe, expect, it } from 'vitest';
import {
  TIER_MAX_BYTES,
  effectiveMaxBytes,
  filesSettingsSchema,
  parseFilesSettings,
  tierMaxBytes,
  toFilesSettings,
} from './settings.js';

const MIB = 1024 * 1024;

describe('per-tenant file settings (M2-FILE-01 caps by tier, M2-FILE-03 EXIF option)', () => {
  it('every plan has a tier cap; an unknown plan gets the smallest', () => {
    for (const plan of ['free', 'starter', 'pro', 'enterprise', 'self_hosted']) {
      expect(TIER_MAX_BYTES[plan]).toBeGreaterThan(0);
    }
    expect(tierMaxBytes('free')).toBe(10 * MIB);
    expect(tierMaxBytes('weird')).toBe(10 * MIB);
    expect(tierMaxBytes('pro')).toBeGreaterThan(tierMaxBytes('starter'));
  });

  it('the override can only lower the tier cap, and the deployment ceiling always wins', () => {
    const none = { strip_exif_original: false, max_upload_bytes: null };
    expect(effectiveMaxBytes('pro', none, 1000 * MIB)).toBe(50 * MIB);
    expect(effectiveMaxBytes('pro', { ...none, max_upload_bytes: 5 * MIB }, 1000 * MIB)).toBe(
      5 * MIB,
    );
    expect(effectiveMaxBytes('pro', { ...none, max_upload_bytes: 900 * MIB }, 1000 * MIB)).toBe(
      50 * MIB,
    );
    expect(effectiveMaxBytes('enterprise', none, 20 * MIB)).toBe(20 * MIB);
  });

  it('reads tenant settings defensively', () => {
    expect(parseFilesSettings(undefined)).toEqual({
      strip_exif_original: false,
      max_upload_bytes: null,
    });
    expect(parseFilesSettings('garbage')).toEqual({
      strip_exif_original: false,
      max_upload_bytes: null,
    });
    expect(parseFilesSettings({ strip_exif_original: 'yes' })).toEqual({
      strip_exif_original: false,
      max_upload_bytes: null,
    });
    expect(parseFilesSettings({ strip_exif_original: true })).toEqual({
      strip_exif_original: true,
      max_upload_bytes: null,
    });
  });

  it('the update schema is strict and bounded', () => {
    expect(
      filesSettingsSchema.safeParse({ strip_exif_original: true, max_upload_bytes: null }).success,
    ).toBe(true);
    expect(
      filesSettingsSchema.safeParse({ strip_exif_original: true, max_upload_bytes: 10 }).success,
    ).toBe(false);
    expect(
      filesSettingsSchema.safeParse({ strip_exif_original: true, max_upload_bytes: null, x: 1 })
        .success,
    ).toBe(false);
    expect(filesSettingsSchema.safeParse({ max_upload_bytes: null }).success).toBe(false);
  });

  it('the view reports tier and effective caps', () => {
    expect(
      toFilesSettings(
        'starter',
        { strip_exif_original: true, max_upload_bytes: 1 * MIB },
        100 * MIB,
      ),
    ).toEqual({
      strip_exif_original: true,
      max_upload_bytes: 1 * MIB,
      effective_max_upload_bytes: 1 * MIB,
      tier_max_upload_bytes: 25 * MIB,
    });
  });
});
