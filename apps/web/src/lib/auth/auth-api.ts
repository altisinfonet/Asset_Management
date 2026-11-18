import { getApi } from '@/lib/api';
import { setCsrfToken } from './http';
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
 * Typed calls for the auth endpoints, all through the generated client (`getApi().http`): paths,
 * bodies and responses are checked against docs/engineering/openapi.yaml, and the client adds the
 * CSRF header, an idempotency key and turns failures into `ApiError`s.
 *
 * `confirmMfaEnrolment` rotates the session: the response carries the new `csrf_token`, stored here
 * before the next mutation.
 */
const http = () => getApi().http;

export const authApi = {
  async getMe(signal?: AbortSignal): Promise<Me> {
    const { data } = await http().GET('/v1/auth/me', { signal });
    const me = data as Me;
    setCsrfToken(me.csrf_token);
    return me;
  },

  async login(request: LoginRequest): Promise<LoginResponse> {
    const { data } = await http().POST('/v1/auth/login', { body: request });
    const response = data as LoginResponse;
    if (response.csrf_token) setCsrfToken(response.csrf_token);
    return response;
  },

  async verifyMfa(request: MfaVerifyRequest): Promise<LoginResponse> {
    const { data } = await http().POST('/v1/auth/mfa/verify', { body: request });
    const response = data as LoginResponse;
    if (response.csrf_token) setCsrfToken(response.csrf_token);
    return response;
  },

  async logout(): Promise<void> {
    try {
      await http().POST('/v1/auth/logout');
    } finally {
      setCsrfToken(undefined);
    }
  },

  async forgotPassword(email: string): Promise<void> {
    await http().POST('/v1/auth/password/forgot', { body: { email } });
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await http().POST('/v1/auth/password/reset', { body: { token, password } });
  },

  async getInvitation(token: string, signal?: AbortSignal): Promise<InvitationInfo> {
    const { data } = await http().GET('/v1/auth/invitations/{token}', {
      params: { path: { token } },
      signal,
    });
    return data as InvitationInfo;
  },

  async acceptInvitation(request: AcceptInvitationRequest): Promise<LoginResponse> {
    const { data } = await http().POST('/v1/auth/invitations/accept', { body: request });
    const response = data as LoginResponse;
    if (response.csrf_token) setCsrfToken(response.csrf_token);
    return response;
  },

  async startMfaEnrolment(): Promise<MfaEnrolment> {
    const { data } = await http().POST('/v1/auth/mfa/enrol');
    return data as MfaEnrolment;
  },

  async confirmMfaEnrolment(code: string): Promise<MfaEnrolmentResult> {
    const { data } = await http().POST('/v1/auth/mfa/enrol/confirm', { body: { code } });
    const result = data as MfaEnrolmentResult;
    // Becoming MFA-verified rotates the session; the old CSRF token is dead.
    setCsrfToken(result.csrf_token);
    return result;
  },

  async listSessions(signal?: AbortSignal): Promise<SessionInfo[]> {
    const { data } = await http().GET('/v1/auth/sessions', { signal });
    return (data as { data: SessionInfo[] }).data;
  },

  async revokeSession(id: string): Promise<void> {
    await http().DELETE('/v1/auth/sessions/{id}', { params: { path: { id } } });
  },
};
