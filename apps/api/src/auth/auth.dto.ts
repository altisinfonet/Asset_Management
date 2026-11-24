import type { GrantedRole } from './policy.service.js';

/** Response shapes of docs/engineering/openapi.yaml (`User`, `RoleAssignment`, `Me`, `SessionInfo`, `LoginResponse`). */

export interface RoleAssignmentDto {
  id: string;
  role_id: string;
  scope_type: 'tenant' | 'company' | 'location';
  company_id: string | null;
  location_id: string | null;
}

export const roleAssignmentDto = (g: GrantedRole): RoleAssignmentDto => ({
  id: g.assignmentId,
  role_id: g.roleId,
  scope_type: g.scopeType,
  company_id: g.scopeCompanyId,
  location_id: g.scopeLocationId,
});

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  status: string;
  locale: string | null;
  timezone: string | null;
  mfa_enabled: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

/** `personId`: the person record of the login (M2-USR-03); null where the caller has no tenant transaction at hand (login responses). */
export const userDto = (
  u: UserRow,
  grants: readonly GrantedRole[],
  personId: string | null = null,
) => ({
  id: u.id,
  created_at: u.created_at.toISOString(),
  updated_at: u.updated_at.toISOString(),
  archived_at: u.archived_at ? u.archived_at.toISOString() : null,
  email: u.email,
  display_name: u.display_name,
  status: u.status,
  locale: u.locale,
  timezone: u.timezone,
  role_assignments: grants.map(roleAssignmentDto),
  mfa_enabled: u.mfa_enabled,
  last_login_at: u.last_login_at ? u.last_login_at.toISOString() : null,
  person_id: personId,
});

export type UserDto = ReturnType<typeof userDto>;

export interface SessionInfoDto {
  id: string;
  created_at: string;
  last_seen_at: string;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
}

export type LoginResponseDto =
  | { status: 'authenticated'; csrf_token: string; user: UserDto }
  | { status: 'mfa_required'; mfa: { challenge_id: string; methods: string[] } }
  | { status: 'tenant_selection_required'; tenants: Array<{ slug: string; name: string }> };
