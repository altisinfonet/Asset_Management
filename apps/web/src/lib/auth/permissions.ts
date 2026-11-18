/**
 * Permissions are `resource:action` strings (openapi.yaml, `x-permission`). The built-in
 * `tenant_admin` role holds `*`; a `resource:*` entry grants every action on the resource.
 */
export function hasPermission(granted: readonly string[], needed: string): boolean {
  if (granted.includes('*') || granted.includes(needed)) return true;
  const resource = needed.split(':')[0];
  return granted.includes(`${resource}:*`);
}

/** True when the principal holds at least one of `needed` (or nothing is needed). */
export function hasAnyPermission(
  granted: readonly string[],
  needed: string | readonly string[] | undefined,
): boolean {
  if (needed === undefined) return true;
  const list = typeof needed === 'string' ? [needed] : needed;
  if (list.length === 0) return true;
  return list.some((permission) => hasPermission(granted, permission));
}
