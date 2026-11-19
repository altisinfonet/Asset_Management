import type { components } from '@assettracker/api-client';
import { getApi } from '@/lib/api';
import type { Page } from '@/lib/registry/types';

/**
 * Label sheets (M2-TAG-03) over the generated client. A sheet is an asynchronous batch: `POST
 * /v1/labels/batches` answers `202` with a queued batch, `GET /v1/labels/batches/{id}` is polled
 * until it is `ready` (a short-lived presigned `download_url` comes with every read), `failed` (see
 * `error`) or `expired`. The templates are the six fixed ones of `GET /v1/labels/templates`.
 */
type S = components['schemas'];
export type LabelTemplate = S['LabelTemplate'];
export type LabelBatch = S['LabelBatch'];
export type LabelBatchCreate = S['LabelBatchCreate'];
export type LabelAssetFilter = S['LabelAssetFilter'];
export type LabelCodeType = LabelTemplate['code_type'];
export type LabelCode = NonNullable<LabelBatchCreate['codes']>[number];
export type LabelField = NonNullable<LabelBatchCreate['fields']>[number];
export type LabelBatchStatus = LabelBatch['status'];

const http = () => getApi().http;

export const labelsApi = {
  async templates(): Promise<LabelTemplate[]> {
    const { data } = await http().GET('/v1/labels/templates');
    return (data as S['LabelTemplateList']).data;
  },

  /** Queue a PDF; `idempotencyKey` lets a retry after a dropped connection replay the same batch. */
  async createBatch(body: LabelBatchCreate, idempotencyKey: string): Promise<LabelBatch> {
    const { data } = await http().POST('/v1/labels/batches', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      body,
    });
    return data as LabelBatch;
  },

  async batch(id: string): Promise<LabelBatch> {
    const { data } = await http().GET('/v1/labels/batches/{id}', { params: { path: { id } } });
    return data as LabelBatch;
  },

  async batches(query: { cursor?: string; limit?: number } = {}): Promise<Page<LabelBatch>> {
    const { data } = await http().GET('/v1/labels/batches', { params: { query } });
    return data as Page<LabelBatch>;
  },
};

/** A batch that will not change any more (`queued` is the only status that still moves). */
export const isBatchFinished = (batch: Pick<LabelBatch, 'status'>): boolean =>
  batch.status !== 'queued';
