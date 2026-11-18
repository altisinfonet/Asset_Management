/** Why the user landed on the login screen (shown as a banner). */
export type LoginReason = 'expired' | 'signed_out' | 'password_reset';

/**
 * Every in-app URL is built here (ADR-0002). Detail pages are fixed paths with a query string,
 * never `/assets/<id>`, because the static export can only prerender paths known at build time.
 */
export const routes = {
  login: '/login',
  /** Login with a post-login destination (`next`) and/or the reason the user is here. */
  loginWith: ({ next, reason }: { next?: string; reason?: LoginReason } = {}) => {
    const params = new URLSearchParams();
    if (reason) params.set('reason', reason);
    if (next && next !== '/') params.set('next', next);
    const query = params.toString();
    return query ? `/login?${query}` : '/login';
  },
  forgotPassword: '/forgot-password',
  resetPassword: (token: string) => `/reset-password?token=${encodeURIComponent(token)}`,
  invitation: (token: string) => `/invitation?token=${encodeURIComponent(token)}`,
  /** MFA enrolment (QR + recovery codes); `next` is where to go afterwards. */
  mfaEnrol: (next?: string) =>
    next && next !== '/' ? `/mfa/enroll?next=${encodeURIComponent(next)}` : '/mfa/enroll',
  security: '/account/security',
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
