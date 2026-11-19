import type { components, operations } from '@assettracker/api-client';
import { getApi } from '@/lib/api';
import type { Page, Versioned } from '@/lib/registry/types';

/** Repair and maintenance log (M2-MNT-02) over the generated client. */
type S = components['schemas'];
export type Repair = S['Repair'];
export type RepairCreate = S['RepairCreate'];
export type RepairUpdate = S['RepairUpdate'];
export type RepairCompleteRequest = S['RepairCompleteRequest'];
export type RepairStatus = NonNullable<Repair['status']>;
export type RepairKind = NonNullable<Repair['kind']>;

export const REPAIR_KINDS: readonly RepairKind[] = [
  'repair',
  'maintenance',
  'inspection',
  'upgrade',
];
export const REPAIR_STATUSES: readonly RepairStatus[] = [
  'open',
  'in_progress',
  'completed',
  'cancelled',
];

const http = () => getApi().http;
const etagFor = (path: string) => getApi().etags.etagFor(path);
const versioned = <T>(value: T, path: string): Versioned<T> => ({ value, etag: etagFor(path) });

export type RepairQuery = NonNullable<operations['listRepairs']['parameters']['query']>;

const ifMatchOf = async (etag: string | undefined, load: () => Promise<Versioned<unknown>>) =>
  etag ?? (await load()).etag ?? '';

export type RepairSummary = S['RepairSummary'];

export const repairsApi = {
  /** Counts and the total cost per currency of an asset's repairs (cancelled and archived ones excluded). */
  async summary(assetId: string): Promise<RepairSummary> {
    const { data } = await http().GET('/v1/assets/{id}/repair-summary', {
      params: { path: { id: assetId } },
    });
    return data as RepairSummary;
  },
  async list(query: RepairQuery = {}): Promise<Page<Repair>> {
    const { data } = await http().GET('/v1/repairs', { params: { query } });
    return data as Page<Repair>;
  },
  async get(id: string): Promise<Versioned<Repair>> {
    const { data } = await http().GET('/v1/repairs/{id}', { params: { path: { id } } });
    return versioned(data as Repair, `/v1/repairs/${id}`);
  },
  async create(body: RepairCreate): Promise<Versioned<Repair>> {
    const { data } = await http().POST('/v1/repairs', { body });
    const created = data as Repair;
    return versioned(created, `/v1/repairs/${created.id}`);
  },
  async update(id: string, body: RepairUpdate, etag?: string): Promise<Versioned<Repair>> {
    const ifMatch = await ifMatchOf(etag, () => repairsApi.get(id));
    const { data } = await http().PATCH('/v1/repairs/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return versioned(data as Repair, `/v1/repairs/${id}`);
  },
  /** Close the repair: records cost and notes and restores the asset's status. */
  async complete(
    id: string,
    body: RepairCompleteRequest,
    etag?: string,
  ): Promise<Versioned<Repair>> {
    const ifMatch = await ifMatchOf(etag, () => repairsApi.get(id));
    const { data, response } = await http().POST('/v1/repairs/{id}/complete', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    // an action's answer carries the repair's new ETag, which the client does not record for a POST path
    return { value: data as Repair, etag: response.headers.get('etag') ?? undefined };
  },
};

/** Open or in-progress: the repair still holds the asset. */
export const isActiveRepair = (repair: Pick<Repair, 'status'>): boolean =>
  repair.status === 'open' || repair.status === 'in_progress';
