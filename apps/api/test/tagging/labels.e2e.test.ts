import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LABEL_TEMPLATES, slotRect, slotsPerPage } from '../../src/tagging/index.js';
import { type Client, dbEnabled, ownerTenantSql } from '../auth/support.js';
import { createUser, insertAssets, defaultStatusId } from '../registry/support.js';
import {
  type TenantFixture,
  auditRows,
  createTenant,
  newTenancy,
  outboxRows,
  seedBasics,
  unique,
} from '../registry/support.js';
import { uploadFile, drainJobs } from '../files/support.js';
import { png } from '../support/file-fixtures.js';
import {
  type PageRaster,
  decodeRegion,
  openPdf,
  pageText,
  rasterize,
} from '../support/pdf-decode.js';
import {
  type FilesHarness,
  WEB_BASE,
  downloadBatchPdf,
  idem,
  requestBatch,
  runLabelJob,
  startFilesApp,
  takeRenderJobs,
} from './support.js';

/** Prints a measured number; also appends it to $LABELS_PERF_OUT when that file is named (for the report). */
function perfNote(message: string): void {
  console.info(message);
  if (process.env.LABELS_PERF_OUT) appendFileSync(process.env.LABELS_PERF_OUT, `${message}\n`);
}

/**
 * M2-TAG-02 end to end: templates, the batch request, the worker job, the stored PDF decoded with
 * pdf.js + a QR / Code128 reader, history, audit, outbox, expiry and failure. Runs against the local
 * storage driver (real files, real presigned-style URLs) in direct and pooled mode like every e2e.
 */
describe.skipIf(!dbEnabled)('labels (M2-TAG-02)', () => {
  const tenancy = newTenancy();
  let h: FilesHarness;
  let T: TenantFixture;
  let B: TenantFixture;
  let categoryId: string;
  let tech: Client;
  let viewer: Client;
  let techId: string;

  /** Creates `count` assets with names, serials and a model, returns id, tag, code in creation order. */
  async function newAssets(count: number, extra: Record<string, unknown> = {}) {
    const out: Array<{ id: string; asset_tag: string; label_code: string; name: string }> = [];
    for (let i = 0; i < count; i++) {
      const res = await T.admin.post('/v1/assets', {
        category_id: categoryId,
        name: `Chromebook ${unique('n')}`,
        serial: unique('SN'),
        ...extra,
      });
      expect(res.status, res.raw).toBe(201);
      out.push(res.body);
    }
    return out;
  }

  const render = async (client: Client, body: Record<string, unknown>) => {
    const res = await requestBatch(client, body);
    expect(res.status, res.raw).toBe(202);
    // jobs of earlier requests in this file may still be queued: run the one of this batch
    const mine = takeRenderJobs(h).filter((j) => j.batchId === res.body.id);
    expect(mine).toHaveLength(1);
    await runLabelJob(h, 'label.render', mine[0]!);
    return downloadBatchPdf(h, client, res.body.id as string);
  };

  beforeAll(async () => {
    h = await startFilesApp({
      driver: 'local',
      scanner: 'fake',
      extra: { WEB_BASE_URL: WEB_BASE },
    });
    T = await createTenant(h.app, tenancy, 'labels');
    B = await createTenant(h.app, tenancy, 'labelsb');
    ({
      category: { id: categoryId },
    } = await seedBasics(T.admin));
    const techUser = await createUser(h.app, T, 'technician');
    tech = techUser.client;
    techId = techUser.id;
    viewer = (await createUser(h.app, T, 'viewer')).client;
  });
  afterAll(async () => {
    await h.close();
    await tenancy.onModuleDestroy();
  });

  // ------------------------------------------------------------------------------------ templates

  describe('templates', () => {
    it('a bootstrapped tenant has the six fixed templates, equal to the code constants', async () => {
      const res = await T.admin.get('/v1/labels/templates');
      expect(res.status).toBe(200);
      const data = res.body.data as Array<Record<string, unknown>>;
      expect(data.map((t) => t.key)).toEqual(LABEL_TEMPLATES.map((t) => t.key));
      for (const c of LABEL_TEMPLATES) {
        const t = data.find((x) => x.key === c.key)!;
        expect(t, c.key).toMatchObject({
          name: c.name,
          page_size: c.pageSize,
          page_width_mm: c.pageWidthMm,
          page_height_mm: c.pageHeightMm,
          label_width_mm: c.labelWidthMm,
          label_height_mm: c.labelHeightMm,
          cols: c.cols,
          rows: c.rows,
          slots: c.cols * c.rows,
          margin_top_mm: c.marginTopMm,
          margin_left_mm: c.marginLeftMm,
          gap_x_mm: c.gapXMm,
          gap_y_mm: c.gapYMm,
          offset_x_mm: 0,
          offset_y_mm: 0,
          code_type: c.codeType,
          fields: c.fields,
          is_system: true,
        });
      }
    });

    it('a tenant without templates (provisioned another way) gets them on first use; seeding is idempotent and tenant-bound', async () => {
      const other = await createTenant(h.app, tenancy, 'labelsempty');
      await ownerTenantSql(other.tenantId, 'delete from app.label_template');
      expect(
        (await ownerTenantSql(other.tenantId, 'select count(*)::int as n from app.label_template'))
          .rows[0].n,
      ).toBe(0);
      const first = await other.admin.get('/v1/labels/templates');
      expect(first.body.data).toHaveLength(LABEL_TEMPLATES.length);
      const second = await other.admin.get('/v1/labels/templates');
      expect(second.body.data.map((t: { id: string }) => t.id)).toEqual(
        first.body.data.map((t: { id: string }) => t.id),
      );
      // the function itself: no rows twice, and it refuses another tenant's id
      const again = await ownerTenantSql(
        other.tenantId,
        'select app.seed_label_templates($1::uuid) as n',
        [other.tenantId],
      );
      expect(again.rows[0].n).toBe(0);
      await expect(
        ownerTenantSql(other.tenantId, 'select app.seed_label_templates($1::uuid)', [T.tenantId]),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('is readable with asset:label (manager, technician), not by a viewer; only managers calibrate', async () => {
      expect((await tech.get('/v1/labels/templates')).status).toBe(200);
      expect((await viewer.get('/v1/labels/templates')).status).toBe(403);
      const list = (await T.admin.get('/v1/labels/templates')).body.data as Array<{ id: string }>;
      const one = await tech.get(`/v1/labels/templates/${list[0]!.id}`);
      expect(one.status).toBe(200);
      expect(String(one.headers.etag)).toMatch(/^W\/"\d+"$/);
      expect(
        (
          await tech.patch(
            `/v1/labels/templates/${list[0]!.id}`,
            { offset_x_mm: 1 },
            {
              headers: { 'if-match': String(one.headers.etag) },
            },
          )
        ).status,
      ).toBe(403);
      expect((await T.admin.get(`/v1/labels/templates/${randomUUID()}`)).status).toBe(404);
    });

    it('calibration needs If-Match, moves the rendered sheet by exactly the offset, and is audited', async () => {
      const list = (await T.admin.get('/v1/labels/templates')).body.data as Array<{
        id: string;
        key: string;
      }>;
      const t = list.find((x) => x.key === 'letter-30up-qr')!;
      const [asset] = await newAssets(1);
      const before = await render(T.admin, {
        template_key: t.key,
        asset_ids: [asset!.id],
        fields: ['asset_tag'],
        codes: [],
      });
      const textBefore = (await pageText(await openPdf(before.pdf), 1))[0]!;

      const url = `/v1/labels/templates/${t.id}`;
      const etag = String((await T.admin.get(url)).headers.etag);
      expect((await T.admin.patch(url, { offset_x_mm: 1.5 })).status).toBe(428);
      expect(
        (await T.admin.patch(url, { offset_x_mm: 1.5 }, { headers: { 'if-match': 'W/"999"' } }))
          .status,
      ).toBe(412);
      expect((await T.admin.patch(url, {}, { headers: { 'if-match': etag } })).status).toBe(422);
      expect(
        (await T.admin.patch(url, { offset_x_mm: 11 }, { headers: { 'if-match': etag } })).status,
      ).toBe(422);
      expect(
        (await T.admin.patch(url, { name: 'x' }, { headers: { 'if-match': etag } })).status,
      ).toBe(422);
      const ok = await T.admin.patch(
        url,
        { offset_x_mm: 1.5, offset_y_mm: -0.75 },
        { headers: { 'if-match': etag } },
      );
      expect(ok.status, ok.raw).toBe(200);
      expect(ok.body).toMatchObject({ offset_x_mm: 1.5, offset_y_mm: -0.75 });
      expect(String(ok.headers.etag)).not.toBe(etag);

      const after = await render(T.admin, {
        template_key: t.key,
        asset_ids: [asset!.id],
        fields: ['asset_tag'],
        codes: [],
      });
      const textAfter = (await pageText(await openPdf(after.pdf), 1))[0]!;
      expect(textAfter.xMm - textBefore.xMm).toBeCloseTo(1.5, 1);
      expect(textAfter.yMm - textBefore.yMm).toBeCloseTo(-0.75, 1);

      const audit = await auditRows(T.tenantId, "action = 'label.template.calibrated'");
      expect(audit.at(-1)!.diff).toMatchObject({
        before: { offset_x_mm: 0, offset_y_mm: 0 },
        after: { offset_x_mm: 1.5, offset_y_mm: -0.75 },
      });
      // put it back so the other tests print on the nominal grid
      const now = String((await T.admin.get(url)).headers.etag);
      await T.admin.patch(
        url,
        { offset_x_mm: 0, offset_y_mm: 0 },
        { headers: { 'if-match': now } },
      );
    });
  });

  // ---------------------------------------------------------------------------- the whole flow

  describe('a batch from request to PDF', () => {
    it('renders QR + Code128 for the assets in the slots after the start position, and everything is recorded', async () => {
      const assets = await newAssets(4);
      const asked = await requestBatch(T.admin, {
        template_key: 'letter-30up-qr',
        asset_ids: assets.map((a) => a.id),
        start_position: 7,
        copies: 2,
        codes: ['qr', 'code128'],
        fields: ['asset_tag', 'name', 'organisation'],
      });
      expect(asked.status, asked.raw).toBe(202);
      const batchId = asked.body.id as string;
      expect(asked.headers.location).toBe(`/v1/labels/batches/${batchId}`);
      expect(asked.body).toMatchObject({
        status: 'queued',
        template_key: 'letter-30up-qr',
        source: 'asset_ids',
        asset_count: 4,
        copies: 2,
        label_count: 8,
        start_position: 7,
        codes: ['qr', 'code128'],
        page_count: null,
        download_url: null,
        error: null,
      });
      // the job carries ids only
      const jobs = h.jobs.jobs.filter((j) => j.name === 'label.render');
      expect(jobs.at(-1)!.payload).toEqual({ tenantId: T.tenantId, batchId });

      // polling before the worker ran
      const polled = await T.admin.get(`/v1/labels/batches/${batchId}`);
      expect(polled.body).toMatchObject({ status: 'queued', download_url: null });

      takeRenderJobs(h);
      await runLabelJob(h, 'label.render', { tenantId: T.tenantId, batchId });
      const { pdf, batch } = await downloadBatchPdf(h, T.admin, batchId);
      expect(batch).toMatchObject({
        status: 'ready',
        page_count: 1,
        filename: expect.stringMatching(/^labels-letter-30up-qr-\d{8}-[0-9a-f]{8}\.pdf$/),
      });
      expect(batch.download_expires_at).toBeTruthy();
      expect(batch.size_bytes).toBe(pdf.length);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

      // ---- decode the PDF: each asset twice, in slots 7..14, the six used slots untouched
      const doc = await openPdf(pdf);
      expect(doc.numPages).toBe(1);
      const raster = await rasterize(doc, 1);
      const t = {
        ...LABEL_TEMPLATES.find((x) => x.key === 'letter-30up-qr')!,
        offsetXMm: 0,
        offsetYMm: 0,
      };
      const rect = (i: number) => {
        const s = slotRect(t, i);
        return { xMm: s.xMm, yMm: s.yMm, widthMm: s.widthMm, heightMm: s.heightMm };
      };
      for (let s = 0; s < 6; s++) expect(raster.darkPixels(rect(s)), `slot ${s + 1}`).toBe(0);
      for (let i = 0; i < 8; i++) {
        const asset = assets[Math.floor(i / 2)]!;
        const slot = 6 + i;
        expect(decodeRegion(raster, rect(slot), 'QR_CODE'), `QR in slot ${slot + 1}`).toBe(
          `${WEB_BASE}/s/${asset.label_code}`,
        );
        expect(decodeRegion(raster, rect(slot), 'CODE_128'), `Code128 in slot ${slot + 1}`).toBe(
          asset.asset_tag,
        );
      }
      for (let s = 14; s < 30; s++) expect(raster.darkPixels(rect(s))).toBe(0);
      // the opaque code is the QR payload, never an internal id
      for (const a of assets) expect(`${WEB_BASE}/s/${a.label_code}`).not.toContain(a.id);
      const text = (await pageText(doc, 1)).map((x) => x.str);
      for (const a of assets) expect(text.filter((x) => x === a.asset_tag)).toHaveLength(2);
      // the organisation line: printed on every one of the 8 labels
      expect(text.filter((x) => x.includes(T.name)).length).toBe(8);

      // ---- the stored object is the one that was downloaded
      const row = (
        await ownerTenantSql(T.tenantId, 'select * from app.label_batch where id = $1', [batchId])
      ).rows[0];
      expect(row.storage_key).toMatch(new RegExp(`^tenants/${T.tenantId}/\\d{4}/${batchId}$`));
      expect(row.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
      expect(Number(row.size_bytes)).toBe(pdf.length);
      expect(row.content_type).toBe('application/pdf');
      expect(row.render_ms).toBeGreaterThanOrEqual(0);
      expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
      // the file is tenant-scoped: it lives under this tenant's prefix and nowhere in B's
      expect((await h.storage.head(row.storage_key))?.sizeBytes).toBe(pdf.length);

      // ---- reprint history, audit, outbox
      for (const a of assets) {
        const hist = await T.admin.get(`/v1/assets/${a.id}/history?event_type=label_printed`);
        expect(hist.body.data).toHaveLength(1);
        expect(hist.body.data[0]).toMatchObject({
          event_type: 'label_printed',
          actor_type: 'user',
          payload: { batch_id: batchId, template_key: 'letter-30up-qr', copies: 2 },
        });
        expect(hist.body.data[0].actor.display_name).toBeTruthy();
      }
      const audit = await auditRows(T.tenantId, `entity_id = '${batchId}'`);
      expect(audit.map((a) => a.action)).toEqual(['label.batch.requested', 'label.batch.ready']);
      const events = await outboxRows(T.tenantId, `aggregate_id = '${batchId}'`);
      expect(events.map((e) => e.event_type)).toEqual(['label.batch.ready']);
      // ids only: nothing about the assets, the template or the file
      expect(Object.keys(events[0]!.payload).sort()).toEqual([
        'batch_id',
        'requested_by',
        'version',
      ]);
      expect(events[0]!.payload.requested_by).toBe((await T.admin.get('/v1/auth/me')).body.user.id);
    });

    it('selects assets by the current list filter, in tag order, and remembers the filter', async () => {
      const cat = (
        await T.admin.post('/v1/categories', { name: unique('Filtered'), tag_prefix: 'FLT-' })
      ).body;
      const mine: Array<{ id: string; asset_tag: string; label_code: string }> = [];
      for (let i = 0; i < 3; i++) {
        const res = await T.admin.post('/v1/assets', { category_id: cat.id, name: `F${i}` });
        mine.push(res.body);
      }
      await newAssets(1); // another category: must not be printed
      const { pdf, batch } = await render(T.admin, {
        template_key: 'a4-24up-qr',
        filter: { category_id: [cat.id], sort: 'asset_tag' },
        codes: ['qr'],
      });
      expect(batch).toMatchObject({ source: 'filter', asset_count: 3, label_count: 3 });
      const doc = await openPdf(pdf);
      const raster = await rasterize(doc, 1);
      const t = {
        ...LABEL_TEMPLATES.find((x) => x.key === 'a4-24up-qr')!,
        offsetXMm: 0,
        offsetYMm: 0,
      };
      const sorted = [...mine].sort((a, b) => a.asset_tag.localeCompare(b.asset_tag));
      for (let i = 0; i < 3; i++) {
        const s = slotRect(t, i);
        expect(
          decodeRegion(
            raster,
            { xMm: s.xMm, yMm: s.yMm, widthMm: s.widthMm, heightMm: s.heightMm },
            'QR_CODE',
          ),
        ).toBe(`${WEB_BASE}/s/${sorted[i]!.label_code}`);
      }
      const row = (
        await ownerTenantSql(
          T.tenantId,
          'select source_filter, asset_ids from app.label_batch where id = $1',
          [batch.id],
        )
      ).rows[0];
      expect(row.source_filter).toEqual({ category_id: [cat.id], sort: 'asset_tag' });
      expect(row.asset_ids).toEqual(sorted.map((a) => a.id));
    });

    it('prints on every fixed template: the sheet count follows the slots, QR decodable', async () => {
      const assets = await newAssets(3);
      for (const c of LABEL_TEMPLATES) {
        const { pdf, batch } = await render(T.admin, {
          template_key: c.key,
          asset_ids: assets.map((a) => a.id),
        });
        expect(batch.page_count, c.key).toBe(Math.ceil(3 / slotsPerPage(c)));
        const raster = await rasterize(await openPdf(pdf), 1);
        const t = { ...c, offsetXMm: 0, offsetYMm: 0 };
        const shown = Math.min(3, slotsPerPage(t));
        for (let i = 0; i < shown; i++) {
          const s = slotRect(t, i);
          expect(
            decodeRegion(
              raster,
              { xMm: s.xMm, yMm: s.yMm, widthMm: s.widthMm, heightMm: s.heightMm },
              'QR_CODE',
            ),
            `${c.key} label ${i + 1}`,
          ).toBe(`${WEB_BASE}/s/${assets[i]!.label_code}`);
        }
      }
    });

    it('draws the organisation logo and keeps every code readable', async () => {
      const [asset] = await newAssets(1);
      const upload = await uploadFile(
        h,
        T.admin,
        T.tenantId,
        { entity_type: 'asset', entity_id: asset!.id },
        {
          filename: 'logo.png',
          content_type: 'image/png',
          body: await png(240, 80),
          kind: 'photo',
        },
      );
      await drainJobs(h);
      const { pdf } = await render(T.admin, {
        template_key: 'letter-10up-qr',
        asset_ids: [asset!.id],
        logo_attachment_id: upload.id,
      });
      const plain = await render(T.admin, {
        template_key: 'letter-10up-qr',
        asset_ids: [asset!.id],
      });
      expect(pdf.length).toBeGreaterThan(plain.pdf.length);
      const raster = await rasterize(await openPdf(pdf), 1);
      const t = {
        ...LABEL_TEMPLATES.find((x) => x.key === 'letter-10up-qr')!,
        offsetXMm: 0,
        offsetYMm: 0,
      };
      const s = slotRect(t, 0);
      const rect = { xMm: s.xMm, yMm: s.yMm, widthMm: s.widthMm, heightMm: s.heightMm };
      expect(decodeRegion(raster, rect, 'QR_CODE')).toBe(`${WEB_BASE}/s/${asset!.label_code}`);
      expect(decodeRegion(raster, rect, 'CODE_128')).toBe(asset!.asset_tag);
    });
  });

  // ------------------------------------------------------------------------------- validation

  describe('request validation', () => {
    const must422 = async (body: Record<string, unknown>, pointer: string, code?: string) => {
      const res = await requestBatch(T.admin, body);
      expect(res.status, res.raw).toBe(422);
      expect(res.body.code).toBe('validation');
      const hit = (res.body.errors as Array<{ pointer: string; code?: string }>).find((e) =>
        e.pointer.startsWith(pointer),
      );
      expect(hit, `${pointer} in ${res.raw}`).toBeDefined();
      if (code) expect(hit!.code).toBe(code);
    };

    it('refuses what cannot be printed, naming the field', async () => {
      const [a] = await newAssets(1);
      const ids = [a!.id];
      await must422(
        { template_key: 'no-such-sheet', asset_ids: ids },
        '/template_key',
        'not-found',
      );
      await must422(
        { template_key: 'letter-30up-qr', asset_ids: ids, start_position: 31 },
        '/start_position',
        'out-of-range',
      );
      await must422(
        { template_key: 'thermal-2x1in-qr', asset_ids: ids, start_position: 2 },
        '/start_position',
      );
      await must422({ template_key: 'letter-30up-qr' }, '/asset_ids');
      await must422({ template_key: 'letter-30up-qr', asset_ids: ids, filter: {} }, '/filter');
      await must422({ template_key: 'letter-30up-qr', asset_ids: [a!.id, a!.id] }, '/asset_ids');
      await must422(
        { template_key: 'letter-30up-qr', asset_ids: [randomUUID()] },
        '/asset_ids/0',
        'not-found',
      );
      await must422(
        { template_key: 'letter-30up-qr', asset_ids: ids, codes: [], fields: [] },
        '/codes',
        'empty',
      );
      await must422({ template_key: 'letter-30up-qr', asset_ids: ids, copies: 11 }, '/copies');
      await must422(
        { template_key: 'letter-30up-qr', asset_ids: ids, fields: ['password'] },
        '/fields',
      );
      await must422({ template_key: 'letter-30up-qr', asset_ids: ids, extra: 1 }, '/');
      await must422(
        { template_key: 'letter-30up-qr', filter: { cf: 'x' } },
        '/filter/cf',
        'unknown-filter',
      );
      await must422(
        { template_key: 'letter-30up-qr', filter: { status_id: ['nope'] } },
        '/filter/status_id',
      );
      await must422(
        { template_key: 'letter-30up-qr', filter: { tag: 'no-such-tag-anywhere' } },
        '/filter',
        'empty',
      );
    });

    it('holds the batch size limits', async () => {
      // 2001 assets by id
      const many = Array.from({ length: 2001 }, () => randomUUID());
      const big = await requestBatch(T.admin, { template_key: 'letter-30up-qr', asset_ids: many });
      expect(big.status).toBe(422);
      // assets x copies over the limit: 205 assets x 10 copies
      const statusId = await defaultStatusId(T.admin);
      await insertAssets(T.tenantId, categoryId, statusId, 205, { tagPrefix: unique('CAP') + '-' });
      const filter = { q: 'bulk asset', sort: 'asset_tag' };
      const copies = await requestBatch(T.admin, {
        template_key: 'letter-30up-qr',
        filter,
        copies: 10,
      });
      expect(copies.status, copies.raw).toBe(422);
      expect(copies.body.errors[0]).toMatchObject({ pointer: '/copies', code: 'too-many' });
      expect(
        (await requestBatch(T.admin, { template_key: 'letter-30up-qr', filter, copies: 9 })).status,
      ).toBe(202);
    });

    it('refuses a Code128 the tag cannot be printed as, and offers the QR instead', async () => {
      const res = await T.admin.post('/v1/assets', {
        category_id: categoryId,
        asset_tag: 'LONG-' + 'X'.repeat(40),
      });
      expect(res.status, res.raw).toBe(201);
      const r = await requestBatch(T.admin, {
        template_key: 'single-50x25-qr',
        asset_ids: [res.body.id],
        codes: ['qr', 'code128'],
      });
      expect(r.status).toBe(422);
      expect(r.body.errors[0]).toMatchObject({ pointer: '/codes', code: 'barcode-unprintable' });
      expect(r.body.errors[0].message).toContain('LONG-');
      const accent = await T.admin.post('/v1/assets', {
        category_id: categoryId,
        asset_tag: 'Té-1',
      });
      expect(accent.status, accent.raw).toBe(201);
      expect(
        (
          await requestBatch(T.admin, {
            template_key: 'letter-10up-qr',
            asset_ids: [accent.body.id],
            codes: ['code128'],
          })
        ).status,
      ).toBe(422);
      // the QR alone is fine
      expect(
        (
          await requestBatch(T.admin, {
            template_key: 'single-50x25-qr',
            asset_ids: [res.body.id],
            codes: ['qr'],
          })
        ).status,
      ).toBe(202);
    });

    it('accepts only a clean PNG or JPEG of the tenant as the logo', async () => {
      const [a] = await newAssets(1);
      const base = { template_key: 'letter-10up-qr', asset_ids: [a!.id] };
      await must422(
        { ...base, logo_attachment_id: randomUUID() },
        '/logo_attachment_id',
        'not-found',
      );
      // a PDF
      const doc = await uploadFile(
        h,
        T.admin,
        T.tenantId,
        { entity_type: 'asset', entity_id: a!.id },
        {
          filename: 'x.pdf',
          content_type: 'application/pdf',
          body: Buffer.from('%PDF-1.4\n%%EOF\n'),
        },
      );
      await must422(
        { ...base, logo_attachment_id: doc.id },
        '/logo_attachment_id',
        'not-png-or-jpeg',
      );
      // a PNG that has not been scanned yet
      const pending = await uploadFile(
        h,
        T.admin,
        T.tenantId,
        { entity_type: 'asset', entity_id: a!.id },
        {
          filename: 'p.png',
          content_type: 'image/png',
          body: await png(),
          kind: 'photo',
        },
      );
      await must422(
        { ...base, logo_attachment_id: pending.id },
        '/logo_attachment_id',
        'not-clean',
      );
      // another tenant's attachment does not exist here
      const bAsset = (
        await B.admin.post('/v1/assets', {
          category_id: (await B.admin.post('/v1/categories', { name: unique('c') })).body.id,
        })
      ).body;
      const foreign = await uploadFile(
        h,
        B.admin,
        B.tenantId,
        { entity_type: 'asset', entity_id: bAsset.id },
        {
          filename: 'b.png',
          content_type: 'image/png',
          body: await png(),
          kind: 'photo',
        },
      );
      await drainJobs(h);
      await must422(
        { ...base, logo_attachment_id: foreign.id },
        '/logo_attachment_id',
        'not-found',
      );
    });

    it('needs an Idempotency-Key, and a retry with the same key creates one batch', async () => {
      const [a] = await newAssets(1);
      const body = { template_key: 'letter-30up-qr', asset_ids: [a!.id] };
      const missing = await T.admin.post('/v1/labels/batches', body);
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('idempotency-key-required');
      const key = idem();
      const first = await T.admin.post('/v1/labels/batches', body, key);
      const second = await T.admin.post('/v1/labels/batches', body, key);
      expect([first.status, second.status]).toEqual([202, 202]);
      expect(second.body.id).toBe(first.body.id);
      expect(second.headers['idempotent-replayed']).toBe('true');
      const other = await T.admin.post('/v1/labels/batches', { ...body, copies: 2 }, key);
      expect(other.status).toBe(422);
      expect(other.body.code).toBe('idempotency-key-reuse');
      const n = await ownerTenantSql(
        T.tenantId,
        'select count(*)::int as n from app.label_batch where id = $1',
        [first.body.id],
      );
      expect(n.rows[0].n).toBe(1);
    });
  });

  // ------------------------------------------------------------------------------ visibility

  describe('who can see a batch', () => {
    it('is private to the requester, tenant admin included, and to the tenant', async () => {
      const [a] = await newAssets(1);
      const res = await requestBatch(tech, { template_key: 'single-50x25-qr', asset_ids: [a!.id] });
      expect(res.status, res.raw).toBe(202);
      const id = res.body.id as string;
      expect((await tech.get(`/v1/labels/batches/${id}`)).status).toBe(200);
      expect((await T.admin.get(`/v1/labels/batches/${id}`)).status).toBe(404);
      expect((await B.admin.get(`/v1/labels/batches/${id}`)).status).toBe(404);
      expect((await viewer.get(`/v1/labels/batches/${id}`)).status).toBe(403);
      const mine = await tech.get('/v1/labels/batches?limit=200');
      expect(mine.body.data.map((b: { id: string }) => b.id)).toContain(id);
      const admins = await T.admin.get('/v1/labels/batches?limit=200');
      expect(admins.body.data.map((b: { id: string }) => b.id)).not.toContain(id);
      // the row records who asked
      const row = (
        await ownerTenantSql(
          T.tenantId,
          'select created_by, requested_by_type from app.label_batch where id = $1',
          [id],
        )
      ).rows[0];
      expect(row).toMatchObject({ created_by: techId, requested_by_type: 'user' });
      expect((await T.admin.get(`/v1/labels/batches/${randomUUID()}`)).status).toBe(404);
      expect((await T.admin.get('/v1/labels/batches/not-a-uuid')).status).toBe(400);
    });

    it('lists newest first with a cursor and a status filter', async () => {
      const [a] = await newAssets(1);
      const made: string[] = [];
      for (let i = 0; i < 3; i++) {
        made.push(
          (await requestBatch(tech, { template_key: 'single-50x25-qr', asset_ids: [a!.id] })).body
            .id,
        );
      }
      const page1 = await tech.get('/v1/labels/batches?limit=2&status=queued');
      expect(page1.status).toBe(200);
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.page.has_more).toBe(true);
      const ids = page1.body.data.map((b: { id: string }) => b.id);
      expect(ids).toEqual([made[2], made[1]]);
      const page2 = await tech.get(
        `/v1/labels/batches?limit=2&status=queued&cursor=${page1.body.page.next_cursor}`,
      );
      expect(page2.body.data[0].id).toBe(made[0]);
      expect((await tech.get('/v1/labels/batches?status=ready,failed')).body.data).toEqual([]);
      expect((await tech.get('/v1/labels/batches?status=bogus')).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------------- failure

  describe('failure, retry and expiry', () => {
    it('retries a transient fault, then fails the batch on the last attempt with an event', async () => {
      const [a] = await newAssets(1);
      const res = await requestBatch(T.admin, {
        template_key: 'single-50x25-qr',
        asset_ids: [a!.id],
      });
      const batchId = res.body.id as string;
      takeRenderJobs(h);
      const write = h.storage.write.bind(h.storage);
      h.storage.write = async () => {
        throw new Error('disk full');
      };
      try {
        await expect(
          runLabelJob(h, 'label.render', { tenantId: T.tenantId, batchId }, 0),
        ).rejects.toThrow('disk full');
        expect((await T.admin.get(`/v1/labels/batches/${batchId}`)).body.status).toBe('queued');
        await runLabelJob(h, 'label.render', { tenantId: T.tenantId, batchId }, 3);
      } finally {
        h.storage.write = write;
      }
      const failed = await T.admin.get(`/v1/labels/batches/${batchId}`);
      expect(failed.body).toMatchObject({
        status: 'failed',
        download_url: null,
        error: { code: 'render-failed' },
      });
      const events = await outboxRows(T.tenantId, `aggregate_id = '${batchId}'`);
      expect(events.map((e) => e.event_type)).toEqual(['label.batch.failed']);
      expect(events[0]!.payload).toMatchObject({ batch_id: batchId, code: 'render-failed' });
      // no history was written for a batch that never printed
      expect(
        (await T.admin.get(`/v1/assets/${a!.id}/history?event_type=label_printed`)).body.data,
      ).toEqual([]);
      // running it again does nothing
      await runLabelJob(h, 'label.render', { tenantId: T.tenantId, batchId }, 0);
      expect((await T.admin.get(`/v1/labels/batches/${batchId}`)).body.status).toBe('failed');
    });

    it('fails at once, without retries, when the input can never render (a logo that is not an image)', async () => {
      const [a] = await newAssets(1);
      const logo = await uploadFile(
        h,
        T.admin,
        T.tenantId,
        { entity_type: 'asset', entity_id: a!.id },
        {
          filename: 'logo.png',
          content_type: 'image/png',
          body: await png(),
          kind: 'photo',
        },
      );
      await drainJobs(h);
      const res = await requestBatch(T.admin, {
        template_key: 'letter-10up-qr',
        asset_ids: [a!.id],
        logo_attachment_id: logo.id,
      });
      expect(res.status, res.raw).toBe(202);
      const batchId = res.body.id as string;
      takeRenderJobs(h);
      // the stored bytes stop being an image after the request was accepted
      await h.storage.write(logo.key, Buffer.from('definitely not a png'), {
        contentType: 'image/png',
      });
      await runLabelJob(h, 'label.render', { tenantId: T.tenantId, batchId }, 0);
      const got = await T.admin.get(`/v1/labels/batches/${batchId}`);
      expect(got.body).toMatchObject({ status: 'failed', error: { code: 'logo-invalid' } });
      expect(
        (await auditRows(T.tenantId, `entity_id = '${batchId}'`)).map((x) => x.action),
      ).toEqual(['label.batch.requested', 'label.batch.failed']);
    });

    it('the sweep deletes the file of an expired batch and queues the job of a lost one again', async () => {
      const [a] = await newAssets(1);
      const { batch } = await render(T.admin, {
        template_key: 'single-50x25-qr',
        asset_ids: [a!.id],
      });
      const id = batch.id as string;
      const key = (
        await ownerTenantSql(T.tenantId, 'select storage_key from app.label_batch where id = $1', [
          id,
        ])
      ).rows[0].storage_key as string;
      expect(await h.storage.head(key)).not.toBeNull();

      // a batch whose job was lost
      const lost = await requestBatch(T.admin, {
        template_key: 'single-50x25-qr',
        asset_ids: [a!.id],
      });
      takeRenderJobs(h);
      await ownerTenantSql(
        T.tenantId,
        "update app.label_batch set created_at = now() - interval '1 hour' where id = $1",
        [lost.body.id],
      );
      await ownerTenantSql(
        T.tenantId,
        "update app.label_batch set expires_at = now() - interval '1 minute' where id = $1",
        [id],
      );

      await runLabelJob(h, 'label.sweep', { tenantId: T.tenantId });
      const after = await T.admin.get(`/v1/labels/batches/${id}`);
      expect(after.body).toMatchObject({ status: 'expired', download_url: null, filename: null });
      expect(await h.storage.head(key)).toBeNull();
      expect((await auditRows(T.tenantId, `entity_id = '${id}'`)).map((x) => x.action)).toEqual([
        'label.batch.requested',
        'label.batch.ready',
        'label.batch.expired',
      ]);
      expect(takeRenderJobs(h)).toEqual([{ tenantId: T.tenantId, batchId: lost.body.id }]);
      // the sweep is idempotent
      await runLabelJob(h, 'label.sweep', { tenantId: T.tenantId });
      expect((await T.admin.get(`/v1/labels/batches/${id}`)).body.status).toBe('expired');
    });

    it('a download link names one object and expires; the object key is never in the API', async () => {
      const [a] = await newAssets(1);
      const { batch } = await render(T.admin, {
        template_key: 'single-50x25-qr',
        asset_ids: [a!.id],
      });
      const key = (
        await ownerTenantSql(T.tenantId, 'select storage_key from app.label_batch where id = $1', [
          batch.id,
        ])
      ).rows[0].storage_key as string;
      expect(JSON.stringify(batch)).not.toContain(key);
      expect(JSON.stringify(batch)).not.toContain('tenants/');
      const expires = new Date(batch.download_expires_at as string).getTime();
      expect(expires).toBeGreaterThan(Date.now());
      expect(expires).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
    });
  });

  // ------------------------------------------------------------------------------ performance

  describe('performance (M2-OPS-01: a 500-label PDF in under 30 s)', () => {
    let rasterOk: PageRaster | undefined;

    it('500 labels, QR + Code128, in well under 30 s, and sampled labels still decode', async () => {
      const statusId = await defaultStatusId(T.admin);
      const prefix = `PRF${Date.now().toString(36).toUpperCase()}-`;
      await insertAssets(T.tenantId, categoryId, statusId, 500, { tagPrefix: prefix });
      const asked = await requestBatch(T.admin, {
        template_key: 'letter-30up-qr',
        filter: { q: prefix.toLowerCase(), sort: 'asset_tag' },
        codes: ['qr', 'code128'],
        fields: ['asset_tag', 'name', 'serial'],
      });
      expect(asked.status, asked.raw).toBe(202);
      expect(asked.body.label_count).toBe(500);
      takeRenderJobs(h);
      const started = performance.now();
      await runLabelJob(h, 'label.render', {
        tenantId: T.tenantId,
        batchId: asked.body.id as string,
      });
      const wallMs = performance.now() - started;
      const { pdf, batch } = await downloadBatchPdf(h, T.admin, asked.body.id as string);
      expect(batch.page_count).toBe(17);
      const row = (
        await ownerTenantSql(T.tenantId, 'select render_ms from app.label_batch where id = $1', [
          asked.body.id,
        ])
      ).rows[0];
      perfNote(
        `[labels perf] 500 labels / 17 pages QR+Code128: job ${Math.round(wallMs)} ms (render ${row.render_ms} ms), PDF ${(pdf.length / 1024).toFixed(0)} KiB`,
      );
      expect(wallMs).toBeLessThan(30_000);

      // sample: first and last page decode
      const doc = await openPdf(pdf);
      expect(doc.numPages).toBe(17);
      const t = {
        ...LABEL_TEMPLATES.find((x) => x.key === 'letter-30up-qr')!,
        offsetXMm: 0,
        offsetYMm: 0,
      };
      const assets = (
        await ownerTenantSql(
          T.tenantId,
          'select asset_tag, label_code from app.label_batch b, unnest(b.asset_ids) with ordinality u(id, n) join app.asset a on a.id = u.id where b.id = $1 order by u.n',
          [asked.body.id],
        )
      ).rows as Array<{ asset_tag: string; label_code: string }>;
      expect(assets).toHaveLength(500);
      for (const [page, firstIndex, count] of [
        [1, 0, 30],
        [17, 480, 20],
      ] as const) {
        const raster = await rasterize(doc, page);
        rasterOk = raster;
        for (let i = 0; i < count; i++) {
          const s = slotRect(t, i);
          const rect = { xMm: s.xMm, yMm: s.yMm, widthMm: s.widthMm, heightMm: s.heightMm };
          expect(decodeRegion(raster, rect, 'QR_CODE'), `page ${page} label ${i}`).toBe(
            `${WEB_BASE}/s/${assets[firstIndex + i]!.label_code}`,
          );
          expect(decodeRegion(raster, rect, 'CODE_128'), `page ${page} label ${i}`).toBe(
            assets[firstIndex + i]!.asset_tag,
          );
        }
      }
      expect(rasterOk).toBeDefined();
    }, 180_000);

    it('2000 labels (the largest batch), 10-up, still inside the 2 minute worker transaction', async () => {
      const prefix = `BIG${Date.now().toString(36).toUpperCase()}-`;
      const statusId = await defaultStatusId(T.admin);
      await insertAssets(T.tenantId, categoryId, statusId, 1000, { tagPrefix: prefix });
      const asked = await requestBatch(T.admin, {
        template_key: 'letter-10up-qr',
        filter: { q: prefix.toLowerCase() },
        copies: 2,
      });
      expect(asked.status, asked.raw).toBe(202);
      expect(asked.body.label_count).toBe(2000);
      takeRenderJobs(h);
      const started = performance.now();
      await runLabelJob(h, 'label.render', {
        tenantId: T.tenantId,
        batchId: asked.body.id as string,
      });
      const wallMs = performance.now() - started;
      const got = await T.admin.get(`/v1/labels/batches/${asked.body.id}`);
      perfNote(
        `[labels perf] 2000 labels / ${got.body.page_count} pages QR+Code128 on 10-up: job ${Math.round(wallMs)} ms, PDF ${((got.body.size_bytes as number) / 1024).toFixed(0)} KiB`,
      );
      expect(got.body.status).toBe('ready');
      expect(wallMs).toBeLessThan(60_000);
    }, 300_000);
  });
});
