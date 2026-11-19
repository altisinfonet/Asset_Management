/**
 * Permission catalogue and built-in roles (M1-AUTH-01).
 *
 * Permissions are `resource:action` strings. The catalogue below is exactly the set of `x-permission`
 * values in docs/engineering/openapi.yaml (a unit test fails when they drift). Built-in role bundles
 * mirror `app.provision_tenant` (migration 0011), which seeds them per tenant; the e2e test
 * `role-seed` fails when the SQL and this file disagree. Custom roles are v2.
 */

export const PERMISSIONS = [
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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** `*` grants everything; `resource:*` grants every action on a resource. */
export const WILDCARD = '*';

const READ: readonly Permission[] = [
  'asset:read',
  'catalog:read',
  'location:read',
  'person:read',
  'accessory:read',
  'consumable:read',
  'loaner:read',
  'repair:read',
  'import:read',
  'attachment:read',
  'company:read',
  'search:read',
];

export interface BuiltinRole {
  key: string;
  name: string;
  /** Permission strings as stored in `app.role.permissions`. */
  permissions: readonly string[];
}

export const BUILTIN_ROLES: readonly BuiltinRole[] = [
  { key: 'tenant_admin', name: 'Administrator', permissions: [WILDCARD] },
  {
    key: 'asset_manager',
    name: 'Asset manager',
    permissions: [
      ...READ,
      'asset:create',
      'asset:update',
      'asset:delete',
      'asset:checkout',
      'asset:checkin',
      'asset:transfer',
      'asset:label',
      'catalog:manage',
      'location:manage',
      'person:manage',
      'accessory:manage',
      'accessory:checkout',
      'consumable:manage',
      'consumable:adjust',
      'loaner:manage',
      'loaner:checkout',
      'repair:manage',
      'import:run',
      'attachment:write',
      'audit:read',
      'user:read',
      'role:read',
      'view:share',
      'export:run',
    ],
  },
  {
    key: 'technician',
    name: 'Technician',
    permissions: [
      ...READ,
      'asset:update',
      'asset:checkout',
      'asset:checkin',
      'asset:transfer',
      'asset:label',
      'accessory:checkout',
      'consumable:adjust',
      'loaner:checkout',
      'repair:manage',
      'attachment:write',
    ],
  },
  {
    key: 'auditor',
    name: 'Auditor',
    permissions: [...READ, 'audit:read', 'user:read', 'role:read'],
  },
  { key: 'viewer', name: 'Viewer', permissions: [...READ] },
];

export const BUILTIN_ROLE_KEYS = BUILTIN_ROLES.map((r) => r.key);

/** Permissions that make a role an "administrator" for the tenant MFA policy `admins`. */
export const ADMIN_MARKER_PERMISSIONS: readonly string[] = [WILDCARD, 'user:manage'];
