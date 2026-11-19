import type { components } from '@assettracker/api-client';
import { getApi } from '@/lib/api';

/** CSV export of a list as a background job (M2-REG-02). */
type S = components['schemas'];
export type ExportJob = S['ExportJob'];
export type ExportCreate = S['ExportCreate'];

/** Permission that gates the export button (the API audits the read as sensitive). */
export const EXPORT_PERMISSION = 'asset:read';

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
  job.status === 'ready' || job.status === 'failed' || job.status === 'expired';
