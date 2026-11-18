import { MOCK_ACCOUNTS, MOCK_PASSWORD, MOCK_RECOVERY_CODES, MOCK_TENANTS } from './fixtures';

/**
 * In-memory state of the mock API, mirrored to `localStorage` so a full page load (which the
 * Playwright specs and a hard refresh both do) keeps the mock session, like an HttpOnly cookie
 * would. Mock-only: never part of the production bundle.
 */

export interface MockUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  permissions: string[];
  /** TOTP enrolled. */
  mfa: boolean;
  /** The tenant requires MFA and this user has not enrolled: the session starts limited. */
  mfaRequired?: boolean;
  /** Tenant policy enforces MFA for this (enrolled) user: `DELETE /v1/auth/mfa` is refused. */
  mfaPolicy?: boolean;
  tenantName: string;
}

export interface MockSession {
  id: string;
  email: string;
  csrf: string;
  mfaVerified: boolean;
  /** Authenticated, but blocked from everything except MFA enrolment and logout. */
  limited: boolean;
  createdAt: string;
}

export interface MockState {
  session?: MockSession;
  /** Password overrides (reset, invitation accept). */
  passwords: Record<string, string>;
  /** Accounts created by accepting an invitation. */
  users: Record<string, MockUser>;
  mfaEnrolled: string[];
  /** Accounts whose MFA was turned off through the API (overrides a seeded or enrolled factor). */
  mfaDisabled: string[];
  /** The current recovery-code set after an enrolment or a regeneration (default: the seed codes). */
  recoveryCodes?: string[];
  /** Failed re-authentications since the last success (the real API shares the login lockout). */
  reauthFailures: number;
  usedTokens: string[];
  usedRecoveryCodes: string[];
  revokedSessions: string[];
  challenges: Record<string, string>;
  pendingEnrolment: boolean;
}

const KEY = 'at-mock-state';

const ACME = MOCK_TENANTS[0].name;
const VIEWER_PERMISSIONS = ['asset:read', 'catalog:read', 'location:read', 'search:read'];

export const SEED_USERS: Record<string, MockUser> = {
  [MOCK_ACCOUNTS.owner]: {
    id: '0190a6b2-0000-7000-8000-000000000001',
    email: MOCK_ACCOUNTS.owner,
    display_name: 'Alice Owner',
    role: 'tenant_admin',
    permissions: ['*'],
    mfa: false,
    tenantName: ACME,
  },
  [MOCK_ACCOUNTS.mfaOwner]: {
    id: '0190a6b2-0000-7000-8000-000000000002',
    email: MOCK_ACCOUNTS.mfaOwner,
    display_name: 'Marco Secure',
    role: 'tenant_admin',
    permissions: ['*'],
    mfa: true,
    tenantName: ACME,
  },
  [MOCK_ACCOUNTS.mfaEnforced]: {
    id: '0190a6b2-0000-7000-8000-000000000008',
    email: MOCK_ACCOUNTS.mfaEnforced,
    display_name: 'Enzo Enforced',
    role: 'tenant_admin',
    permissions: ['*'],
    mfa: true,
    mfaPolicy: true,
    tenantName: ACME,
  },
  [MOCK_ACCOUNTS.viewer]: {
    id: '0190a6b2-0000-7000-8000-000000000003',
    email: MOCK_ACCOUNTS.viewer,
    display_name: 'Vera Viewer',
    role: 'viewer',
    permissions: VIEWER_PERMISSIONS,
    mfa: false,
    tenantName: ACME,
  },
  [MOCK_ACCOUNTS.manager]: {
    id: '0190a6b2-0000-7000-8000-000000000007',
    email: MOCK_ACCOUNTS.manager,
    display_name: 'Sam Lee',
    role: 'asset_manager',
    permissions: [
      'asset:*',
      'catalog:manage',
      'catalog:read',
      'location:read',
      'role:read',
      'search:read',
      'user:read',
    ],
    mfa: false,
    tenantName: ACME,
  },
  [MOCK_ACCOUNTS.locked]: {
    id: '0190a6b2-0000-7000-8000-000000000004',
    email: MOCK_ACCOUNTS.locked,
    display_name: 'Locked Out',
    role: 'viewer',
    permissions: VIEWER_PERMISSIONS,
    mfa: false,
    tenantName: ACME,
  },
  [MOCK_ACCOUNTS.multiTenant]: {
    id: '0190a6b2-0000-7000-8000-000000000005',
    email: MOCK_ACCOUNTS.multiTenant,
    display_name: 'Maya Multi',
    role: 'tenant_admin',
    permissions: ['*'],
    mfa: false,
    tenantName: ACME,
  },
  [MOCK_ACCOUNTS.mfaRequired]: {
    id: '0190a6b2-0000-7000-8000-000000000006',
    email: MOCK_ACCOUNTS.mfaRequired,
    display_name: 'Nina Newadmin',
    role: 'tenant_admin',
    permissions: ['*'],
    mfa: false,
    mfaRequired: true,
    tenantName: ACME,
  },
};

function fresh(): MockState {
  return {
    passwords: {},
    users: {},
    mfaEnrolled: [],
    mfaDisabled: [],
    reauthFailures: 0,
    usedTokens: [],
    usedRecoveryCodes: [],
    revokedSessions: [],
    challenges: {},
    pendingEnrolment: false,
  };
}

let memory: MockState | undefined;

export function loadState(): MockState {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      memory = { ...fresh(), ...(JSON.parse(raw) as Partial<MockState>) };
      return memory;
    }
  } catch {
    // storage unavailable: fall back to memory
  }
  memory ??= fresh();
  return memory;
}

export function saveState(state: MockState): void {
  memory = state;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage unavailable: memory only
  }
}

export function updateState(change: (state: MockState) => void): MockState {
  const state = loadState();
  change(state);
  saveState(state);
  return state;
}

const resetHooks = new Set<() => void>();

/** Other mock stores (the registry) register here so one reset clears everything. */
export function onMockReset(hook: () => void): void {
  resetHooks.add(hook);
}

/** Back to the seed data (unit tests call this between cases). */
export function resetMockState(): void {
  memory = undefined;
  for (const hook of resetHooks) hook();
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function findUser(email: string): MockUser | undefined {
  const state = loadState();
  const key = email.trim().toLowerCase();
  const base = state.users[key] ?? SEED_USERS[key];
  if (!base) return undefined;
  const mfa = !state.mfaDisabled.includes(key) && (base.mfa || state.mfaEnrolled.includes(key));
  return { ...base, mfa };
}

export function passwordFor(email: string): string | undefined {
  const key = email.trim().toLowerCase();
  const state = loadState();
  if (state.passwords[key]) return state.passwords[key];
  return SEED_USERS[key] ? MOCK_PASSWORD : undefined;
}

export function availableRecoveryCodes(): string[] {
  const { usedRecoveryCodes: used, recoveryCodes } = loadState();
  return (recoveryCodes ?? MOCK_RECOVERY_CODES).filter((code) => !used.includes(code));
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
