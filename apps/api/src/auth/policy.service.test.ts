import { describe, expect, it } from 'vitest';
import { BUILTIN_ROLES, ORG_ONLY_PERMISSIONS, PERMISSIONS } from './permissions.js';
import {
  type GrantedRole,
  PolicyService,
  grantPermissions,
  isSubset,
  locationScopeFor,
  permits,
} from './policy.service.js';

const policy = new PolicyService();

const grant = (permissions: string[], scope: Partial<GrantedRole> = {}): GrantedRole => ({
  assignmentId: crypto.randomUUID(),
  roleId: crypto.randomUUID(),
  roleKey: 'r',
  permissions,
  scopeType: 'tenant',
  scopeCompanyId: null,
  scopeLocationId: null,
  ...scope,
});

describe('permits', () => {
  it('honours *, exact permissions and resource wildcards', () => {
    expect(permits(['*'], 'asset:delete')).toBe(true);
    expect(permits(['asset:read'], 'asset:read')).toBe(true);
    expect(permits(['asset:read'], 'asset:delete')).toBe(false);
    expect(permits(['asset:*'], 'asset:delete')).toBe(true);
    expect(permits(['asset:*'], 'user:manage')).toBe(false);
    expect(permits([], 'asset:read')).toBe(false);
  });
});

describe('PolicyService.can (tenant scope)', () => {
  it('is the union of the roles held', () => {
    const subject = { grants: [grant(['asset:read']), grant(['user:read'])] };
    expect(policy.can(subject, 'asset:read')).toBe(true);
    expect(policy.can(subject, 'user:read')).toBe(true);
    expect(policy.can(subject, 'user:manage')).toBe(false);
    expect(policy.effectivePermissions(subject)).toEqual(['asset:read', 'user:read']);
  });

  it('denies a principal without grants', () => {
    expect(policy.can({ grants: [] }, 'search:read')).toBe(false);
  });
});

describe('PolicyService.can (scope-ready for M2)', () => {
  const company = crypto.randomUUID();
  const location = crypto.randomUUID();
  const child = crypto.randomUUID();
  const subject = {
    grants: [
      grant(['asset:read'], { scopeType: 'company', scopeCompanyId: company }),
      grant(['asset:update'], { scopeType: 'location', scopeLocationId: location }),
    ],
  };

  it('a scoped grant satisfies a route-level check (the repository narrows the rows)', () => {
    expect(policy.can(subject, 'asset:read')).toBe(true);
    expect(policy.can(subject, 'asset:update')).toBe(true);
    expect(policy.can(subject, 'asset:delete')).toBe(false);
  });

  it('a company-scoped grant covers only that company', () => {
    expect(policy.can(subject, 'asset:read', { companyId: company })).toBe(true);
    expect(policy.can(subject, 'asset:read', { companyId: crypto.randomUUID() })).toBe(false);
  });

  it('a location-scoped grant covers the location subtree through ancestor ids (ED-07)', () => {
    expect(policy.can(subject, 'asset:update', { locationAndAncestorIds: [child, location] })).toBe(
      true,
    );
    expect(policy.can(subject, 'asset:update', { locationAndAncestorIds: [child] })).toBe(false);
    expect(policy.can(subject, 'asset:update', {})).toBe(false);
  });

  it('a tenant-scoped grant covers any resource', () => {
    const s = { grants: [grant(['asset:update'])] };
    expect(policy.can(s, 'asset:update', { locationAndAncestorIds: [child] })).toBe(true);
  });
});

describe('API key scopes', () => {
  const admin = { grants: [grant(['*'])] };

  it('are bounded by the key scopes AND the creator', () => {
    const key = { ...admin, keyScopes: ['asset:read'] };
    expect(policy.can(key, 'asset:read')).toBe(true);
    expect(policy.can(key, 'asset:delete')).toBe(false);
    expect(policy.can(key, 'user:manage')).toBe(false);
    const demoted = { grants: [grant(['asset:read'])], keyScopes: ['asset:read', 'user:manage'] };
    expect(policy.can(demoted, 'user:manage')).toBe(false); // the creator lost it
    expect(policy.effectivePermissions(demoted)).toEqual(['asset:read']);
  });
});

describe('privilege escalation guards', () => {
  const byKey = (key: string) => BUILTIN_ROLES.find((r) => r.key === key)!.permissions;

  it('a grantor can never hand out more than it holds', () => {
    const admin = { grants: [grant(['*'])] };
    const manager = { grants: [grant([...byKey('asset_manager'), 'user:manage'])] };
    expect(policy.canGrantRole(admin, ['*'])).toBe(true);
    expect(policy.canGrantRole(admin, byKey('viewer'))).toBe(true);
    expect(policy.canGrantRole(manager, byKey('viewer'))).toBe(true);
    expect(policy.canGrantRole(manager, ['*'])).toBe(false);
    expect(policy.canGrantRole(manager, byKey('technician'))).toBe(true);
    expect(policy.canGrantRole({ grants: [grant(['user:manage'])] }, ['asset:read'])).toBe(false);
  });

  it('a manager cannot manage a user who holds permissions the manager lacks', () => {
    const manager = { grants: [grant(['user:manage', 'user:read'])] };
    expect(policy.canManageUserWith(manager, ['user:read'])).toBe(true);
    expect(policy.canManageUserWith(manager, ['*'])).toBe(false);
    expect(policy.canManageUserWith(manager, ['asset:read'])).toBe(false);
  });

  it('isSubset treats * as the top', () => {
    expect(isSubset(['*'], ['*'])).toBe(true);
    expect(isSubset(['*'], ['asset:*'])).toBe(false);
    expect(isSubset(['asset:read'], ['asset:*'])).toBe(true);
    expect(isSubset([], [])).toBe(true);
  });
});

describe('location scoping (M2-LOC-03, ED-26)', () => {
  const school = crypto.randomUUID();
  const otherSchool = crypto.randomUUID();
  const at = (permissions: string[], locationId: string) =>
    grant(permissions, { scopeType: 'location', scopeLocationId: locationId });

  it('a location-scoped grant never confers the org-only permissions, even through *', () => {
    const scopedAdmin = { grants: [at(['*'], school)] };
    for (const p of ORG_ONLY_PERMISSIONS) expect(policy.can(scopedAdmin, p), p).toBe(false);
    expect(policy.can(scopedAdmin, 'asset:checkout')).toBe(true);
    expect(policy.can(scopedAdmin, 'location:manage')).toBe(true);
    const effective = policy.effectivePermissions(scopedAdmin);
    expect(effective).not.toContain('*');
    expect(effective).toEqual(PERMISSIONS.filter((p) => !ORG_ONLY_PERMISSIONS.includes(p)).sort());
    expect(grantPermissions(at(['catalog:*', 'catalog:read'], school))).toEqual(['catalog:read']);
  });

  it('the same permission through an org-wide grant still works', () => {
    const mixed = { grants: [at(['*'], school), grant(['user:read'])] };
    expect(policy.can(mixed, 'user:read')).toBe(true);
    expect(policy.can(mixed, 'user:manage')).toBe(false);
  });

  it('the scope of a request is the union of the scoped grants that give its permission', () => {
    const technicianHere = at(['asset:read', 'asset:checkout'], school);
    const viewerThere = at(['asset:read'], otherSchool);
    expect(locationScopeFor([technicianHere, viewerThere], 'asset:read')).toEqual(
      [school, otherSchool].sort(),
    );
    expect(locationScopeFor([technicianHere, viewerThere], 'asset:checkout')).toEqual([school]);
  });

  it('any org-wide grant giving the permission lifts the scope (org-wide roles as before)', () => {
    expect(
      locationScopeFor([at(['asset:checkout'], school), grant(['asset:read'])], 'asset:read'),
    ).toBe(null);
    // ...but only for that permission: check-out stays limited to the school
    expect(
      locationScopeFor([at(['asset:checkout'], school), grant(['asset:read'])], 'asset:checkout'),
    ).toEqual([school]);
    expect(locationScopeFor([grant(['*'])], 'asset:read')).toBe(null);
    expect(locationScopeFor([grant(['*'], { scopeType: 'company' })], 'asset:read')).toBe(null);
  });

  it('without a permission (self-service routes) it describes the principal as a whole', () => {
    expect(locationScopeFor([at(['asset:read'], school)])).toEqual([school]);
    expect(locationScopeFor([at(['asset:read'], school), grant(['person:read'])])).toBe(null);
  });
});
