import type { components } from '@assettracker/api-client';
import { getApi } from '@/lib/api';

/**
 * CSV export of a list as a background job (M2-REG-02): `POST /v1/exports` answers `202`, the job is
 * polled with `GET /v1/exports/{id}` until it `succeeded` (every read of a succeeded job issues a
 * fresh, short-lived `download_url`), `failed` or `expired`.
 */
type S = components['schemas'];
export type ExportJob = S['Export'];
export type ExportCreate = S['ExportCreate'];
export type ExportResource = ExportCreate['resource'];

/**
 * Permission that gates every export button (the API also needs the read permission of the list
 * and audits the request and each download as a sensitive read).
 */
export const EXPORT_PERMISSION = 'export:run';

/** The read permission of each list an export may be made of. */
export const EXPORT_READ_PERMISSION: Record<ExportResource, string> = {
  assets: 'asset:read',
  people: 'person:read',
  locations: 'location:read',
};

const http = () => getApi().http;

export const exportsApi = {
  async create(body: ExportCreate): Promise<ExportJob> {
    const { data } = await http().POST('/v1/exports', { body });
    return data as ExportJob;
  },
  async get(id: string): Promise<ExportJob> {
    const { data } = await http().GET('/v1/exports/{id}', { params: { path: { id } } });
    return data as ExportJob;
  },
};

/** A job that will not change any more. */
export const isFinished = (job: Pick<ExportJob, 'status'>): boolean =>
  job.status === 'succeeded' || job.status === 'failed' || job.status === 'expired';

type FilterValue = string | number | boolean | string[];

/**
 * The `filters` of an export for a list query: the query of the list without paging and
 * presentation (`limit`, `cursor`, `include_total`, `fields`, `expand`), as a flat object. Arrays stay
 * arrays, custom-field filters become `cf[key]`, empty values are left out.
 */
export function exportFilters(query: object): Record<string, FilterValue> {
  const filters: Record<string, FilterValue> = {};
  const skipped = ['limit', 'cursor', 'include_total', 'fields', 'expand'];
  for (const [key, value] of Object.entries(query)) {
    if (skipped.includes(key) || value === undefined || value === null || value === '') continue;
    if (key === 'cf' && typeof value === 'object') {
      for (const [field, fieldValue] of Object.entries(value as Record<string, unknown>)) {
        filters[`cf[${field}]`] = String(fieldValue);
      }
    } else if (Array.isArray(value)) {
      if (value.length > 0) filters[key] = value.map(String);
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      filters[key] = value;
    }
  }
  return filters;
}
