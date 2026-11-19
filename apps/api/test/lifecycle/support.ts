import { randomUUID } from 'node:crypto';
import { type Client, type Resp } from '../auth/support.js';
import { type TenantFixture, unique } from '../registry/support.js';

export {
  type App,
  type TenantFixture,
  auditRows,
  createTenant,
  createUser,
  faults,
  newTenancy,
  outboxRows,
  ownerTenantSql,
  startRegistryApp,
  testPorts,
  unique,
} from '../registry/support.js';
export type { Client, Resp };
export { contractViolations } from '../support/contract-observer.js';

/** A JSON body as the test client returns it (untyped on purpose: the contract tests check the shapes). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

/** A fresh Idempotency-Key header set (custody operations require one). */
export const key = (value: string = randomUUID()) => ({ headers: { 'idempotency-key': value } });

/** Request options: an Idempotency-Key plus an optional If-Match. */
export const keyed = (ifMatch?: string, value?: string) => ({
  headers: {
    'idempotency-key': value ?? randomUUID(),
    ...(ifMatch ? { 'if-match': ifMatch } : {}),
  },
});

export const ifMatch = (etag: unknown) => ({ headers: { 'if-match': String(etag) } });

/** Dates relative to today (UTC), `YYYY-MM-DD`. */
export const inDays = (n: number): string =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export interface Basics {
  categoryId: string;
  /** status label ids by name ("Ready to deploy", "Deployed", "In repair", "Lost or stolen", "Retired"...) */
  status: Record<string, string>;
}

/** The category and the status labels of a tenant (creates one asset category). */
export async function basics(t: TenantFixture): Promise<Basics> {
  const cat = await t.admin.post('/v1/categories', { name: unique('Cat'), tag_prefix: 'W1-' });
  const labels = await t.admin.get('/v1/status-labels?limit=200');
  return {
    categoryId: cat.body.id,
    status: Object.fromEntries(
      labels.body.data.map((s: { name: string; id: string }) => [s.name, s.id]),
    ),
  };
}

export async function newAsset(
  admin: Client,
  categoryId: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; etag: string; body: Json }> {
  const res = await admin.post('/v1/assets', { category_id: categoryId, ...extra });
  if (res.status !== 201) throw new Error(`create asset: ${res.status} ${res.raw}`);
  return { id: res.body.id, etag: String(res.headers.etag), body: res.body };
}

export async function newPerson(
  admin: Client,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; body: Json }> {
  const res = await admin.post('/v1/people', { display_name: unique('Person'), ...extra });
  if (res.status !== 201) throw new Error(`create person: ${res.status} ${res.raw}`);
  return { id: res.body.id, body: res.body };
}

export async function newLocation(
  admin: Client,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; body: Json }> {
  const res = await admin.post('/v1/locations', { name: unique('Loc'), ...extra });
  if (res.status !== 201) throw new Error(`create location: ${res.status} ${res.raw}`);
  return { id: res.body.id, body: res.body };
}

/** History rows of an asset, oldest first. */
export async function historyOf(admin: Client, assetId: string) {
  const rows: Array<Json> = [];
  let cursor: string | null = null;
  do {
    const res: Resp = await admin.get(
      `/v1/assets/${assetId}/history?limit=3${cursor ? `&cursor=${cursor}` : ''}`,
    );
    if (res.status !== 200) throw new Error(`history: ${res.status} ${res.raw}`);
    rows.push(...res.body.data);
    cursor = res.body.page.next_cursor;
  } while (cursor);
  return rows.reverse();
}
