/**
 * Auth wire types. Fields marked "contract" mirror docs/engineering/openapi.yaml
 * (`LoginRequest`, `LoginResponse`, `MfaVerifyRequest`, `Me`, `User`). Types under "proposed" are
 * endpoints the web needs that openapi.yaml does not define yet (see `auth-api.ts`).
 */

// ---- contract ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  display_name: string;
  status?: 'invited' | 'active' | 'disabled';
  locale?: string | null;
  timezone?: string | null;
  mfa_enabled?: boolean;
  last_login_at?: string | null;
}

export interface TenantChoice {
  slug: string;
  name: string;
}

export type MfaMethod = 'totp' | 'webauthn' | 'recovery_code';

export interface LoginRequest {
  email: string;
  password: string;
  tenant_slug?: string;
}

export interface LoginResponse {
  status: 'authenticated' | 'mfa_required' | 'tenant_selection_required';
  csrf_token?: string;
  mfa?: { challenge_id: string; methods: MfaMethod[] };
  tenants?: TenantChoice[];
  user?: User;
}

export interface MfaVerifyRequest {
  challenge_id: string;
  method: MfaMethod;
  code: string;
}

export interface Me {
  user: User;
  tenant: { id: string; name: string; plan?: string; base_currency: string; cell?: string };
  default_company_id?: string;
  permissions: string[];
  auth: { method: 'session' | 'api_key'; mfa_verified?: boolean };
  csrf_token?: string;
}

// ---- proposed (not in openapi.yaml yet) --------------------------------------------------

export interface InvitationInfo {
  email: string;
  display_name: string;
  tenant_name: string;
  role_name?: string;
  expires_at: string;
  /** The tenant requires MFA, so the new user must enrol right after setting a password. */
  mfa_enrolment_required: boolean;
}

export interface AcceptInvitationRequest {
  token: string;
  password: string;
  display_name: string;
}

export interface MfaEnrolment {
  /** Base32 shared secret, shown as a manual-entry fallback to the QR code. */
  secret: string;
  /** `otpauth://totp/...` provisioning URI that the QR code encodes. */
  provisioning_uri: string;
}

export interface MfaEnrolmentResult {
  /** Ten single-use recovery codes, shown exactly once. */
  recovery_codes: string[];
  /**
   * CSRF token of the NEW session: confirming enrolment rotates the session id (the user becomes
   * MFA-verified), so the token from login / `me` no longer matches.
   */
  csrf_token: string;
}

export interface SessionInfo {
  id: string;
  created_at: string;
  last_seen_at: string;
  ip: string;
  user_agent: string;
  current: boolean;
}
