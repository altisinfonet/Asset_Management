import type { Tx } from '../tenancy/index.js';
import { ADMIN_MARKER_PERMISSIONS } from './permissions.js';
import { type GrantedRole, permits } from './policy.service.js';

/** `app.tenant.settings.mfa_required`: who must enrol in MFA. Default `off`. */
export type MfaPolicy = 'off' | 'admins' | 'all';

export function parseMfaPolicy(settings: unknown): MfaPolicy {
  const value = (settings as { mfa_required?: unknown } | null)?.mfa_required;
  if (value === true || value === 'all') return 'all';
  if (value === 'admins') return 'admins';
  return 'off';
}

/** Does tenant policy require this user (holding these permissions) to have MFA? */
export function mfaRequired(policy: MfaPolicy, permissions: readonly string[]): boolean {
  if (policy === 'all') return true;
  if (policy === 'admins') return ADMIN_MARKER_PERMISSIONS.some((p) => permits(permissions, p));
  return false;
}

/** The roles a user holds, with their permission bundles (tenant transaction required). */
export async function loadGrants(trx: Tx, userId: string): Promise<GrantedRole[]> {
  const rows = await trx.role_assignment.findMany({
    where: { user_id: userId },
    include: { role: { select: { key: true, permissions: true } } },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => ({
    assignmentId: r.id,
    roleId: r.role_id,
    roleKey: r.role.key,
    permissions: r.role.permissions,
    scopeType: r.scope_type as GrantedRole['scopeType'],
    scopeCompanyId: r.scope_company_id,
    scopeLocationId: r.scope_location_id,
  }));
}

export async function loadMfaPolicy(trx: Tx, tenantId: string): Promise<MfaPolicy> {
  const tenant = await trx.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  return parseMfaPolicy(tenant?.settings);
}

export const lowerEmail = (email: string): string => email.trim().toLowerCase();

/** "acme.assettracker.test" with suffix "assettracker.test" gives "acme"; null for any other host or without a suffix. */
export function tenantSlugFromHost(
  host: string | undefined,
  suffix: string | undefined,
): string | null {
  if (!suffix || !host) return null;
  const name = host.split(':')[0]!.toLowerCase();
  const tail = `.${suffix.toLowerCase()}`;
  if (!name.endsWith(tail)) return null;
  const slug = name.slice(0, -tail.length);
  return slug && !slug.includes('.') ? slug : null;
}
