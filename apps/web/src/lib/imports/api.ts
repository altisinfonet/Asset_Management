import { ApiError, type components, type operations } from '@assettracker/api-client';
import { getApi } from '@/lib/api';
import type { Page, Versioned } from '@/lib/registry/types';

/**
 * Imports (M2-IMP, ED-18/ED-19/ED-25) over the generated client: the job and its state machine, the
 * background steps (analyse, dry run, commit), the data dictionary of the presets, value lookups,
 * per-row results, saved mapping templates and the downloads. Every call mirrors the contract in
 * docs/engineering/openapi.yaml (tag Imports); nothing here is the web's own invention.
 */
type S = components['schemas'];
export type ImportJob = S['ImportJob'];
export type ImportCreate = S['ImportCreate'];
export type ImportUpdate = S['ImportUpdate'];
export type ImportState = ImportJob['state'];
export type ImportEntity = ImportJob['entity_type'];
export type ImportSource = ImportJob['source'];
export type ImportOptions = S['ImportOptions'];
export type ImportMapping = S['ImportMapping'];
export type ImportMappingColumn = S['ImportMappingColumn'];
export type ImportValueEntry = S['ImportValueEntry'];
export type ImportValueMap = S['ImportValueMap'];
export type ImportColumnProfile = S['ImportColumnProfile'];
export type ImportRow = S['ImportRow'];
export type ImportRowIssue = S['RowIssue'];
export type ImportValue = S['ImportValue'];
export type ImportValues = S['ImportValues'];
export type ImportRefKind = ImportValues['field'];
export type ImportPreset = S['ImportPreset'];
export type ImportPresetColumn = S['ImportPresetColumn'];
export type ImportTemplate = S['ImportTemplate'];
export type ImportDateFormat = NonNullable<ImportMappingColumn['date_format']>;
export type ImportAnalyze = S['ImportAnalyze'];

type Query<K extends keyof operations> = operations[K]['parameters'] extends {
  query?: infer Q;
}
  ? Q
  : never;
export type ImportListQuery = Query<'listImports'>;
export type ImportRowsQuery = Query<'listImportRows'>;
export type ImportPhase = NonNullable<ImportRowsQuery['phase']>;

/** The states in which a worker is busy: the screens poll until the job leaves them. */
export const RUNNING_STATES: readonly ImportState[] = ['analyzing', 'dry_running', 'committing'];
/** Final states. */
export const FINAL_STATES: readonly ImportState[] = ['completed', 'failed', 'cancelled'];

/** How often a screen polls a running import, in milliseconds (the API says `Retry-After: 2`; a second reads better). */
export const POLL_MS = 1000;

/** Query keys: one place, so every screen invalidates the same things. */
export const importKeys = {
  all: ['imports'] as const,
  list: () => ['imports', 'list'] as const,
  presets: () => ['imports', 'presets'] as const,
  job: (id: string) => ['import', id] as const,
  rows: (id: string) => ['import', id, 'rows'] as const,
  values: (id: string, field: string) => ['import', id, 'values', field] as const,
  templates: (entity: string) => ['import-templates', entity] as const,
};

/** The refetch interval of a job query: poll while a worker is busy, else not at all. */
export const pollWhileRunning = (state: ImportState | undefined): number | false =>
  state && RUNNING_STATES.includes(state) ? POLL_MS : false;

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
  /** A `draft` import; the file is uploaded against it (an attachment of kind `import_file`) and then analysed. */
  async create(body: ImportCreate): Promise<Versioned<ImportJob>> {
    const { data } = await http().POST('/v1/imports', { body });
    const created = data as ImportJob;
    return versioned(created, `/v1/imports/${created.id}`);
  },
  /** Mapping, options and value map; a reviewed dry run goes back to `mapped` and its digest is cleared. */
  async update(id: string, body: ImportUpdate, etag?: string): Promise<Versioned<ImportJob>> {
    const ifMatch = await ifMatchOf(etag, () => importsApi.get(id));
    const { data } = await http().PATCH('/v1/imports/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return versioned(data as ImportJob, `/v1/imports/${id}`);
  },
  /** Queues the analysis of the uploaded file (`202`); without `file_attachment_id` the file is read again. */
  async analyze(id: string, body: ImportAnalyze = {}): Promise<ImportJob> {
    const { data } = await http().POST('/v1/imports/{id}/analyze', {
      params: { path: { id } },
      body,
    });
    return data as ImportJob;
  },
  async applyTemplate(id: string, templateId: string): Promise<Versioned<ImportJob>> {
    const { data } = await http().POST('/v1/imports/{id}/apply-template', {
      params: { path: { id } },
      body: { template_id: templateId },
    });
    return versioned(data as ImportJob, `/v1/imports/${id}`);
  },
  /** Queues the dry run (`202`); poll the job until it is `dry_run_done`. */
  async startDryRun(id: string): Promise<ImportJob> {
    const { data } = await http().POST('/v1/imports/{id}/dry-run', { params: { path: { id } } });
    return data as ImportJob;
  },
  /** Queues the commit of the dry run the user reviewed (`202`); the digest keeps a changed file from sneaking in. */
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
  async rows(id: string, query: ImportRowsQuery = {}): Promise<Page<ImportRow>> {
    const { data } = await http().GET('/v1/imports/{id}/rows', {
      params: { path: { id }, query },
    });
    return data as Page<ImportRow>;
  },
  /** The distinct values of the column mapped to a reference kind, with the record each matches by name. */
  async values(
    id: string,
    field: ImportRefKind,
    query: { limit?: number; q?: string } = {},
  ): Promise<ImportValues> {
    const { data } = await http().GET('/v1/imports/{id}/values', {
      params: { path: { id }, query: { field, ...query } },
    });
    return data as ImportValues;
  },
  async presets(): Promise<ImportPreset[]> {
    const { data } = await http().GET('/v1/imports/presets');
    return (data as { data: ImportPreset[] }).data;
  },
};

export const importTemplatesApi = {
  async list(entity?: ImportEntity): Promise<ImportTemplate[]> {
    const { data } = await http().GET('/v1/import-templates', {
      params: { query: { limit: 100, ...(entity ? { entity_type: entity } : {}) } },
    });
    return (data as Page<ImportTemplate>).data;
  },
  async get(id: string): Promise<Versioned<ImportTemplate>> {
    const { data } = await http().GET('/v1/import-templates/{id}', { params: { path: { id } } });
    return versioned(data as ImportTemplate, `/v1/import-templates/${id}`);
  },
  /** Saves the mapping and options of an import (by header) under a name. */
  async createFromImport(name: string, importId: string): Promise<ImportTemplate> {
    const { data } = await http().POST('/v1/import-templates', {
      body: { name, from_import_id: importId },
    });
    return data as ImportTemplate;
  },
  async remove(id: string, etag?: string): Promise<void> {
    const ifMatch = await ifMatchOf(etag, () => importTemplatesApi.get(id));
    await http().DELETE('/v1/import-templates/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
  },
};

// ---- problems of the import endpoints --------------------------------------------------------------

/** What the import endpoints add to a problem: the current state, the allowed ones, the digest, when to retry. */
export interface ImportProblem {
  code: string | undefined;
  status: number;
  /** `import-wrong-state`: where the import is now. */
  state?: ImportState;
  /** `import-wrong-state`: where the action would have been possible. */
  allowed?: ImportState[];
  /** `import-stale-dry-run`: the digest of the latest dry run. */
  currentDigest?: string | null;
  /** `import-quota-exceeded`: seconds until another import may start. */
  retryAfterSeconds?: number;
}

/** Reads the extension members of an `import-*` problem out of a thrown `ApiError`; null for any other error. */
export function importProblemOf(err: unknown): ImportProblem | null {
  if (!(err instanceof ApiError)) return null;
  const body = (err.body ?? {}) as {
    code?: string;
    state?: ImportState;
    allowed?: ImportState[];
    current_digest?: string | null;
  };
  return {
    code: err.code,
    status: err.status,
    ...(body.state ? { state: body.state } : {}),
    ...(Array.isArray(body.allowed) ? { allowed: body.allowed } : {}),
    ...('current_digest' in body ? { currentDigest: body.current_digest ?? null } : {}),
    ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
  };
}

// ---- downloads ----------------------------------------------------------------------------------------

/** The fetch of a file download (a plain `GET`: the session cookie is all it needs). */
async function download(path: string, accept: string, fallbackName: string): Promise<void> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { accept } });
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

export type TemplateFormat = 'csv' | 'xlsx';

/** The template file of a preset (`GET /v1/imports/presets/{key}/template`). */
export const downloadTemplate = (presetKey: string, format: TemplateFormat = 'csv') =>
  download(
    `/v1/imports/presets/${encodeURIComponent(presetKey)}/template?format=${format}`,
    format === 'csv'
      ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    `${presetKey}-template.${format}`,
  );

/** The error report of an import: the rows the dry run rejected, or after a commit the rows that failed. */
export const downloadErrorReport = (id: string) =>
  download(`/v1/imports/${id}/errors.csv`, 'text/csv', `import-${id.slice(0, 8)}-errors.csv`);
