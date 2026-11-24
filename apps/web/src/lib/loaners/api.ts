import type { components, operations } from '@assettracker/api-client';
import { getApi } from '@/lib/api';
import type { CustodyResult, Page, Versioned } from '@/lib/registry/types';

/**
 * Loaner pools (M2-LOAN-02 / M2-LOAN-04) over the generated client: pools and their members, the
 * quick loan (`POST /v1/loaner-pools/{id}/checkout`), overdue loans, recent activity and the
 * organisation's loan defaults. A return is the ordinary asset check-in (`custodyApi.checkin`).
 * Several of the shapes are the web's proposal (see `[M2-W3 WEB proposal]` in docs/engineering/tools/gen.mjs).
 */
type S = components['schemas'];
export type LoanerPool = S['LoanerPool'];
export type LoanerPoolCreate = S['LoanerPoolCreate'];
export type LoanerPoolUpdate = S['LoanerPoolUpdate'];
export type LoanerPoolMember = S['LoanerPoolMember'];
export type LoanerCheckoutRequest = S['LoanerCheckoutRequest'];
export type OverdueCheckout = S['OverdueCheckout'];
export type LoanActivity = S['LoanActivity'];
export type LoanSettings = S['LoanSettings'];

type Query<K extends keyof operations> = operations[K]['parameters'] extends {
  query?: infer Q;
}
  ? Q
  : never;
export type PoolQuery = Query<'listLoanerPools'>;
export type OverdueQuery = Query<'listOverdueCheckouts'>;

const http = () => getApi().http;
const etagFor = (path: string) => getApi().etags.etagFor(path);
const versioned = <T>(value: T, path: string): Versioned<T> => ({ value, etag: etagFor(path) });
const ifMatchOf = async (etag: string | undefined, load: () => Promise<Versioned<unknown>>) =>
  etag ?? (await load()).etag ?? '';

export const loanersApi = {
  async pools(query: PoolQuery = {}): Promise<Page<LoanerPool>> {
    const { data } = await http().GET('/v1/loaner-pools', { params: { query } });
    return data as Page<LoanerPool>;
  },
  async pool(id: string): Promise<Versioned<LoanerPool>> {
    const { data } = await http().GET('/v1/loaner-pools/{id}', { params: { path: { id } } });
    return versioned(data as LoanerPool, `/v1/loaner-pools/${id}`);
  },
  async createPool(body: LoanerPoolCreate): Promise<Versioned<LoanerPool>> {
    const { data } = await http().POST('/v1/loaner-pools', { body });
    const created = data as LoanerPool;
    return versioned(created, `/v1/loaner-pools/${created.id}`);
  },
  async updatePool(
    id: string,
    body: LoanerPoolUpdate,
    etag?: string,
  ): Promise<Versioned<LoanerPool>> {
    const ifMatch = await ifMatchOf(etag, () => loanersApi.pool(id));
    const { data } = await http().PATCH('/v1/loaner-pools/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return versioned(data as LoanerPool, `/v1/loaner-pools/${id}`);
  },
  async archivePool(id: string, etag?: string): Promise<void> {
    const ifMatch = await ifMatchOf(etag, () => loanersApi.pool(id));
    await http().DELETE('/v1/loaner-pools/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
  },
  async members(
    id: string,
    query: { available?: boolean; cursor?: string; limit?: number } = {},
  ): Promise<Page<LoanerPoolMember>> {
    const { data } = await http().GET('/v1/loaner-pools/{id}/members', {
      params: { path: { id }, query },
    });
    return data as Page<LoanerPoolMember>;
  },
  async addMember(id: string, assetId: string): Promise<LoanerPoolMember> {
    const { data } = await http().POST('/v1/loaner-pools/{id}/members', {
      params: { path: { id } },
      body: { asset_id: assetId },
    });
    return data as LoanerPoolMember;
  },
  async removeMember(id: string, assetId: string): Promise<void> {
    await http().DELETE('/v1/loaner-pools/{id}/members/{asset_id}', {
      params: { path: { id, asset_id: assetId } },
    });
  },
  /** Lend a pool device (a given one, or the next free one) to a person; a retry with the same key replays. */
  async checkout(
    id: string,
    body: LoanerCheckoutRequest,
    idempotencyKey: string,
  ): Promise<CustodyResult> {
    const { data } = await http().POST('/v1/loaner-pools/{id}/checkout', {
      params: { path: { id }, header: { 'Idempotency-Key': idempotencyKey } },
      body,
    });
    return data as CustodyResult;
  },
  async overdue(query: OverdueQuery = {}): Promise<Page<OverdueCheckout>> {
    const { data } = await http().GET('/v1/loans/overdue', { params: { query } });
    return data as Page<OverdueCheckout>;
  },
  async activity(
    query: { loaner_pool_id?: string; cursor?: string; limit?: number } = {},
  ): Promise<Page<LoanActivity>> {
    const { data } = await http().GET('/v1/loans/activity', { params: { query } });
    return data as Page<LoanActivity>;
  },
  async settings(): Promise<Versioned<LoanSettings>> {
    const { data } = await http().GET('/v1/settings/loans');
    return versioned(data as LoanSettings, '/v1/settings/loans');
  },
  async putSettings(body: LoanSettings, etag?: string): Promise<Versioned<LoanSettings>> {
    const ifMatch = await ifMatchOf(etag, () => loanersApi.settings());
    const { data } = await http().PUT('/v1/settings/loans', {
      params: { header: { 'If-Match': ifMatch } },
      body,
    });
    return versioned(data as LoanSettings, '/v1/settings/loans');
  },
};
