import { describe, expect, it } from 'vitest';
import { type AccessSubject, decideAccess } from './access.js';
import { loadContract, ruleOf } from '../../test/support/contract.js';
import { BUILTIN_ROLES, PERMISSIONS } from './permissions.js';
import type { GrantedRole } from './policy.service.js';

/**
 * ROLE-MATRIX (M1-AUTH-01): walks EVERY operation of the contract and asserts the guard's decision
 * for each built-in role, an API key, and an anonymous caller. The decision function is the one the
 * auth guard calls (`decideAccess`), fed with the contract's own `x-permission`, `x-self-service` and
 * `security: []`. A permission missing from a role, a new operation without a permission, or a
 * self-service operation that stops being whitelisted fails here.
 */

const { operations, permissions } = loadContract();

const grantFor = (role: (typeof BUILTIN_ROLES)[number]): GrantedRole => ({
  assignmentId: 'a',
  roleId: role.key,
  roleKey: role.key,
  permissions: role.permissions,
  scopeType: 'tenant',
  scopeCompanyId: null,
  scopeLocationId: null,
});

const subjectOf = (
  roleKey: string,
  method: AccessSubject['method'] = 'session',
): AccessSubject => ({
  method,
  grants: [grantFor(BUILTIN_ROLES.find((r) => r.key === roleKey)!)],
  keyScopes: method === 'api_key' ? ['*'] : null,
});

describe('contract coverage', () => {
  it('reads the whole contract', () => {
    expect(operations.length).toBeGreaterThanOrEqual(132);
  });

  it('every operation is public, permissioned, self-service or explicitly "any signed-in principal"', () => {
    const anySignedIn = operations.filter((o) => !o.public && !o.permission && !o.selfService);
    // Exactly these two: `GET /v1/auth/me` and `POST /v1/auth/logout`. A new one must be a conscious decision.
    expect(anySignedIn.map((o) => o.operationId).sort()).toEqual(['getMe', 'logout']);
  });

  it('the public operations are exactly the unauthenticated auth endpoints and the health/version probes', () => {
    expect(
      operations
        .filter((o) => o.public)
        .map((o) => o.operationId)
        .sort(),
    ).toEqual(
      [
        'acceptInvitation',
        'forgotPassword',
        'getHealth',
        'getInvitation',
        'getPasswordPolicy',
        'getVersion',
        'login',
        'resetPassword',
        'verifyMfa',
      ].sort(),
    );
  });

  it('the permission catalogue is exactly the set of x-permission values in the contract', () => {
    expect([...PERMISSIONS].sort()).toEqual(permissions);
  });
});

describe('role x operation matrix', () => {
  const roles = BUILTIN_ROLES.map((r) => r.key);

  it.each(roles)('%s: the guard decision matches the contract for every operation', (roleKey) => {
    const subject = subjectOf(roleKey);
    const role = BUILTIN_ROLES.find((r) => r.key === roleKey)!;
    for (const op of operations) {
      const decision = decideAccess(ruleOf(op), subject);
      let expected: string;
      if (op.public || (!op.permission && !op.selfService)) expected = 'allow';
      else if (op.selfService)
        expected = 'allow'; // any authenticated browser session
      else {
        const granted =
          role.permissions.includes('*') ||
          role.permissions.includes(op.permission!) ||
          role.permissions.includes(`${op.permission!.split(':')[0]}:*`);
        expected = granted ? 'allow' : 'forbidden';
      }
      expect(decision, `${roleKey} ${op.method.toUpperCase()} ${op.path} (${op.operationId})`).toBe(
        expected,
      );
    }
  });

  it('anonymous callers may only use public operations', () => {
    for (const op of operations) {
      const decision = decideAccess(ruleOf(op), null);
      expect(decision, op.operationId).toBe(op.public ? 'allow' : 'unauthorized');
    }
  });

  it('self-service operations are whitelisted for every role but refuse an API key', () => {
    const selfService = operations.filter((o) => o.selfService);
    expect(selfService.length).toBeGreaterThanOrEqual(7);
    for (const op of selfService) {
      for (const roleKey of roles) {
        expect(decideAccess(ruleOf(op), subjectOf(roleKey)), `${roleKey} ${op.operationId}`).toBe(
          'allow',
        );
        expect(
          decideAccess(ruleOf(op), subjectOf(roleKey, 'api_key')),
          `key ${op.operationId}`,
        ).toBe('forbidden');
      }
    }
  });

  it('tenant_admin may do everything a signed-in user can do', () => {
    for (const op of operations.filter((o) => !o.public)) {
      expect(decideAccess(ruleOf(op), subjectOf('tenant_admin')), op.operationId).toBe('allow');
    }
  });

  it('every built-in role can search (ED-14)', () => {
    for (const role of BUILTIN_ROLES) {
      expect(
        role.key === 'tenant_admin' || role.permissions.includes('search:read'),
        role.key,
      ).toBe(true);
      const search = operations.find((o) => o.operationId === 'search')!;
      expect(decideAccess(ruleOf(search), subjectOf(role.key))).toBe('allow');
    }
  });

  // Explicit expectations: a change to the bundles has to touch this table, not just the sources.
  const ALL = ['tenant_admin', 'asset_manager', 'technician', 'auditor', 'viewer'];
  const allowed: Record<string, string[]> = {
    // operationId -> roles that may call it
    listUsers: ['tenant_admin', 'asset_manager', 'auditor'],
    createUser: ['tenant_admin'],
    updateUser: ['tenant_admin'],
    archiveUser: ['tenant_admin'],
    resetUserMfa: ['tenant_admin'],
    listUserSessions: ['tenant_admin'],
    listRoles: ['tenant_admin', 'asset_manager', 'auditor'],
    createApiKey: ['tenant_admin'],
    listApiKeys: ['tenant_admin'],
    listAssets: ['tenant_admin', 'asset_manager', 'technician', 'auditor', 'viewer'],
    createAsset: ['tenant_admin', 'asset_manager'],
    archiveAsset: ['tenant_admin', 'asset_manager'],
    checkoutAsset: ['tenant_admin', 'asset_manager', 'technician'],
    checkinAsset: ['tenant_admin', 'asset_manager', 'technician'],
    listAuditLog: ['tenant_admin', 'asset_manager', 'auditor'],
    // registry (M1-REG): reads for everybody, catalogue writes for managers, asset writes by permission
    getAsset: ALL,
    resolveScan: ALL,
    search: ALL,
    listCategories: ALL,
    getCategory: ALL,
    listManufacturers: ALL,
    listModels: ALL,
    listStatusLabels: ALL,
    listVendors: ALL,
    listCustomFields: ALL,
    getAssetTagTemplate: ALL,
    updateAsset: ['tenant_admin', 'asset_manager', 'technician'],
    bulkUpdateAssets: ['tenant_admin', 'asset_manager', 'technician'],
    restoreAsset: ['tenant_admin', 'asset_manager'],
    bulkArchiveAssets: ['tenant_admin', 'asset_manager'],
    bulkRestoreAssets: ['tenant_admin', 'asset_manager'],
    cloneAsset: ['tenant_admin', 'asset_manager'],
    createCategory: ['tenant_admin', 'asset_manager'],
    updateCategory: ['tenant_admin', 'asset_manager'],
    archiveCategory: ['tenant_admin', 'asset_manager'],
    createManufacturer: ['tenant_admin', 'asset_manager'],
    updateManufacturer: ['tenant_admin', 'asset_manager'],
    archiveManufacturer: ['tenant_admin', 'asset_manager'],
    createAssetModel: ['tenant_admin', 'asset_manager'],
    updateAssetModel: ['tenant_admin', 'asset_manager'],
    archiveAssetModel: ['tenant_admin', 'asset_manager'],
    createStatusLabel: ['tenant_admin', 'asset_manager'],
    updateStatusLabel: ['tenant_admin', 'asset_manager'],
    archiveStatusLabel: ['tenant_admin', 'asset_manager'],
    createVendor: ['tenant_admin', 'asset_manager'],
    updateVendor: ['tenant_admin', 'asset_manager'],
    archiveVendor: ['tenant_admin', 'asset_manager'],
    createCustomFieldDef: ['tenant_admin', 'asset_manager'],
    updateCustomFieldDef: ['tenant_admin', 'asset_manager'],
    archiveCustomFieldDef: ['tenant_admin', 'asset_manager'],
    putAssetTagTemplate: ['tenant_admin', 'asset_manager'],
  };
  it.each(Object.entries(allowed))('%s is allowed for exactly %j', (operationId, expectedRoles) => {
    const op = operations.find((o) => o.operationId === operationId);
    expect(op, `operation ${operationId} not found in the contract`).toBeDefined();
    const actual = BUILTIN_ROLES.filter(
      (r) => decideAccess(ruleOf(op!), subjectOf(r.key)) === 'allow',
    ).map((r) => r.key);
    expect(actual.sort()).toEqual([...expectedRoles].sort());
  });

  it('no non-admin role can mutate users, roles or API keys', () => {
    const sensitive = operations.filter(
      (o) => o.permission === 'user:manage' || o.permission === 'apikey:manage',
    );
    expect(sensitive.length).toBeGreaterThanOrEqual(11);
    for (const op of sensitive) {
      for (const roleKey of roles.filter((r) => r !== 'tenant_admin')) {
        expect(decideAccess(ruleOf(op), subjectOf(roleKey)), `${roleKey} ${op.operationId}`).toBe(
          'forbidden',
        );
      }
    }
  });
});
