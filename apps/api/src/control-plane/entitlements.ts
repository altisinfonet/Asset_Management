/**
 * Entitlements stub (M1-TEN-07). Plans and licences are enforced behind this interface later
 * (cloud billing, self-hosted licence file); for now every module is on for every tenant.
 */
export const MODULE_KEYS = [
  'registry',
  'custody',
  'stocktake',
  'maintenance',
  'imports',
  'reports',
  'api_access',
  'integrations',
  'audit_log',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface Entitlements {
  tenantId: string;
  modules: Record<ModuleKey, boolean>;
  /** null = unlimited. */
  limits: { assets: number | null; users: number | null };
}

export interface EntitlementSource {
  entitlementsFor(tenantId: string): Promise<Entitlements>;
}

export const ENTITLEMENT_SOURCE = Symbol('ENTITLEMENT_SOURCE');

/** Stub: all modules on, no limits. */
export class AllModulesOnEntitlementSource implements EntitlementSource {
  async entitlementsFor(tenantId: string): Promise<Entitlements> {
    return {
      tenantId,
      modules: Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as Record<ModuleKey, boolean>,
      limits: { assets: null, users: null },
    };
  }
}
