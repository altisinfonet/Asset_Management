import { Injectable } from '@nestjs/common';
import { WILDCARD } from './permissions.js';

/** One role granted to a user, with its scope. Only `tenant` scope is enforced in M1; the others are ready for M2. */
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
    for (const g of subject.grants) for (const p of g.permissions) all.add(p);
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
      if (!permits(g.permissions, permission)) continue;
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
