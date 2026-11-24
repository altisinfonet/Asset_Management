import pino from 'pino';
import { ImportEngine, ImportRunner } from '../../src/importer/index.js';
import { TenancyService } from '../../src/tenancy/index.js';
import { type Client, type Resp, ownerTenantSql } from '../lifecycle/support.js';
import { type FilesHarness, startFilesApp, uploadFile } from '../files/support.js';

export * from '../lifecycle/support.js';
export { startFilesApp, type FilesHarness };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

const logger = pino({ level: 'silent' });

export interface ImportHarness {
  h: FilesHarness;
  runtime: TenancyService;
  runner: ImportRunner;
  engine: ImportEngine;
}

export async function startImportApp(extra: Record<string, string> = {}): Promise<ImportHarness> {
  const h = await startFilesApp({ driver: 'local', scanner: 'fake', extra });

  return {
    h,
    runtime: h.app.get(TenancyService, { strict: false }),
    runner: h.app.get(ImportRunner, { strict: false }),
    engine: h.app.get(ImportEngine, { strict: false }),
  };
}

/** The job context a worker hands to a handler (the transaction is the test's own). */
const ctxOf = (tenantId: string, tx: never, retryCount = 0) => ({
  tenantId,
  tx,
  jobId: 'job-1',
  queue: 'import.step',
  retryCount,
  logger,
});

export async function runStepOnce(
  ih: ImportHarness,
  tenantId: string,
  importId: string,
): Promise<void> {
  await ih.runtime.withTenantTx({ tenantId }, (tx) =>
    ih.runner.step({ tenantId, importId }, ctxOf(tenantId, tx as never)),
  );
}
export async function runAnalyzeOnce(
  ih: ImportHarness,
  tenantId: string,
  importId: string,
): Promise<void> {
  await ih.runtime.withTenantTx({ tenantId }, (tx) =>
    ih.runner.analyze({ tenantId, importId }, ctxOf(tenantId, tx as never)),
  );
}

const RUNNING = new Set(['analyzing', 'dry_running', 'committing']);

/** Plays the worker: runs the analysis or steps until the import is no longer running. Returns the number of steps. */
export async function drain(
  ih: ImportHarness,
  client: Client,
  tenantId: string,
  importId: string,
  limit = 500,
): Promise<Json> {
  for (let i = 0; i < limit; i++) {
    const res = await client.get(`/v1/imports/${importId}`);
    if (res.status !== 200) throw new Error(`get import: ${res.status} ${res.raw}`);
    if (!RUNNING.has(res.body.state)) return res.body;
    if (res.body.state === 'analyzing') await runAnalyzeOnce(ih, tenantId, importId);
    else await runStepOnce(ih, tenantId, importId);
  }
  throw new Error('import did not settle');
}

/** Creates an import, uploads `body` as its file (marked clean as the scan would) and analyses it. */
export async function analyzed(
  ih: ImportHarness,
  client: Client,
  tenantId: string,
  entity: string,
  file: { filename: string; body: Buffer | string; content_type?: string },
  create: Record<string, unknown> = {},
  parse: Record<string, unknown> | undefined = undefined,
): Promise<Json> {
  const created = await client.post('/v1/imports', { entity_type: entity, ...create });
  if (created.status !== 201) throw new Error(`create import: ${created.status} ${created.raw}`);
  const id = created.body.id as string;
  const bytes = Buffer.isBuffer(file.body) ? file.body : Buffer.from(file.body, 'utf8');
  const up = await uploadFile(
    ih.h,
    client,
    tenantId,
    { entity_type: 'import_job', entity_id: id },
    {
      filename: file.filename,
      content_type:
        file.content_type ??
        (file.filename.endsWith('.xlsx')
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv'),
      body: bytes,
      kind: 'import_file',
    },
  );
  await ownerTenantSql(tenantId, "update app.attachment set scan_status = 'clean' where id = $1", [
    up.id,
  ]);
  const res = await client.post(`/v1/imports/${id}/analyze`, {
    file_attachment_id: up.id,
    ...(parse ? { parse } : {}),
  });
  if (res.status !== 202) throw new Error(`analyze: ${res.status} ${res.raw}`);
  return drain(ih, client, tenantId, id);
}

export async function patchImport(
  client: Client,
  id: string,
  body: Record<string, unknown>,
): Promise<Resp> {
  const cur = await client.get(`/v1/imports/${id}`);
  return client.patch(`/v1/imports/${id}`, body, {
    headers: { 'if-match': String(cur.headers.etag) },
  });
}

/** Maps columns by header: `{ 'Serial': 'serial' }` -> the mapping the API expects. */
export function mappingOf(job: Json, byHeader: Record<string, string | null>): Json {
  return {
    columns: (job.headers as string[]).map((h, index) => ({
      index,
      target: h in byHeader ? byHeader[h] : null,
    })),
  };
}

export async function dryRun(
  ih: ImportHarness,
  client: Client,
  tenantId: string,
  id: string,
): Promise<Json> {
  const res = await client.post(`/v1/imports/${id}/dry-run`, {});
  if (res.status !== 202) throw new Error(`dry-run: ${res.status} ${res.raw}`);
  return drain(ih, client, tenantId, id);
}

export async function commit(
  ih: ImportHarness,
  client: Client,
  tenantId: string,
  id: string,
  digest: string,
  key = `commit-${id}-${Date.now()}`,
): Promise<Json> {
  const res = await client.post(
    `/v1/imports/${id}/commit`,
    { dry_run_digest: digest },
    { headers: { 'idempotency-key': key } },
  );
  if (res.status !== 202) throw new Error(`commit: ${res.status} ${res.raw}`);
  return drain(ih, client, tenantId, id);
}

export async function allRows(client: Client, id: string, query = ''): Promise<Json[]> {
  const out: Json[] = [];
  let cursor: string | null = null;
  do {
    const res: Resp = await client.get(
      `/v1/imports/${id}/rows?limit=200${query}${cursor ? `&cursor=${cursor}` : ''}`,
    );
    if (res.status !== 200) throw new Error(`rows: ${res.status} ${res.raw}`);
    out.push(...res.body.data);
    cursor = res.body.page.next_cursor;
  } while (cursor);
  return out;
}

/** Counts of registry tables of a tenant, read as the owner (a dry run must change none of them). */
export interface Counts {
  assets: number;
  people: number;
  locations: number;
  departments: number;
  categories: number;
  models: number;
  manufacturers: number;
  vendors: number;
  assignments: number;
  history: number;
  audit_other: number;
  outbox_other: number;
}
export async function registryCounts(tenantId: string): Promise<Counts> {
  const res = await ownerTenantSql(
    tenantId,
    `select
       (select count(*) from app.asset)::int as assets,
       (select count(*) from app.person)::int as people,
       (select count(*) from app.location)::int as locations,
       (select count(*) from app.department)::int as departments,
       (select count(*) from app.category)::int as categories,
       (select count(*) from app.asset_model)::int as models,
       (select count(*) from app.manufacturer)::int as manufacturers,
       (select count(*) from app.vendor)::int as vendors,
       (select count(*) from app.assignment)::int as assignments,
       (select count(*) from app.asset_history)::int as history,
       (select count(*) from app.audit_log where entity_type not in ('import_job', 'attachment'))::int as audit_other,
       (select count(*) from app.outbox_event where aggregate_type not in ('import_job', 'attachment'))::int as outbox_other`,
  );
  return res.rows[0] as Counts;
}

/** Builds a CSV text (quoting where needed). */
export function csv(rows: Array<Array<string | number | null>>, delimiter = ','): string {
  const q = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${rows.map((r) => r.map(q).join(delimiter)).join('\r\n')}\r\n`;
}
