import type { components, operations } from '@assettracker/api-client';
import { getApi } from '@/lib/api';
import type { Page, Versioned } from '@/lib/registry/types';

/**
 * CSV import (M2-IMP-08) over the generated client: jobs with their state machine, the analysis of
 * the uploaded file, the fields a column can go to, value lookups, dry run, commit, per-row results,
 * saved column mappings and the downloads (templates, error report). Parts of it are the web's
 * proposal (see `[M2-W3 WEB proposal]` in docs/engineering/tools/gen.mjs).
 */
type S = components['schemas'];
export type ImportJob = S['ImportJob'];
export type ImportJobCreate = S['ImportJobCreate'];
export type ImportJobUpdate = S['ImportJobUpdate'];
export type ImportState = ImportJob['state'];
export type ImportEntity = ImportJob['entity_type'];
export type ImportSource = ImportJob['source'];
export type ImportRow = S['ImportRow'];
export type ImportOutcome = ImportRow['outcome'];
export type ImportAnalysis = S['ImportAnalysis'];
export type ImportColumn = S['ImportColumn'];
export type ImportTargetField = S['ImportTargetField'];
export type ImportLookup = S['ImportLookup'];
export type ImportLookupValue = S['ImportLookupValue'];
export type ImportValueChoice = S['ImportValueChoice'];
export type ImportMappingTemplate = S['ImportMappingTemplate'];
export type ImportMappingTemplateCreate = S['ImportMappingTemplateCreate'];
export type ImportOptions = NonNullable<ImportJob['options']>;
export type ImportReference = ImportLookup['reference'];
/** The decisions of the value-mapping step: target field -> source value -> choice. */
export type ValueMap = Record<string, Record<string, ImportValueChoice>>;

type Query<K extends keyof operations> = operations[K]['parameters'] extends {
  query?: infer Q;
}
  ? Q
  : never;
export type ImportListQuery = Query<'listImports'>;

const http = () => getApi().http;
const etagFor = (path: string) => getApi().etags.etagFor(path);
const versioned = <T>(value: T, path: string): Versioned<T> => ({ value, etag: etagFor(path) });
const ifMatchOf = async (etag: string | undefined, load: () => Promise<Versioned<unknown>>) =>
  etag ?? (await load()).etag ?? '';

export const importsApi = {
  async list(query: ImportListQuery = {}): Promise<Page<ImportJob>> {
    const { data } = await http().GET('/v1/imports', { params: { query } });
    return data as Page<ImportJob>;
  },
  async get(id: string): Promise<Versioned<ImportJob>> {
    const { data } = await http().GET('/v1/imports/{id}', { params: { path: { id } } });
    return versioned(data as ImportJob, `/v1/imports/${id}`);
  },
  /** A draft job; the file is uploaded against it and attached with `update`. */
  async create(body: ImportJobCreate): Promise<Versioned<ImportJob>> {
    const { data } = await http().POST('/v1/imports', { body });
    const created = data as ImportJob;
    return versioned(created, `/v1/imports/${created.id}`);
  },
  /** Mapping, options or the file of a draft job (a reviewed dry run goes back to draft). */
  async update(id: string, body: ImportJobUpdate, etag?: string): Promise<Versioned<ImportJob>> {
    const ifMatch = await ifMatchOf(etag, () => importsApi.get(id));
    const { data } = await http().PATCH('/v1/imports/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return versioned(data as ImportJob, `/v1/imports/${id}`);
  },
  async analysis(id: string): Promise<ImportAnalysis> {
    const { data } = await http().GET('/v1/imports/{id}/analysis', { params: { path: { id } } });
    return data as ImportAnalysis;
  },
  async targetFields(entity: ImportEntity): Promise<ImportTargetField[]> {
    const { data } = await http().GET('/v1/import-target-fields', {
      params: { query: { entity_type: entity } },
    });
    return (data as { data: ImportTargetField[] }).data;
  },
  async lookups(id: string): Promise<ImportLookup[]> {
    const { data } = await http().GET('/v1/imports/{id}/lookups', { params: { path: { id } } });
    return (data as { data: ImportLookup[] }).data;
  },
  async startDryRun(id: string): Promise<ImportJob> {
    const { data } = await http().POST('/v1/imports/{id}/dry-run', { params: { path: { id } } });
    return data as ImportJob;
  },
  /** Commits the dry run the user reviewed; the digest keeps a changed file from sneaking in. */
  async commit(id: string, digest: string, idempotencyKey: string): Promise<ImportJob> {
    const { data } = await http().POST('/v1/imports/{id}/commit', {
      params: { path: { id }, header: { 'Idempotency-Key': idempotencyKey } },
      body: { dry_run_digest: digest },
    });
    return data as ImportJob;
  },
  async cancel(id: string): Promise<ImportJob> {
    const { data } = await http().POST('/v1/imports/{id}/cancel', { params: { path: { id } } });
    return data as ImportJob;
  },
  async rows(
    id: string,
    query: {
      phase?: 'dry_run' | 'commit';
      outcome?: ImportOutcome[];
      cursor?: string;
      limit?: number;
    } = {},
  ): Promise<Page<ImportRow>> {
    const { data } = await http().GET('/v1/imports/{id}/rows', {
      params: { path: { id }, query },
    });
    return data as Page<ImportRow>;
  },
  async mappingTemplates(entity?: ImportEntity): Promise<ImportMappingTemplate[]> {
    const { data } = await http().GET('/v1/import-mapping-templates', {
      params: { query: { limit: 100, ...(entity ? { entity_type: entity } : {}) } },
    });
    return (data as Page<ImportMappingTemplate>).data;
  },
  async saveMappingTemplate(body: ImportMappingTemplateCreate): Promise<ImportMappingTemplate> {
    const { data } = await http().POST('/v1/import-mapping-templates', { body });
    return data as ImportMappingTemplate;
  },
  async deleteMappingTemplate(id: string): Promise<void> {
    await http().DELETE('/v1/import-mapping-templates/{id}', { params: { path: { id } } });
  },
};

/** The fetch of the two CSV downloads (a plain `GET`, so the session cookie is all it needs). */
async function downloadCsv(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { accept: 'text/csv' },
  });
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  const disposition = response.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const downloadTemplate = (entity: ImportEntity, source: ImportSource = 'csv') =>
  downloadCsv(
    `/v1/import-templates/${entity}${source === 'csv' ? '' : `?source=${source}`}`,
    `${entity}-template.csv`,
  );

export const downloadErrorReport = (id: string) =>
  downloadCsv(`/v1/imports/${id}/error-report`, 'import-errors.csv');
