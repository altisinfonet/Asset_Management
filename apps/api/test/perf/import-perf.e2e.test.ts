import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { newObjectKey } from '../../src/storage/index.js';
import { assetRows, ASSET_HEADERS, assetCsv } from '../importer/fixtures.js';
import { analyseFile } from '../../src/importer/analysis.js';
import {
  type ImportHarness,
  type TenantFixture,
  createTenant,
  drain,
  newTenancy,
  ownerTenantSql,
  registryCounts,
  runStepOnce,
  startImportApp,
} from '../importer/support.js';

/**
 * M2-OPS-01: import throughput. A file of IMPORT_PERF_ROWS (default 3,000; the nightly job uses 100,000)
 * asset rows with real references (8 categories, 5 manufacturers, 40 models, 10 departments, 6 vendors, a
 * three-level location tree) goes through analysis, dry run and commit, driven step by step in-process (no
 * queue latency: the worker adds about a second per step), then through a second dry run and a second
 * commit of the SAME file (every row matches an existing asset by serial: the path of a re-import).
 *
 *   commit >= 10,000 rows/min, dry run of 100,000 rows < 10 min (scaled linearly for smaller files)
 *
 * Results are printed and written to `test-results/import-perf.json`.
 */
const ROWS = Number(process.env.IMPORT_PERF_ROWS ?? 3_000);
const BATCH = process.env.IMPORT_BATCH_ROWS ?? '1000';
const GATE = { commitRowsPerMinute: 10_000, dryRunMinutesPer100k: 10 } as const;

describe.skipIf(!dbEnabled)('import throughput (M2-OPS-01)', () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let t: TenantFixture;
  const out: Record<string, unknown> = { rows: ROWS, batch_rows: Number(BATCH) };

  beforeAll(async () => {
    ih = await startImportApp({
      IMPORT_BATCH_ROWS: BATCH,
      IMPORT_MAX_ROWS: String(Math.max(ROWS, 100_000)),
    });
    t = await createTenant(ih.h.app, tenancy, 'impperf');
  }, 120_000);
  afterAll(async () => {
    mkdirSync('test-results', { recursive: true });
    writeFileSync(join('test-results', 'import-perf.json'), JSON.stringify(out, null, 2));
    console.log(`import-perf ${JSON.stringify(out)}`);
    await ih.h.close();
    await tenancy.onModuleDestroy();
  });

  /** Stores the file as the upload pipeline would have (the 10 MiB cap of the free tier is not what is measured). */
  async function putFile(importId: string, body: Buffer): Promise<string> {
    const key = newObjectKey(t.tenantId, { variant: 'csv' });
    await ih.h.storage.write(key, body, { contentType: 'text/csv' });
    const id = randomUUID();
    await ownerTenantSql(
      t.tenantId,
      `insert into app.attachment (id, tenant_id, entity_type, entity_id, kind, storage_key, filename, content_type, size_bytes, scan_status, uploaded_at)
       values ($1, $2, 'import_job', $3, 'import_file', $4, 'perf.csv', 'text/csv', $5, 'clean', now())`,
      [id, t.tenantId, importId, key, body.length],
    );
    return id;
  }

  const secs = (ms: number) => Math.round(ms / 10) / 100;

  it(`analyses, dry-runs and commits ${ROWS.toLocaleString('en')} rows, then re-imports them`, async () => {
    const body = Buffer.from(assetCsv(ROWS, 'PF'), 'utf8');
    out.file_bytes = body.length;
    const created = await t.admin.post('/v1/imports', { entity_type: 'asset' });
    const id = created.body.id as string;
    const att = await putFile(id, body);

    let t0 = performance.now();
    expect(
      (await t.admin.post(`/v1/imports/${id}/analyze`, { file_attachment_id: att })).status,
    ).toBe(202);
    const analysed = await drain(ih, t.admin, t.tenantId, id, 100_000);
    out.analyze_seconds = secs(performance.now() - t0);
    expect(analysed).toMatchObject({ state: 'analyzed', rows_total: ROWS });

    const before = await registryCounts(t.tenantId);
    t0 = performance.now();
    expect((await t.admin.post(`/v1/imports/${id}/dry-run`, {})).status).toBe(202);
    const dry = await drain(ih, t.admin, t.tenantId, id, 100_000);
    const dryMs = performance.now() - t0;
    out.dry_run_seconds = secs(dryMs);
    out.dry_run_rows_per_minute = Math.round((ROWS / dryMs) * 60_000);
    expect(dry.state, dry.error ?? '').toBe('dry_run_done');
    expect(dry.counts.dry_run).toEqual({ create: ROWS, update: 0, skip: 0, error: 0 });
    expect(await registryCounts(t.tenantId)).toEqual(before);

    t0 = performance.now();
    const res = await t.admin.post(
      `/v1/imports/${id}/commit`,
      { dry_run_digest: dry.dry_run_digest },
      { headers: { 'idempotency-key': `perf-${id}` } },
    );
    expect(res.status, res.raw).toBe(202);
    // interactive requests while the commit runs: list p95 must not suffer (M2-IMP-05)
    const idle: number[] = [];
    for (let i = 0; i < 25; i++) {
      const l0 = performance.now();
      expect((await t.admin.get('/v1/assets?limit=50')).status).toBe(200);
      idle.push(performance.now() - l0);
    }
    const loaded: number[] = [];
    let committing = true;
    const sampler = (async () => {
      while (committing) {
        const l0 = performance.now();
        await t.admin.get('/v1/assets?limit=50');
        loaded.push(performance.now() - l0);
        await new Promise((r) => setTimeout(r, 50));
      }
    })();
    const stepMs: number[] = [];
    let done = (await t.admin.get(`/v1/imports/${id}`)).body;
    while (done.state === 'committing') {
      const s0 = performance.now();
      await runStepOnce(ih, t.tenantId, id);
      stepMs.push(Math.round(performance.now() - s0));
      done = (await t.admin.get(`/v1/imports/${id}`)).body;
    }
    out.commit_step_ms = stepMs;
    committing = false;
    await sampler;
    const p95 = (a: number[]) =>
      [...a].sort((x, y) => x - y)[Math.max(0, Math.ceil(a.length * 0.95) - 1)]!;
    out.list_p95_ms_idle = Math.round(p95(idle));
    out.list_p95_ms_during_commit = Math.round(p95(loaded));
    out.list_samples_during_commit = loaded.length;
    const commitMs = performance.now() - t0;
    out.commit_seconds = secs(commitMs);
    out.commit_rows_per_minute = Math.round((ROWS / commitMs) * 60_000);
    expect(done.counts.commit).toEqual({ created: ROWS, updated: 0, skipped: 0, error: 0 });
    expect((await registryCounts(t.tenantId)).assets).toBe(before.assets + ROWS);

    // the same file again, matched by serial: nothing to do, and how fast the matching path is
    const second = await t.admin.post('/v1/imports', {
      entity_type: 'asset',
      options: { match_on: 'serial', on_match: 'update' },
    });
    const att2 = await putFile(second.body.id as string, body);
    await t.admin.post(`/v1/imports/${second.body.id}/analyze`, { file_attachment_id: att2 });
    await drain(ih, t.admin, t.tenantId, second.body.id as string, 100_000);
    t0 = performance.now();
    await t.admin.post(`/v1/imports/${second.body.id}/dry-run`, {});
    const redry = await drain(ih, t.admin, t.tenantId, second.body.id as string, 100_000);
    out.redry_run_seconds = secs(performance.now() - t0);
    expect(redry.counts.dry_run).toEqual({ create: 0, update: 0, skip: ROWS, error: 0 });

    // gates (scaled): commit throughput, and a dry run of 100k rows inside 10 minutes
    const projectedDryMinutes = ((dryMs / ROWS) * 100_000) / 60_000;
    out.projected_dry_run_minutes_100k = Math.round(projectedDryMinutes * 10) / 10;
    expect(out.commit_rows_per_minute as number).toBeGreaterThanOrEqual(GATE.commitRowsPerMinute);
    // interactive list stays inside its 500 ms budget while an import commits
    expect(out.list_p95_ms_during_commit as number).toBeLessThan(500);
    expect(projectedDryMinutes).toBeLessThan(GATE.dryRunMinutesPer100k);
  }, 3_600_000);

  it(`reads a ${ROWS.toLocaleString('en')}-row XLSX as a stream (time and memory)`, async () => {
    const cell = (c: number, r: number, v: string) =>
      v === ''
        ? ''
        : `<c r="${String.fromCharCode(65 + c)}${r}" t="inlineStr"><is><t>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></is></c>`;
    const rowsXml = [ASSET_HEADERS, ...assetRows(ROWS, 'XL')]
      .map(
        (cells, i) => `<row r="${i + 1}">${cells.map((v, c) => cell(c, i + 1, v)).join('')}</row>`,
      )
      .join('');
    const book = Buffer.from(
      zipSync({
        'xl/workbook.xml': strToU8(
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Assets" sheetId="1" r:id="rId1"/></sheets></workbook>',
        ),
        'xl/_rels/workbook.xml.rels': strToU8(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        ),
        'xl/worksheets/sheet1.xml': strToU8(
          `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`,
        ),
      }),
    );
    out.xlsx_file_bytes = book.length;
    let rows = 0;
    let peak = 0;
    const base = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const a = await analyseFile({
      open: () => Promise.resolve(Readable.from([book])),
      filename: 'perf.xlsx',
      overrides: {},
      entity: 'asset',
      custom: [],
      maxRows: 1_000_000,
      sink: async (batch) => {
        rows += batch.length;
        peak = Math.max(peak, process.memoryUsage().heapUsed - base);
      },
    });
    out.xlsx_analyze_seconds = secs(performance.now() - t0);
    out.xlsx_peak_heap_growth_mb = Math.round(peak / 1_048_576);
    expect(rows).toBe(ROWS);
    expect(a.rowsTotal).toBe(ROWS);
    expect(a.headers).toEqual(ASSET_HEADERS);
  }, 600_000);
});
