import type { components, operations } from '@assettracker/api-client';
import { getApi } from '@/lib/api';
import type { Page, Versioned } from '@/lib/registry/types';

/**
 * Loaner pools (M2-LOAN-02 / M2-LOAN-04) over the generated client: pools and their members, the
 * quick check-out and the quick return by scanning (per-device results), loans (list, extend),
 * overdue loans, the dashboard and the organisation's custody settings (ED-20, ED-21).
 */
type S = components['schemas'];
export type LoanerPool = S['LoanerPool'];
export type LoanerPoolCreate = S['LoanerPoolCreate'];
export type LoanerPoolUpdate = S['LoanerPoolUpdate'];
export type LoanerPoolMember = S['LoanerPoolMember'];
export type LoanerCheckoutRequest = S['LoanerCheckoutRequest'];
export type CustodyResult = S['CustodyResult'];
export type QuickLoanRequest = S['QuickLoanRequest'];
export type QuickLoanResult = S['QuickLoanResult'];
export type LoanReturnRequest = S['LoanReturnRequest'];
export type LoanReturnResult = S['LoanReturnResult'];
export type Loan = S['Loan'];
export type LoanState = Loan['state'];
export type LoanExtendRequest = S['LoanExtendRequest'];
export type LoanerDashboard = S['LoanerDashboard'];
export type LoanerDashboardPool = S['LoanerDashboardPool'];
export type LoanerActivity = S['LoanerActivity'];
export type CustodySettings = S['CustodySettings'];

export type ProblemBody = S['Problem'];
export type PersonKind = NonNullable<LoanerPool['eligible_person_kinds']>[number];

type Query<K extends keyof operations> = operations[K]['parameters'] extends {
  query?: infer Q;
}
  ? Q
  : never;
export type PoolQuery = Query<'listLoanerPools'>;
export type LoanQuery = Query<'listLoans'>;

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
  /**
   * Quick check-out by scanning: one borrower, one or more devices (`codes`), answered per device in
   * request order. The request is a 200 whenever it was valid; a device that failed carries its problem.
   */
  async quickCheckout(
    poolId: string,
    body: QuickLoanRequest,
    idempotencyKey: string,
  ): Promise<QuickLoanResult> {
    const { data } = await http().POST('/v1/loaner-pools/{id}/quick-checkout', {
      params: { path: { id: poolId }, header: { 'Idempotency-Key': idempotencyKey } },
      body,
    });
    return data as QuickLoanResult;
  },
  /**
   * One loan (`POST /v1/loaner-pools/{id}/checkout`). Without `asset_id` the server lends the next
   * available device of the pool (ED-24: idle the longest, never lent first, ties by the lowest tag) and
   * answers with it, so the desk can say which device to hand over.
   */
  async checkoutNext(
    poolId: string,
    body: LoanerCheckoutRequest,
    idempotencyKey: string,
  ): Promise<CustodyResult> {
    const { data } = await http().POST('/v1/loaner-pools/{id}/checkout', {
      params: { path: { id: poolId }, header: { 'Idempotency-Key': idempotencyKey } },
      body,
    });
    return data as CustodyResult;
  },
  /** Quick return by scanning (one or many devices, any borrowers), answered per device. */
  async returnLoans(body: LoanReturnRequest, idempotencyKey: string): Promise<LoanReturnResult> {
    const { data } = await http().POST('/v1/loans/return', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      body,
    });
    return data as LoanReturnResult;
  },
  async loans(query: LoanQuery = {}): Promise<Page<Loan>> {
    const { data } = await http().GET('/v1/loans', { params: { query } });
    return data as Page<Loan>;
  },
  /** Move the due date of an open loan to a later day (logged). */
  async extend(id: string, body: LoanExtendRequest): Promise<Loan> {
    const { data } = await http().POST('/v1/loans/{id}/extend', { params: { path: { id } }, body });
    return data as Loan;
  },
  async dashboard(): Promise<LoanerDashboard> {
    const { data } = await http().GET('/v1/loaners/dashboard');
    return data as LoanerDashboard;
  },
};

/** `GET/PUT /v1/settings/custody`: the pre-filled return date of a check-out and the loan reminder lead time. */
export const custodySettingsApi = {
  async get(): Promise<Versioned<CustodySettings>> {
    const { data } = await http().GET('/v1/settings/custody');
    return versioned(data as CustodySettings, '/v1/settings/custody');
  },
  async put(body: CustodySettings, etag?: string): Promise<Versioned<CustodySettings>> {
    const ifMatch = await ifMatchOf(etag, () => custodySettingsApi.get());
    const { data } = await http().PUT('/v1/settings/custody', {
      params: { header: { 'If-Match': ifMatch } },
      body,
    });
    return versioned(data as CustodySettings, '/v1/settings/custody');
  },
};
