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
  assetView: (id: string, tab?: string) =>
    `/assets/view?id=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ''}`,
  /** Asset opened by a scan: the primary custody action takes focus (rapid desk workflow). */
  assetScanned: (id: string) => `/assets/view?id=${encodeURIComponent(id)}&scanned=1`,
  assetNew: '/assets/new',
  /** New asset prefilled from an existing one (everything but tag and serial). */
  assetClone: (id: string) => `/assets/new?clone=${encodeURIComponent(id)}`,
  assetEdit: (id: string) => `/assets/edit?id=${encodeURIComponent(id)}`,
  /** Resolve a scanned tag or QR code to an asset (`/s/<code>` redirects here). */
  assetByCode: (code: string) => `/assets/view?code=${encodeURIComponent(code)}`,
  /**
   * The asset list opened with a filter: a location (with its sublocations), a holder, a state
   * type (`state_type`), checked-out assets (`assigned=yes`) or the overdue ones (`overdue=1`).
   */
  assetsFiltered: ({
    location,
    department,
    person,
    stateType,
    assigned,
    overdue,
  }: {
    location?: string;
    department?: string;
    person?: string;
    stateType?: string;
    assigned?: boolean;
    overdue?: boolean;
  }) => {
    const params = new URLSearchParams();
    if (location) params.set('location', location);
    if (department) params.set('department', department);
    if (person) params.set('person', person);
    if (stateType) params.set('state_type', stateType);
    if (assigned) params.set('assigned', 'yes');
    if (overdue) params.set('overdue', '1');
    const query = params.toString();
    return query ? `/assets?${query}` : '/assets';
  },
  /** Locations tree, optionally with one location selected (`?id=`). */
  locations: (id?: string) => (id ? `/locations?id=${encodeURIComponent(id)}` : '/locations'),
  /** Accessories and consumables; `kind` picks the tab. */
  stock: (kind?: 'accessory' | 'consumable') => (kind ? `/stock?kind=${kind}` : '/stock'),
  stockView: (kind: 'accessory' | 'consumable', id: string, tab?: string) =>
    `/stock/view?kind=${kind}&id=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ''}`,
  /** Repair log; `id` opens one repair's drawer. */
  repairs: (id?: string) => (id ? `/repairs?id=${encodeURIComponent(id)}` : '/repairs'),
  notificationSettings: '/account/notifications',
  /** The asset list with the progress of a label batch open (the "labels ready" notification). */
  labelBatch: (id: string) => `/assets?label_batch=${encodeURIComponent(id)}`,
  /** The asset list with the progress of a CSV export open (the "export ready" notification). */
  exportJob: (id: string) => `/assets?export=${encodeURIComponent(id)}`,
  people: '/people',
  /** The people list opened with one department chosen (`?department=`). */
  peopleInDepartment: (id: string) => `/people?department=${encodeURIComponent(id)}`,
  personView: (id: string, tab?: string) =>
    `/people/view?id=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ''}`,
  settings: (section: SettingsSection = 'organisation') => `/settings/${section}`,
} as const;

/** Settings sections that exist in M1. Keep in sync with `generateStaticParams` in settings/[section]. */
export const SETTINGS_SECTIONS = [
  'organisation',
  'users',
  'categories',
  'models',
  'manufacturers',
  'fields',
  'status',
  'tags',
  'vendors',
  'departments',
  'notifications',
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
