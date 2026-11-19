import type { components, operations } from '@assettracker/api-client';
import { getApi } from '@/lib/api';
import type { Page, Versioned } from '@/lib/registry/types';

/**
 * Accessories and consumables (M2-ACC-04) over the generated client. An accessory is a quantity
 * that goes out and comes back (`assignment.quantity`, partial returns); a consumable is a quantity
 * that is used up, with an append-only stock ledger. Writes that change stock carry an
 * `Idempotency-Key` (the contract requires it) so a retry after a dropped connection cannot apply twice.
 */
type S = components['schemas'];
export type Accessory = S['Accessory'];
export type AccessoryCreate = S['AccessoryCreate'];
export type AccessoryUpdate = S['AccessoryUpdate'];
export type Consumable = S['Consumable'];
export type ConsumableCreate = S['ConsumableCreate'];
export type ConsumableUpdate = S['ConsumableUpdate'];
export type StockMovement = S['StockMovement'];
export type StockMovementCreate = S['StockMovementCreate'];
export type StockReason = StockMovement['reason'];
export type AccessoryCheckoutRequest = S['AccessoryCheckoutRequest'];
export type AccessoryCheckinRequest = S['AccessoryCheckinRequest'];
export type Assignment = S['Assignment'];

export type StockKind = 'accessory' | 'consumable';

const http = () => getApi().http;
const etagFor = (path: string) => getApi().etags.etagFor(path);
const versioned = <T>(value: T, path: string): Versioned<T> => ({ value, etag: etagFor(path) });

type Query<K extends keyof operations> = operations[K]['parameters'] extends {
  query?: infer Q;
}
  ? Q
  : never;

export type AccessoryQuery = Query<'listAccessories'>;
export type ConsumableQuery = Query<'listConsumables'>;

const ifMatchOf = async (etag: string | undefined, load: () => Promise<Versioned<unknown>>) =>
  etag ?? (await load()).etag ?? '';

export const accessoriesApi = {
  async list(query: AccessoryQuery = {}): Promise<Page<Accessory>> {
    const { data } = await http().GET('/v1/accessories', { params: { query } });
    return data as Page<Accessory>;
  },
  async get(id: string): Promise<Versioned<Accessory>> {
    const { data } = await http().GET('/v1/accessories/{id}', { params: { path: { id } } });
    return versioned(data as Accessory, `/v1/accessories/${id}`);
  },
  async create(body: AccessoryCreate): Promise<Versioned<Accessory>> {
    const { data } = await http().POST('/v1/accessories', { body });
    const created = data as Accessory;
    return versioned(created, `/v1/accessories/${created.id}`);
  },
  async update(id: string, body: AccessoryUpdate, etag?: string): Promise<Versioned<Accessory>> {
    const ifMatch = await ifMatchOf(etag, () => accessoriesApi.get(id));
    const { data } = await http().PATCH('/v1/accessories/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return versioned(data as Accessory, `/v1/accessories/${id}`);
  },
  async archive(id: string, etag?: string): Promise<void> {
    const ifMatch = await ifMatchOf(etag, () => accessoriesApi.get(id));
    await http().DELETE('/v1/accessories/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
  },
  /** `POST /v1/accessories/{id}/checkout`: hand N units to a person, location or asset. */
  async checkout(
    id: string,
    body: AccessoryCheckoutRequest,
    idempotencyKey: string,
  ): Promise<Assignment> {
    const { data } = await http().POST('/v1/accessories/{id}/checkout', {
      params: { path: { id }, header: { 'Idempotency-Key': idempotencyKey } },
      body,
    });
    return data as Assignment;
  },
  /** `POST /v1/accessories/{id}/checkin`: take N units back (default: all that are outstanding). */
  async checkin(
    id: string,
    body: AccessoryCheckinRequest,
    idempotencyKey: string,
  ): Promise<Assignment> {
    const { data } = await http().POST('/v1/accessories/{id}/checkin', {
      params: { path: { id }, header: { 'Idempotency-Key': idempotencyKey } },
      body,
    });
    return data as Assignment;
  },
  async assignments(
    id: string,
    query: { state?: 'open' | 'closed' | 'all'; cursor?: string; limit?: number } = {},
  ): Promise<Page<Assignment>> {
    const { data } = await http().GET('/v1/accessories/{id}/assignments', {
      params: { path: { id }, query },
    });
    return data as Page<Assignment>;
  },
};

export const consumablesApi = {
  async list(query: ConsumableQuery = {}): Promise<Page<Consumable>> {
    const { data } = await http().GET('/v1/consumables', { params: { query } });
    return data as Page<Consumable>;
  },
  async get(id: string): Promise<Versioned<Consumable>> {
    const { data } = await http().GET('/v1/consumables/{id}', { params: { path: { id } } });
    return versioned(data as Consumable, `/v1/consumables/${id}`);
  },
  async create(body: ConsumableCreate): Promise<Versioned<Consumable>> {
    const { data } = await http().POST('/v1/consumables', { body });
    const created = data as Consumable;
    return versioned(created, `/v1/consumables/${created.id}`);
  },
  async update(id: string, body: ConsumableUpdate, etag?: string): Promise<Versioned<Consumable>> {
    const ifMatch = await ifMatchOf(etag, () => consumablesApi.get(id));
    const { data } = await http().PATCH('/v1/consumables/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return versioned(data as Consumable, `/v1/consumables/${id}`);
  },
  async archive(id: string, etag?: string): Promise<void> {
    const ifMatch = await ifMatchOf(etag, () => consumablesApi.get(id));
    await http().DELETE('/v1/consumables/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
  },
  /** The stock ledger, newest first. */
  async movements(
    id: string,
    query: { reason?: StockReason[]; cursor?: string; limit?: number } = {},
  ): Promise<Page<StockMovement>> {
    const { data } = await http().GET('/v1/consumables/{id}/movements', {
      params: { path: { id }, query },
    });
    return data as Page<StockMovement>;
  },
  /** Receive, issue or adjust stock; `409` when it would make the stock negative. */
  async addMovement(
    id: string,
    body: StockMovementCreate,
    idempotencyKey: string,
  ): Promise<StockMovement> {
    const { data } = await http().POST('/v1/consumables/{id}/movements', {
      params: { path: { id }, header: { 'Idempotency-Key': idempotencyKey } },
      body,
    });
    return data as StockMovement;
  },
};
