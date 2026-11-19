import { type Client } from '../auth/support.js';
import type { Json } from '../lifecycle/support.js';
import { type TenantFixture, unique } from '../registry/support.js';

export {
  type App,
  type Client,
  type Json,
  type Resp,
  type TenantFixture,
  auditRows,
  contractViolations,
  createTenant,
  createUser,
  ifMatch,
  inDays,
  key,
  keyed,
  newLocation,
  newPerson,
  newTenancy,
  outboxRows,
  ownerTenantSql,
  startRegistryApp,
  unique,
} from '../lifecycle/support.js';

/** A category of the given kind. */
export async function newCategory(
  admin: Client,
  kind: 'accessory' | 'consumable',
): Promise<{ id: string }> {
  const res = await admin.post('/v1/categories', { name: unique(`Cat-${kind}`), kind });
  if (res.status !== 201) throw new Error(`create category: ${res.status} ${res.raw}`);
  return { id: res.body.id };
}

/** An accessory with `qty_total` units (and its own accessory category unless one is given). */
export async function newAccessory(
  admin: Client,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; etag: string; body: Json }> {
  const categoryId =
    (extra.category_id as string | undefined) ?? (await newCategory(admin, 'accessory')).id;
  const res = await admin.post('/v1/accessories', {
    category_id: categoryId,
    name: unique('Charger'),
    qty_total: 10,
    ...extra,
  });
  if (res.status !== 201) throw new Error(`create accessory: ${res.status} ${res.raw}`);
  return { id: res.body.id, etag: String(res.headers.etag), body: res.body };
}

/** A consumable (own consumable category unless one is given). */
export async function newConsumable(
  admin: Client,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; etag: string; body: Json }> {
  const categoryId =
    (extra.category_id as string | undefined) ?? (await newCategory(admin, 'consumable')).id;
  const res = await admin.post('/v1/consumables', {
    category_id: categoryId,
    name: unique('Toner'),
    ...extra,
  });
  if (res.status !== 201) throw new Error(`create consumable: ${res.status} ${res.raw}`);
  return { id: res.body.id, etag: String(res.headers.etag), body: res.body };
}
