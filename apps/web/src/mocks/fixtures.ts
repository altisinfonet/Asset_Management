/**
 * Accounts, codes and tokens of the mock API. Dependency-free on purpose: unit tests, the
 * Playwright specs and the dev UI all import this one file, so the demo credentials live in
 * exactly one place. Mock-only; none of this exists in the production bundle.
 */

export const MOCK_PASSWORD = 'correct horse battery staple';
/** The mock accepts this TOTP code for every account (and for enrolment). */
export const MOCK_TOTP_CODE = '123456';
export const MOCK_SECRET = 'JBSWY3DPEHPK3PXP';

export const MOCK_RECOVERY_CODES = ['RCVR-1111-AAAA', 'RCVR-2222-BBBB', 'RCVR-3333-CCCC'];
export const MOCK_NEW_RECOVERY_CODES = [
  'K7QD-4M2X',
  'P9TR-8WLC',
  'H3NB-6VZE',
  'X5JF-2YAG',
  'D8UM-7SKQ',
  'R4CW-9BTH',
  'L2EA-5NPV',
  'Z6GS-3DXJ',
  'T1OY-8FRM',
  'B9KI-4CQU',
];

export const MOCK_ACCOUNTS = {
  /** Owner, no MFA: login goes straight to the dashboard. */
  owner: 'alice@example.org',
  /** Owner with TOTP enrolled: login asks for a code (123456) or a recovery code. */
  mfaOwner: 'mfa@example.org',
  /** Asset Manager: manages assets and the catalogue, but cannot see Users. */
  manager: 'manager@example.org',
  /** Read-only role: no Settings in the navigation, 403 screens on admin pages. */
  viewer: 'viewer@example.org',
  /** Answers 429 with `Retry-After: 90`. */
  locked: 'locked@example.org',
  /** Exists in two organisations: login answers `tenant_selection_required`. */
  multiTenant: 'multi@example.org',
  /** The organisation requires MFA: after login the session is limited until enrolment. */
  mfaRequired: 'needs-mfa@example.org',
} as const;

export const MOCK_TENANTS = [
  { slug: 'acme-schools', name: 'Acme Schools' },
  { slug: 'globex-clinics', name: 'Globex Clinics' },
] as const;

export const MOCK_INVITATIONS = {
  valid: 'inv-valid',
  /** The organisation requires MFA, so accepting leads to the enrolment screen. */
  mfaRequired: 'inv-mfa',
  expired: 'inv-expired',
} as const;

export const MOCK_RESET_TOKENS = {
  valid: 'reset-valid',
  expired: 'reset-expired',
} as const;

/** A password the mock rejects as breached (server-side validation example). */
export const MOCK_BREACHED_PASSWORD = 'password1234';
