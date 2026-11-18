import { apiRequest, setCsrfToken } from './http';
import type {
  AcceptInvitationRequest,
  InvitationInfo,
  LoginRequest,
  LoginResponse,
  Me,
  MfaEnrolment,
  MfaEnrolmentResult,
  MfaVerifyRequest,
  SessionInfo,
} from './types';

/**
 * Typed calls for the auth endpoints.
 *
 * In docs/engineering/openapi.yaml today:  POST /v1/auth/login, POST /v1/auth/logout,
 * GET /v1/auth/me, POST /v1/auth/mfa/verify.
 *
 * PROPOSED (the screens need them, the contract does not define them yet; the mock layer in
 * `src/mocks` implements exactly these shapes so the backend can align):
 *   POST   /v1/auth/password/forgot        { email }                      -> 202
 *   POST   /v1/auth/password/reset         { token, password }            -> 204
 *   GET    /v1/auth/invitations/{token}    -> InvitationInfo              (404 unknown, 410 expired)
 *   POST   /v1/auth/invitations/accept     AcceptInvitationRequest        -> LoginResponse
 *   POST   /v1/auth/mfa/enrol              -> MfaEnrolment                (secret + otpauth URI)
 *   POST   /v1/auth/mfa/enrol/confirm      { code }                       -> MfaEnrolmentResult
 *   GET    /v1/auth/sessions               -> { data: SessionInfo[] }
 *   DELETE /v1/auth/sessions/{id}          -> 204
 */
export const authApi = {
  async getMe(signal?: AbortSignal): Promise<Me> {
    const me = await apiRequest<Me>('GET', '/v1/auth/me', { expectUnauthorized: true, signal });
    setCsrfToken(me.csrf_token);
    return me;
  },

  async login(request: LoginRequest): Promise<LoginResponse> {
    const response = await apiRequest<LoginResponse>('POST', '/v1/auth/login', {
      body: request,
      expectUnauthorized: true,
    });
    if (response.csrf_token) setCsrfToken(response.csrf_token);
    return response;
  },

  async verifyMfa(request: MfaVerifyRequest): Promise<LoginResponse> {
    const response = await apiRequest<LoginResponse>('POST', '/v1/auth/mfa/verify', {
      body: request,
      expectUnauthorized: true,
    });
    if (response.csrf_token) setCsrfToken(response.csrf_token);
    return response;
  },

  async logout(): Promise<void> {
    try {
      await apiRequest<void>('POST', '/v1/auth/logout', { expectUnauthorized: true });
    } finally {
      setCsrfToken(undefined);
    }
  },

  forgotPassword(email: string): Promise<void> {
    return apiRequest<void>('POST', '/v1/auth/password/forgot', {
      body: { email },
      expectUnauthorized: true,
    });
  },

  resetPassword(token: string, password: string): Promise<void> {
    return apiRequest<void>('POST', '/v1/auth/password/reset', {
      body: { token, password },
      expectUnauthorized: true,
    });
  },

  getInvitation(token: string, signal?: AbortSignal): Promise<InvitationInfo> {
    return apiRequest<InvitationInfo>('GET', `/v1/auth/invitations/${encodeURIComponent(token)}`, {
      expectUnauthorized: true,
      signal,
    });
  },

  async acceptInvitation(request: AcceptInvitationRequest): Promise<LoginResponse> {
    const response = await apiRequest<LoginResponse>('POST', '/v1/auth/invitations/accept', {
      body: request,
      expectUnauthorized: true,
    });
    if (response.csrf_token) setCsrfToken(response.csrf_token);
    return response;
  },

  startMfaEnrolment(): Promise<MfaEnrolment> {
    return apiRequest<MfaEnrolment>('POST', '/v1/auth/mfa/enrol', { body: {} });
  },

  confirmMfaEnrolment(code: string): Promise<MfaEnrolmentResult> {
    return apiRequest<MfaEnrolmentResult>('POST', '/v1/auth/mfa/enrol/confirm', {
      body: { code },
    });
  },

  async listSessions(signal?: AbortSignal): Promise<SessionInfo[]> {
    const page = await apiRequest<{ data: SessionInfo[] }>('GET', '/v1/auth/sessions', { signal });
    return page.data;
  },

  revokeSession(id: string): Promise<void> {
    return apiRequest<void>('DELETE', `/v1/auth/sessions/${encodeURIComponent(id)}`);
  },
};
