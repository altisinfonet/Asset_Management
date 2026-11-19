import { afterAll, describe, expect, it } from 'vitest';
import { BUILTIN_ROLES, PERMISSIONS } from '../../src/auth/permissions.js';
import { createFixtureTenant, dbEnabled, newTenancy } from '../support/db.js';

/**
 * The built-in roles seeded by `app.provision_tenant` (migration 0011) and the role bundles in
 * src/auth/permissions.ts (which the role matrix test walks) must be the same data. Also guards
 * ED-14: a later migration that replaces provision_tenant must not drop `search:read`.
 */
describe.skipIf(!dbEnabled)('built-in roles in the database', () => {
  const tenancy = newTenancy();
  afterAll(() => tenancy.onModuleDestroy());

  it('a freshly provisioned tenant has exactly the roles and permissions of the code', async () => {
    const fixture = await createFixtureTenant(tenancy, 'RoleSeed');
    const roles = await tenancy.withTenantTx({ tenantId: fixture.id }, (trx) =>
      trx.role.findMany({ orderBy: { key: 'asc' } }),
    );
    expect(roles.map((r) => r.key)).toEqual(BUILTIN_ROLES.map((r) => r.key).sort());
    for (const role of roles) {
      const expected = BUILTIN_ROLES.find((r) => r.key === role.key)!;
      expect(role.is_builtin).toBe(true);
      expect([...role.permissions].sort(), role.key).toEqual([...expected.permissions].sort());
      // Everything seeded is a known permission (or the wildcard).
      for (const p of role.permissions)
        expect(p === '*' || (PERMISSIONS as readonly string[]).includes(p), p).toBe(true);
      // ED-14: search:read for every role (the administrator through the wildcard).
      expect(
        role.permissions.includes('*') || role.permissions.includes('search:read'),
        role.key,
      ).toBe(true);
    }
  });

  it('a freshly provisioned tenant keeps every grant of the later migrations (0011 search:read, 0094 view:share and export:run)', async () => {
    const fixture = await createFixtureTenant(tenancy, 'RoleSeedWave2');
    const roles = await tenancy.withTenantTx({ tenantId: fixture.id }, (trx) =>
      trx.role.findMany({ where: { is_builtin: true } }),
    );
    const byKey = new Map(roles.map((r) => [r.key, r.permissions]));
    // 0011: every role can search; 0094: the asset manager shares views and runs exports.
    for (const [key, permissions] of byKey) {
      expect(permissions.includes('*') || permissions.includes('search:read'), key).toBe(true);
    }
    expect(byKey.get('asset_manager')).toEqual(
      expect.arrayContaining(['search:read', 'view:share', 'export:run']),
    );
    // the administrator holds everything through the wildcard; read-only roles hold neither
    expect(byKey.get('tenant_admin')).toContain('*');
    for (const [key, permissions] of byKey) {
      if (key === 'asset_manager' || permissions.includes('*')) continue;
      expect(permissions, key).not.toContain('export:run');
      expect(permissions, key).not.toContain('view:share');
    }
    // label sheets are seeded per tenant by app.seed_label_templates (0070), not by provision_tenant
    const templates = await tenancy.withTenantTx({ tenantId: fixture.id }, async (trx) => {
      await trx.$executeRaw`select app.seed_label_templates(${fixture.id}::uuid)`;
      return trx.label_template.count();
    });
    expect(templates).toBe(6);
  });

  it('tenants that existed before migration 0011 were updated too', async () => {
    const all = await tenancy.withPreTenantTx((trx) =>
      trx.tenant_directory.findMany({ select: { tenant_id: true } }),
    );
    expect(all.length).toBeGreaterThan(0);
    for (const { tenant_id } of all.slice(0, 20)) {
      const roles = await tenancy.withTenantTx({ tenantId: tenant_id }, (trx) =>
        trx.role.findMany({ where: { is_builtin: true } }),
      );
      for (const r of roles) {
        expect(
          r.permissions.includes('*') || r.permissions.includes('search:read'),
          `${tenant_id} ${r.key}`,
        ).toBe(true);
      }
    }
  });
});
