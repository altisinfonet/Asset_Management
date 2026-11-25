import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled, ownerTenantSql } from '../auth/support.js';
import { createTenant, defaultStatusId, insertAssets, newTenancy } from '../registry/support.js';
import type { TenantFixture } from '../registry/support.js';
import {
  type FilesHarness,
  WEB_BASE,
  downloadBatchPdf,
  requestBatch,
  runLabelJob,
  startFilesApp,
  takeRenderJobs,
} from '../tagging/support.js';

/**
 * M2-OPS-01: a 500-label PDF (QR + Code128 with tag, name and serial, 17 pages of the 30-up letter
 * template) in under 30 s at p95, measured as the worker runs it: the `label.render` handler inside its
 * tenant transaction, rendering and storing the PDF (local storage driver). LABELS_PERF_RUNS batches
 * (default 5) are rendered; the PDF of each is downloaded and checked for its page count.
 *
 * Same rule as the other perf suites: the budget is enforced only with PERF set (the nightly job); in the
 * ordinary e2e run the number is recorded (`test-results/labels-perf.json`) and only a 10x sanity
 * ceiling is asserted, because that run shares the machine with every other test file.
 */
const BUDGET_MS = 30_000;
const LABELS = 500;
const RUNS = Number(process.env.LABELS_PERF_RUNS ?? 5);
const ENFORCE = !['', '0', 'false'].includes((process.env.PERF ?? '').toLowerCase());
const SANITY_FACTOR = 10;
const limit = ENFORCE ? BUDGET_MS : BUDGET_MS * SANITY_FACTOR;

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

describe.skipIf(!dbEnabled)(`label PDF performance (${LABELS} labels)`, () => {
  const tenancy = newTenancy();
  let h: FilesHarness;
  let T: TenantFixture;
  const runs: Array<{ wall_ms: number; render_ms: number; pages: number; pdf_kib: number }> = [];

  beforeAll(async () => {
    h = await startFilesApp({
      driver: 'local',
      scanner: 'fake',
      extra: { WEB_BASE_URL: WEB_BASE },
    });
    T = await createTenant(h.app, tenancy, 'labelperf');
  }, 120_000);

  afterAll(async () => {
    await h?.close();
    await tenancy.onModuleDestroy();
    const wall = runs.map((r) => r.wall_ms).sort((x, y) => x - y);
    const out = {
      labels: LABELS,
      budgetMs: BUDGET_MS,
      enforced: ENFORCE,
      runs,
      p50: wall.length ? pct(wall, 50) : null,
      p95: wall.length ? pct(wall, 95) : null,
      max: wall.at(-1) ?? null,
    };
    const dir = join(process.cwd(), 'test-results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'labels-perf.json'), JSON.stringify(out, null, 2));
    console.log(
      `\nlabel PDF perf (${LABELS} labels, ${runs.length} runs, ms; ${ENFORCE ? 'budget ENFORCED (PERF set)' : `budget recorded only, ${SANITY_FACTOR}x sanity ceiling (set PERF=1 to enforce)`}): ` +
        `p50 ${out.p50} p95 ${out.p95} max ${out.max}; render ${runs.map((r) => r.render_ms).join(', ')}`,
    );
  });

  it(`renders a ${LABELS}-label PDF (QR + Code128) in < ${BUDGET_MS / 1000} s at p95`, async () => {
    const category = await T.admin.post('/v1/categories', { name: 'Label perf laptops' });
    const statusId = await defaultStatusId(T.admin);
    for (let run = 0; run < RUNS; run++) {
      const prefix = `P${run}${Date.now().toString(36).slice(-5).toUpperCase()}-`;
      await insertAssets(T.tenantId, category.body.id, statusId, LABELS, { tagPrefix: prefix });
      const asked = await requestBatch(T.admin, {
        template_key: 'letter-30up-qr',
        filter: { q: prefix.toLowerCase(), sort: 'asset_tag' },
        codes: ['qr', 'code128'],
        fields: ['asset_tag', 'name', 'serial'],
      });
      expect(asked.status, asked.raw).toBe(202);
      expect(asked.body.label_count).toBe(LABELS);
      takeRenderJobs(h);
      const started = performance.now();
      await runLabelJob(h, 'label.render', { tenantId: T.tenantId, batchId: asked.body.id });
      const wallMs = Math.round(performance.now() - started);
      const { pdf, batch } = await downloadBatchPdf(h, T.admin, asked.body.id as string);
      expect(batch.page_count).toBe(17);
      const row = (
        await ownerTenantSql(T.tenantId, 'select render_ms from app.label_batch where id = $1', [
          asked.body.id,
        ])
      ).rows[0] as { render_ms: number };
      runs.push({
        wall_ms: wallMs,
        render_ms: row.render_ms,
        pages: batch.page_count as number,
        pdf_kib: Math.round(pdf.length / 1024),
      });
    }
    const wall = runs.map((r) => r.wall_ms).sort((x, y) => x - y);
    expect(pct(wall, 95)).toBeLessThan(limit);
  }, 900_000);
});
