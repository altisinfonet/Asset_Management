import { randomUUID } from 'node:crypto';

/**
 * Object keys (M2-FILE-01, M2-SEC-02). EVERY key the system stores or hands to a storage adapter is
 * `tenants/<tenant_id>/<yyyy>/<uuid>` with an optional short lower-case suffix for a derivative
 * (`.thumb`). Both ids are canonical lower-case UUIDs, the year is four digits. Nothing else is a
 * valid key: no `..`, no slash beyond these three, no upper case, no encoded characters. The adapters
 * call {@link assertObjectKey} on every operation, so a fuzzed, traversal or foreign-shaped key is
 * refused before it reaches S3 or the filesystem, and the database repeats the tenant prefix as a
 * CHECK constraint on `app.attachment.storage_key`.
 *
 * The backlog sketches `t/<tenant_id>/...`; the schema (0005) fixed the prefix as `tenants/`.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY = new RegExp(`^tenants/(${UUID})/(\\d{4})/(${UUID})(?:\\.([a-z0-9]{1,8}))?$`);

export interface ParsedObjectKey {
  tenantId: string;
  year: number;
  objectId: string;
  /** Derivative suffix (`thumb`), when present. */
  variant: string | null;
}

export class InvalidStorageKeyError extends Error {
  constructor(readonly key: string) {
    // The key is attacker-influenced in tests (fuzz), so it is length-capped in the message.
    super(`invalid storage key: ${JSON.stringify(key.slice(0, 120))}`);
    this.name = 'InvalidStorageKeyError';
  }
}

/** The key of a new object of `tenantId` (`objectId` defaults to a fresh UUID). */
export function newObjectKey(
  tenantId: string,
  opts: { objectId?: string; now?: Date; variant?: string } = {},
): string {
  const year = (opts.now ?? new Date()).getUTCFullYear();
  const base = `tenants/${tenantId}/${String(year).padStart(4, '0')}/${opts.objectId ?? randomUUID()}`;
  const key = opts.variant ? `${base}.${opts.variant}` : base;
  assertObjectKey(key);
  return key;
}

/** The derivative key of an original key (`<key>.<variant>`). */
export function variantKey(key: string, variant: string): string {
  const parsed = parseObjectKey(key);
  if (!parsed || parsed.variant)
    throw new InvalidStorageKeyError(parsed ? `${key} (already a variant)` : key);
  return `${key}.${variant}`;
}

export function parseObjectKey(key: string): ParsedObjectKey | null {
  if (typeof key !== 'string' || key.length > 200) return null;
  const m = KEY.exec(key);
  if (!m) return null;
  return {
    tenantId: m[1]!,
    year: Number(m[2]),
    objectId: m[3]!,
    variant: m[4] ?? null,
  };
}

export function isObjectKey(key: string): boolean {
  return parseObjectKey(key) !== null;
}

export function assertObjectKey(key: string): void {
  if (!parseObjectKey(key)) throw new InvalidStorageKeyError(String(key));
}

/** True when `key` is a valid key that belongs to `tenantId`. */
export function keyBelongsToTenant(key: string, tenantId: string): boolean {
  return parseObjectKey(key)?.tenantId === tenantId.toLowerCase();
}
