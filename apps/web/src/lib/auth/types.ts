import type { components } from '@assettracker/api-client';

/**
 * Auth wire types, taken from the generated contract (docs/engineering/openapi.yaml) so a contract
 * change that breaks the screens fails the typecheck.
 */
type Schemas = components['schemas'];

export type User = Schemas['User'];
export type TenantChoice = Schemas['TenantChoice'];
export type LoginRequest = Schemas['LoginRequest'];
export type LoginResponse = Schemas['LoginResponse'];
export type MfaVerifyRequest = Schemas['MfaVerifyRequest'];
export type MfaMethod = MfaVerifyRequest['method'];
export type Me = Schemas['Me'];
export type InvitationInfo = Schemas['InvitationInfo'];
export type AcceptInvitationRequest = Schemas['AcceptInvitationRequest'];
export type MfaEnrolment = Schemas['MfaEnrolment'];
/** Ten single-use recovery codes, shown exactly once. */
export type MfaEnrolmentResult = Schemas['MfaRecoveryCodes'];
export type SessionInfo = Schemas['SessionInfo'];
