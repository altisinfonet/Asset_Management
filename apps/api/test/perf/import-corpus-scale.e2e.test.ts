import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { newObjectKey } from '../../src/storage/index.js';
import { messyAssetCsv, messyExpectation } from '../importer/corpus.js';
import {
  type ImportHarness,
  type Json,
  type TenantFixture,
  analyzed,
  createTenant,
  drain,
  newTenancy,
  ownerTenantSql,
  registryCounts,
  startImportApp,
} from '../importer/support.js';

/**
 * M2-IMP-09: the scale case of the messy-file corpus. `messyAssetCsv` GENERATES the file at test time
 * (never checked in; the same bytes for the same row count): UTF-8 with a BOM, semicolons, a title line,
 * a blank trailing column, European decimals and day-first dates, quoted notes with semicolons and line
 * breaks, formula-looking notes, duplicate serials (other case) and impossible dates, blank lines.
 *
 * The ordinary e2e run imports 2,000 rows through the real upload; the nightly perf job (PERF=1, see
 * .github/workflows/perf.yml) imports 100,000 (`IMPORT_CORPUS_ROWS` overrides both), storing the file
 * the way the upload pipeline would (its size is above the free tier's attachment cap, which is not
 * what is measured). Results go to `test-results/import-corpus-perf.json`.
 */
const PERF = !['', '0', 'false'].includes((process.env.PERF ?? '').toLowerCase());
const ROWS = Number(process.env.IMPORT_CORPUS_ROWS ?? (PERF ? 100_000 : 2_000));
const GATE = { commitRowsPerMinute: 10_000, dryRunMinutesPer100k: 10 } as const;

describe.skipIf(!dbEnabled)('import corpus at scale (M2-IMP-09)', () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let t: TenantFixture;
  const out: Record<string, unknown> = { rows: ROWS };

  beforeAll(async () => {
    ih = await startImportApp({ IMPORT_MAX_ROWS: String(Math.max(ROWS, 100_000)) });
    t = await createTenant(ih.h.app, tenancy, 'corpusscale');
  }, 120_000);
  afterAll(async () => {
    mkdirSync('test-results', { recursive: true });
    writeFileSync(join('test-results', 'import-corpus-perf.json'), JSON.stringify(out, null, 2));
    console.log(`import-corpus ${JSON.stringify(out)}`);
    await ih.h.close();
    await tenancy.onModuleDestroy();
  });

  /** Large files: stored as the upload pipeline would have stored them, then analysed. */
  async function analyseStored(body: Buffer): Promise<Json> {
    const created = await t.admin.post('/v1/imports', { entity_type: 'asset' });
    const id = created.body.id as string;
    const key = newObjectKey(t.tenantId, { variant: 'csv' });
    await ih.h.storage.write(key, body, { contentType: 'text/csv' });
    const att = randomUUID();
    await ownerTenantSql(
      t.tenantId,
      `insert into app.attachment (id, tenant_id, entity_type, entity_id, kind, storage_key, filename, content_type, size_bytes, scan_status, uploaded_at)
       values ($1, $2, 'import_job', $3, 'import_file', $4, 'inventar.csv', 'text/csv', $5, 'clean', now())`,
      [att, t.tenantId, id, key, body.length],
    );
    const res = await t.admin.post(`/v1/imports/${id}/analyze`, { file_attachment_id: att });
    expect(res.status, res.raw).toBe(202);
    return drain(ih, t.admin, t.tenantId, id, 100_000);
  }

  const secs = (ms: number) => Math.round(ms / 10) / 100;

  it(`imports ${ROWS.toLocaleString('en')} generated messy rows end to end`, async () => {
    const body = messyAssetCsv(ROWS);
    // deterministic: the generator gives the same bytes twice
    expect(messyAssetCsv(ROWS).equals(body)).toBe(true);
    out.file_bytes = body.length;
    const expected = messyExpectation(ROWS);

    let t0 = performance.now();
    const job =
      body.length < 5 * 1024 * 1024
        ? await analyzed(ih, t.admin, t.tenantId, 'asset', { filename: 'inventar.csv', body })
        : await analyseStored(body);
    out.analyze_seconds = secs(performance.now() - t0);
    expect(job, job.error ?? '').toMatchObject({
      state: 'analyzed',
      rows_total: ROWS,
      parse: { format: 'csv', encoding: 'utf-8', delimiter: ';', header_line: 2 },
    });
    expect(job.headers[0]).toBe('Asset Tag');
    expect(job.headers[1]).toBe('Serial Number');
    expect(job.headers.at(-1)).toBe('Column K');
    const cols = Object.fromEntries(job.mapping.columns.map((c: Json) => [c.target, c]));
    expect(cols.purchase_date.date_format).toBe('dmy');
    expect(cols.serial.index).toBe(1);

    const before = await registryCounts(t.tenantId);
    t0 = performance.now();
    expect((await t.admin.post(`/v1/imports/${job.id}/dry-run`, {})).status).toBe(202);
    const dry = await drain(ih, t.admin, t.tenantId, job.id, 100_000);
    const dryMs = performance.now() - t0;
    out.dry_run_seconds = secs(dryMs);
    expect(dry.state, dry.error ?? '').toBe('dry_run_done');
    expect(dry.counts.dry_run).toEqual({ ...expected, update: 0 });
    expect(dry.summary.errors_by_code).toEqual([
      { code: 'date', field: 'purchase_date', n: expected.error },
    ]);
    expect(await registryCounts(t.tenantId)).toEqual(before);

    t0 = performance.now();
    const res = await t.admin.post(
      `/v1/imports/${job.id}/commit`,
      { dry_run_digest: dry.dry_run_digest },
      { headers: { 'idempotency-key': `corpus-${job.id}` } },
    );
    expect(res.status, res.raw).toBe(202);
    const done = await drain(ih, t.admin, t.tenantId, job.id, 100_000);
    const commitMs = performance.now() - t0;
    out.commit_seconds = secs(commitMs);
    out.commit_rows_per_minute = Math.round((expected.create / commitMs) * 60_000);
    expect(done.state, done.error ?? '').toBe('completed');
    expect(done.counts.commit).toEqual({
      created: expected.create,
      updated: 0,
      skipped: expected.skip,
      error: expected.error,
    });
    expect((await registryCounts(t.tenantId)).assets).toBe(before.assets + expected.create);

    // spot checks: the values of the first rows were parsed the European way
    const get = async (serial: string) =>
      (await t.admin.get(`/v1/assets?serial=${serial}`)).body.data as Json[];
    const [a0] = await get('MS-0000000');
    expect(a0).toMatchObject({
      name: 'Portátil 0',
      purchase_date: '2024-01-01',
      purchase_cost: { amount_minor: 110000, currency: 'USD' },
      notes: 'Akku; Netzteil\nzweite Zeile',
    });
    const [a1] = await get('MS-0000001');
    expect(a1).toMatchObject({
      name: 'Écran 1',
      purchase_date: '2024-02-02',
      purchase_cost: { amount_minor: 10101, currency: 'USD' },
    });
    // row 50 repeats row 49's serial in lower case: one asset, not two
    expect(await get('MS-0000049')).toHaveLength(1);
    // row 7 has 31.02.2024: no asset
    expect(await get('MS-0000007')).toHaveLength(0);

    if (PERF) {
      expect(out.commit_rows_per_minute as number).toBeGreaterThanOrEqual(GATE.commitRowsPerMinute);
      expect(((dryMs / ROWS) * 100_000) / 60_000).toBeLessThan(GATE.dryRunMinutesPer100k);
    }
  }, 3_600_000);
});
