import type { components } from '@assettracker/api-client';
import { hasPermission } from '@/lib/auth/permissions';
import { MOCK_ROLES } from './registry-fixtures';
import { registry } from './registry-state';
import type { MockUser } from './state';

/**
 * Location scoping of role assignments (M2-LOC-03, ED-26), as the API does it: a principal whose
 * every role assignment is `scope_type: 'location'` only sees records inside the subtrees of those
 * locations (everything else is 404 / absent from lists), and a scoped grant never confers the
 * org-only permissions. Mock-only; never part of the production bundle.
 */

type RoleAssignment = components['schemas']['RoleAssignment'];

/** The permission catalogue of the API (`PERMISSIONS` in apps/api/src/auth/permissions.ts). */
const PERMISSIONS = [
  'accessory:checkout',
  'accessory:manage',
  'accessory:read',
  'apikey:manage',
  'asset:checkin',
  'asset:checkout',
  'asset:create',
  'asset:delete',
  'asset:label',
  'asset:read',
  'asset:transfer',
  'asset:update',
  'attachment:read',
  'attachment:write',
  'audit:read',
  'catalog:manage',
  'catalog:read',
  'company:read',
  'consumable:adjust',
  'consumable:manage',
  'consumable:read',
  'department:manage',
  'department:read',
  'export:run',
  'import:read',
  'import:run',
  'loaner:checkout',
  'loaner:manage',
  'loaner:read',
  'location:manage',
  'location:read',
  'notification:manage',
  'person:manage',
  'person:read',
  'repair:manage',
  'repair:read',
  'role:read',
  'search:read',
  'user:manage',
  'user:read',
  'view:share',
];

/** What a location-scoped assignment never grants (`ORG_ONLY_PERMISSIONS` of the API). */
export const ORG_ONLY_PERMISSIONS = [
  'apikey:manage',
  'audit:read',
  'catalog:manage',
  'department:manage',
  'notification:manage',
  'role:read',
  'user:manage',
  'user:read',
];

/** A signed-in mock principal with its effective permissions and location scope. */
export interface ScopedUser extends MockUser {
  /** null: org-wide. Otherwise the roots of the subtrees the principal is limited to. */
  locationScope: string[] | null;
}

/**
 * The effective permissions and scope of `user`, from the role assignments of its account in the
 * mock registry. An account with no location-scoped assignment keeps its seeded permissions.
 */
export function withScope(user: MockUser): ScopedUser {
  const record = registry().users.find((u) => u.id === user.id);
  const assignments: RoleAssignment[] = record?.role_assignments ?? [];
  if (!assignments.some((a) => a.scope_type === 'location')) {
    return { ...user, locationScope: null };
  }
  const permissions = new Set<string>();
  let roots: Set<string> | null = new Set();
  for (const a of assignments) {
    const role = MOCK_ROLES.find((r) => r.id === a.role_id);
    if (!role) continue;
    if (a.scope_type === 'location') {
      for (const p of PERMISSIONS) {
        if (!ORG_ONLY_PERMISSIONS.includes(p) && hasPermission(role.permissions, p)) {
          permissions.add(p);
        }
      }
      if (a.location_id) roots?.add(a.location_id);
    } else {
      for (const p of role.permissions) permissions.add(p);
      roots = null;
    }
  }
  return {
    ...user,
    permissions: [...permissions].sort(),
    locationScope: roots ? [...roots].sort() : null,
  };
}

/** True when `locationId` lies inside one of the scope subtrees (always true for org-wide). */
export function inScope(scope: string[] | null, locationId: string | null | undefined): boolean {
  if (scope === null) return true;
  if (!locationId) return false;
  const location = registry().locations.find((l) => l.id === locationId);
  return !!location && scope.some((root) => location.ancestor_ids?.includes(root));
}

/** `location_scope` of `GET /v1/auth/me`: null for org-wide, else the roots with their paths. */
export function locationScopeView(scope: string[] | null) {
  if (scope === null) return null;
  const all = registry().locations;
  const name = (id: string) => all.find((l) => l.id === id)?.name ?? '?';
  return {
    locations: scope
      .flatMap((id) => {
        const location = all.find((l) => l.id === id);
        return location
          ? [
              {
                id,
                name: location.name,
                path: (location.ancestor_ids ?? [id]).map(name).join(' / '),
              },
            ]
          : [];
      })
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export interface ScopeFieldError {
  pointer: string;
  message: string;
  code: string;
}

/**
 * The API's checks on the location of a write by a scoped principal: a location outside the scope
 * is `not-found`; none at all is `required` when creating (or when clearing it with `null`).
 */
export function scopedLocationErrors(
  scope: string[] | null,
  value: unknown,
  pointer: string,
  creating: boolean,
  message = 'A location inside your scope is required.',
): ScopeFieldError[] {
  if (scope === null) return [];
  if (typeof value === 'string' && value) {
    return inScope(scope, value)
      ? []
      : [{ pointer, message: 'No such location.', code: 'not-found' }];
  }
  if (creating || value === null) return [{ pointer, message, code: 'required' }];
  return [];
}
