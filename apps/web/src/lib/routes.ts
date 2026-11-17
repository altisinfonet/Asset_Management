/**
 * Every in-app URL is built here (ADR-0002). Detail pages are fixed paths with a query string,
 * never `/assets/<id>`, because the static export can only prerender paths known at build time.
 */
export const routes = {
  login: '/login',
  dashboard: '/',
  assets: '/assets',
  assetView: (id: string) => `/assets/view?id=${encodeURIComponent(id)}`,
  /** Resolve a scanned tag or QR code to an asset (`/s/<code>` redirects here). */
  assetByCode: (code: string) => `/assets/view?code=${encodeURIComponent(code)}`,
  settings: (section: SettingsSection = 'organisation') => `/settings/${section}`,
} as const;

/** Settings sections that exist in M1. Keep in sync with `generateStaticParams` in settings/[section]. */
export const SETTINGS_SECTIONS = [
  'organisation',
  'users',
  'categories',
  'models',
  'fields',
  'status',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

const QR_PATH = /^\/s\/([A-Za-z0-9_-]+)\/?$/;

/** Extract the code from a QR deep link path (`/s/<code>`), or null. */
export function parseQrPath(pathname: string): string | null {
  return QR_PATH.exec(pathname)?.[1] ?? null;
}
