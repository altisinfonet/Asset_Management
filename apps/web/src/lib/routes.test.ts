import { describe, expect, it } from 'vitest';
import { isSettingsSection, parseQrPath, routes, SETTINGS_SECTIONS } from './routes';

describe('routes', () => {
  it('builds query-string detail routes (ADR-0002), never path ids', () => {
    expect(routes.assetView('0190a6b2-7c3e')).toBe('/assets/view?id=0190a6b2-7c3e');
    expect(routes.assetByCode('AB 12')).toBe('/assets/view?code=AB%2012');
    expect(routes.settings('users')).toBe('/settings/users');
  });

  it('parses QR deep links', () => {
    expect(parseQrPath('/s/AB12CD34')).toBe('AB12CD34');
    expect(parseQrPath('/s/AB12CD34/')).toBe('AB12CD34');
    expect(parseQrPath('/s/')).toBeNull();
    expect(parseQrPath('/assets/view')).toBeNull();
  });

  it('knows the settings sections', () => {
    for (const s of SETTINGS_SECTIONS) expect(isSettingsSection(s)).toBe(true);
    expect(isSettingsSection('nope')).toBe(false);
  });
});
