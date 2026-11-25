import { Injectable } from '@nestjs/common';
import { ORG_ONLY_PERMISSIONS, PERMISSIONS, WILDCARD } from './permissions.js';

/**
 * One role granted to a user, with its scope. `tenant` and `location` scopes are enforced
 * (M2-LOC-03, ED-26); a `company` scope behaves like `tenant` until company scoping ships.
 */
export interface GrantedRole {
  assignmentId: string;
  roleId: string;
  roleKey: string;
  permissions: readonly string[];
  scopeType: 'tenant' | 'company' | 'location';
  scopeCompanyId: string | null;
  scopeLocationId: string | null;
}

/** What the caller wants to touch; omitted = "does the principal hold this permission anywhere?". */
export interface PolicyResource {
  companyId?: string | null;
  /** The location and every ancestor of it (`location.ancestor_ids` plus its own id): ED-07. */
  locationAndAncestorIds?: readonly string[];
}

export interface PolicySubject {
  grants: readonly GrantedRole[];
  /** API keys: the key's scopes bound the principal (intersection with the grants). */
  keyScopes?: readonly string[] | null;
}

/**
 * The permissions a grant really confers. A location-scoped grant never confers the org-only
 * permissions (users, roles, API keys, audit log, catalogue and department management, notification
 * rules: tenant-wide things a subtree cannot bound, ED-26), so its wildcards are expanded over the
 * catalogue without them. Other grants confer their list as stored.
 */
export function grantPermissions(
  g: Pick<GrantedRole, 'permissions' | 'scopeType'>,
): readonly string[] {
  if (g.scopeType !== 'location') return g.permissions;
  return PERMISSIONS.filter((p) => !ORG_ONLY_PERMISSIONS.includes(p) && permits(g.permissions, p));
}

/**
 * The location scope of a request that needs `permission` (M2-LOC-03, ED-26): `null` (not limited)
 * when ANY grant giving the permission is tenant- or company-wide, otherwise the root location ids
 * of the location-scoped grants that give it. `permission` undefined (self-service / authenticated
 * routes) asks about the principal as a whole: limited unless one grant is org-wide.
 */
export function locationScopeFor(
  grants: readonly GrantedRole[],
  permission?: string,
): string[] | null {
  const roots = new Set<string>();
  for (const g of grants) {
    if (permission !== undefined && !permits(grantPermissions(g), permission)) continue;
    if (g.scopeType !== 'location') return null;
    if (g.scopeLocationId) roots.add(g.scopeLocationId);
  }
  return [...roots].sort();
}

/** Does a permission list (with `*` and `resource:*` wildcards) grant `permission`? */
export function permits(granted: readonly string[], permission: string): boolean {
  if (granted.includes(WILDCARD) || granted.includes(permission)) return true;
  const resource = permission.split(':')[0];
  return granted.includes(`${resource}:*`);
}

/** True when every permission in `wanted` is granted by `granted` (no privilege escalation). */
export function isSubset(wanted: readonly string[], granted: readonly string[]): boolean {
  if (granted.includes(WILDCARD)) return true;
  if (wanted.includes(WILDCARD)) return false;
  return wanted.every((p) => permits(granted, p));
}

/**
 * The only authorisation entry point (M1-AUTH-01): `PolicyService.can(subject, permission, resource)`.
 * Controllers declare the permission they need with `@RequirePermission`; the auth guard calls
 * `can` before the handler runs, and repositories call it again with a resource when they apply
 * location scoping (ED-07: scope is enforced by the repository layer, RLS stays tenant-only).
 */
@Injectable()
export class PolicyService {
  /** Union of the permissions of every grant (what `GET /v1/auth/me` reports), bounded by key scopes. */
  effectivePermissions(subject: PolicySubject): string[] {
    const all = new Set<string>();
    for (const g of subject.grants) for (const p of grantPermissions(g)) all.add(p);
    if (!subject.keyScopes) return [...all].sort();
    // A key can never exceed its creator: keep only scopes the grants permit.
    const granted = [...all];
    return subject.keyScopes.filter((s) => permits(granted, s)).sort();
  }

  can(subject: PolicySubject, permission: string, resource?: PolicyResource): boolean {
    if (subject.keyScopes) {
      const grantedAnywhere = this.grantsFor(subject, permission, undefined);
      if (!grantedAnywhere) return false;
      if (!permits(subject.keyScopes, permission)) return false;
    }
    return this.grantsFor(subject, permission, resource);
  }

  private grantsFor(
    subject: PolicySubject,
    permission: string,
    resource: PolicyResource | undefined,
  ): boolean {
    for (const g of subject.grants) {
      if (!permits(grantPermissions(g), permission)) continue;
      if (g.scopeType === 'tenant') return true;
      // A scoped grant satisfies a route-level check (no resource): the repository narrows the data.
      if (!resource) return true;
      if (
        g.scopeType === 'company' &&
        resource.companyId &&
        resource.companyId === g.scopeCompanyId
      ) {
        return true;
      }
      if (
        g.scopeType === 'location' &&
        g.scopeLocationId &&
        resource.locationAndAncestorIds?.includes(g.scopeLocationId)
      ) {
        return true;
      }
    }
    return false;
  }

  /** May `actor` hand out a role with these permissions? A grantor can never give more than it holds. */
  canGrantRole(actor: PolicySubject, rolePermissions: readonly string[]): boolean {
    return isSubset(rolePermissions, this.effectivePermissions(actor));
  }

  /** May `actor` change a user who currently holds these permissions? Not a more privileged one. */
  canManageUserWith(actor: PolicySubject, targetPermissions: readonly string[]): boolean {
    return isSubset(targetPermissions, this.effectivePermissions(actor));
  }
}
