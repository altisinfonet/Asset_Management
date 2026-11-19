import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EICAR, FakeVirusScanner } from '../../src/ports/fakes.js';
import { dbEnabled } from '../auth/support.js';
import {
  type App,
  type TenantFixture,
  auditRows,
  createTenant,
  createUser,
  newTenancy,
  outboxRows,
  seedBasics,
  unique,
} from '../registry/support.js';
import { ownerTenantSql } from '../auth/support.js';
import {
  csv,
  docx,
  exe,
  html,
  jpeg,
  jpegWithExif,
  pdf,
  png,
  svg,
  webp,
} from '../support/file-fixtures.js';
import {
  type Driver,
  type FilesHarness,
  type ScannerKind,
  clamdEnv,
  createAttachment,
  drainJobs,
  fetchUrl,
  putBytes,
  rowOf,
  runJob,
  s3Env,
  startFilesApp,
  uploadFile,
} from './support.js';

/**
 * M2-FILE-01..03 and M2-SEC-02 end to end: presigned upload, completion, virus scan (real ClamAV
 * when CLAMD_HOST is set), thumbnails and EXIF, orphan sweep, and every way a file must NOT come back
 * (pending, infected, foreign, replaced). Runs against the local-filesystem driver and, when
 * S3_ENDPOINT is set, against MinIO through real presigned URLs.
 */
const variants: Array<{ name: string; driver: Driver; scanner: ScannerKind }> = [
  { name: 'local storage + fake scanner', driver: 'local', scanner: 'fake' },
  ...(clamdEnv
    ? [{ name: 'local storage + ClamAV', driver: 'local' as const, scanner: 'clamd' as const }]
    : []),
  ...(s3Env
    ? [
        {
          name: clamdEnv ? 'S3 (MinIO) + ClamAV' : 'S3 (MinIO) + fake scanner',
          driver: 's3' as const,
          scanner: clamdEnv ? ('clamd' as const) : ('fake' as const),
        },
      ]
    : []),
];

describe.skipIf(!dbEnabled).each(variants)('attachments pipeline: $name', ({ driver, scanner }) => {
  const tenancy = newTenancy();
  let h: FilesHarness;
  let app: App;
  let A: TenantFixture;
  let B: TenantFixture;
  let assetA: string;
  let assetB: string;
  let adminUserId: string;

  const pngOwner = () => ({ entity_type: 'asset', entity_id: assetA });

  beforeAll(async () => {
    h = await startFilesApp({ driver, scanner });
    app = h.app;
    A = await createTenant(app, tenancy, 'filesa');
    B = await createTenant(app, tenancy, 'filesb');
    for (const [t, set] of [
      [A, (id: string) => (assetA = id)],
      [B, (id: string) => (assetB = id)],
    ] as const) {
      const { category } = await seedBasics(t.admin);
      const asset = await t.admin.post('/v1/assets', {
        category_id: category.id,
        name: 'Photo asset',
      });
      set(asset.body.id);
    }
    adminUserId = (await A.admin.get('/v1/auth/me')).body.user.id;
  });
  afterAll(async () => {
    await h.close();
    await tenancy.onModuleDestroy();
  });

  const scanStatus = async (id: string) => (await A.admin.get(`/v1/attachments/${id}`)).body;

  // ------------------------------------------------------------------------------------------
  describe('upload, scan, download', () => {
    it('presigned PUT -> complete -> scan -> clean -> presigned GET (never before the scan)', async () => {
      const body = await png(40, 30);
      const created = await createAttachment(A.admin, {
        ...pngOwner(),
        kind: 'photo',
        filename: 'front.png',
        content_type: 'image/png',
        size_bytes: body.length,
      });
      const id = created.attachment.id;
      expect(created.attachment).toMatchObject({
        entity_type: 'asset',
        entity_id: assetA,
        scan_status: 'pending',
        content_type: 'image/png',
        size_bytes: body.length,
        download_url: null,
        thumbnail_url: null,
        uploaded_at: null,
      });
      // the storage key is never a member of the API objects (it is only inside the signed URL)
      expect(JSON.stringify(created.attachment)).not.toContain('tenants/');
      expect(Object.keys(created.attachment)).not.toContain('storage_key');
      expect(created.upload.method).toBe('PUT');
      expect(created.upload.headers['content-type']).toBe('image/png');
      expect(new Date(created.upload.expires_at).getTime()).toBeGreaterThan(Date.now());
      expect((await A.admin.get(`/v1/attachments/${id}`)).body.download_url).toBeNull();

      expect((await putBytes(h, created.upload, body)).status).toBe(200);
      const done = await A.admin.post(`/v1/attachments/${id}/complete`);
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ scan_status: 'pending', download_url: null });
      expect(done.body.uploaded_at).toBeTruthy();
      // idempotent
      expect((await A.admin.post(`/v1/attachments/${id}/complete`)).body.uploaded_at).toBe(
        done.body.uploaded_at,
      );

      // the scan job was queued with ids only
      const queued = h.jobs.jobs.filter((j) => j.name === 'attachment.scan');
      expect(queued.at(-1)?.payload).toEqual({ tenantId: A.tenantId, attachmentId: id });
      // still pending: no download
      expect((await scanStatus(id)).download_url).toBeNull();

      await drainJobs(h, ['attachment.scan']);
      const clean = await scanStatus(id);
      expect(clean.scan_status).toBe('clean');
      expect(clean.sha256).toBe(createHash('sha256').update(body).digest('hex'));
      expect(clean.download_url).toMatch(/^https?:\/\//);

      const file = await fetchUrl(h, clean.download_url);
      expect(file.status).toBe(200);
      expect(file.body.equals(body)).toBe(true);
      expect(String(file.headers['content-type'])).toMatch(/^image\/png/);
      expect(String(file.headers['content-disposition'])).toMatch(/^inline/);
      if (driver === 'local') {
        expect(file.headers['x-content-type-options']).toBe('nosniff');
        expect(file.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
        expect(file.headers['cache-control']).toBe('private, no-store');
        expect(file.headers['set-cookie']).toBeUndefined();
      }

      const audit = (await auditRows(A.tenantId, `entity_id = '${id}'`)).map((r) => r.action);
      expect(audit).toEqual(['attachment.created', 'attachment.uploaded', 'attachment.scanned']);
      const events = (await outboxRows(A.tenantId, `aggregate_id = '${id}'`)).map(
        (e) => e.event_type,
      );
      expect(events).toEqual(['attachment.created', 'attachment.uploaded', 'attachment.scanned']);
    });

    it('a clean image gets a WebP thumbnail without any metadata', async () => {
      const body = await png(800, 400);
      const { id } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'wide.png',
        content_type: 'image/png',
        body,
        kind: 'photo',
      });
      expect(await drainJobs(h)).toEqual(['attachment.scan', 'attachment.thumbnail']);
      const got = await scanStatus(id);
      expect(got.thumbnail_url).toMatch(/^https?:\/\//);
      expect(got).toMatchObject({ width: 800, height: 400 });
      const thumb = await fetchUrl(h, got.thumbnail_url);
      expect(thumb.status).toBe(200);
      expect(String(thumb.headers['content-type'])).toMatch(/^image\/webp/);
      const meta = await sharp(thumb.body).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(320);
      expect(meta.height).toBe(160);
      expect(meta.exif).toBeUndefined();
      // the list carries both URLs of a clean file (no request per item needed)
      const list = await A.admin.get(`/v1/attachments?entity_type=asset&entity_id=${assetA}`);
      const item = list.body.data.find((a: { id: string }) => a.id === id);
      expect(item.thumbnail_url).toMatch(/^https?:\/\//);
      expect(item.download_url).toMatch(/^https?:\/\//);
      expect((await fetchUrl(h, item.download_url)).status).toBe(200);
    });

    it('EXIF and GPS never reach a derivative; the original is kept unless the tenant asks otherwise', async () => {
      const original = await jpegWithExif(64, 48);
      expect((await sharp(original).metadata()).exif).toBeDefined();
      const { id, key } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'gps.jpg',
        content_type: 'image/jpeg',
        body: original,
        kind: 'photo',
      });
      await drainJobs(h);
      const got = await scanStatus(id);
      // orientation 6 swaps the axes
      expect(got).toMatchObject({ width: 48, height: 64 });
      const thumb = await fetchUrl(h, got.thumbnail_url);
      const meta = await sharp(thumb.body).metadata();
      expect(meta.exif).toBeUndefined();
      expect(thumb.body.includes(Buffer.from('secret-copyright'))).toBe(false);
      expect(thumb.body.includes(Buffer.from('ACME CAMERA'))).toBe(false);
      const stored = await fetchUrl(h, got.download_url);
      expect(stored.body.equals(original)).toBe(true);
      expect((await rowOf(A.tenantId, id))?.exif_stripped).toBe(false);
      expect(key).toMatch(/^tenants\//);
    });

    it('with strip_exif_original the stored original is re-encoded without EXIF/GPS and stays downloadable', async () => {
      const t = await createTenant(app, tenancy, 'stripx');
      const { category } = await seedBasics(t.admin);
      const asset = (await t.admin.post('/v1/assets', { category_id: category.id })).body.id;
      const settings = await t.admin.get('/v1/settings/files');
      const put = await t.admin.request('PUT', '/v1/settings/files', {
        body: { strip_exif_original: true, max_upload_bytes: null },
        headers: { 'if-match': String(settings.headers.etag) },
      });
      expect(put.status).toBe(200);
      const original = await jpegWithExif();
      const { id } = await uploadFile(
        h,
        t.admin,
        t.tenantId,
        { entity_type: 'asset', entity_id: asset },
        { filename: 'gps.jpg', content_type: 'image/jpeg', body: original, kind: 'photo' },
      );
      await drainJobs(h);
      const got = (await t.admin.get(`/v1/attachments/${id}`)).body;
      expect(got.download_url).toBeTruthy(); // etag was refreshed with the replaced object
      const stored = await fetchUrl(h, got.download_url);
      expect(stored.status).toBe(200);
      expect((await sharp(stored.body).metadata()).exif).toBeUndefined();
      expect(stored.body.equals(original)).toBe(false);
      expect(got.size_bytes).toBe(stored.body.length);
      expect(got.sha256).toBe(createHash('sha256').update(stored.body).digest('hex'));
      expect((await rowOf(t.tenantId, id))?.exif_stripped).toBe(true);
    });

    it('PDF, CSV and Office files are downloads (attachment), with no thumbnail job', async () => {
      for (const [filename, content_type, body] of [
        ['manual.pdf', 'application/pdf', pdf()],
        ['rows.csv', 'text/csv', csv()],
        [
          'letter.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          docx(),
        ],
      ] as const) {
        const { id } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
          filename,
          content_type,
          body,
        });
        expect(await drainJobs(h)).toEqual(['attachment.scan']);
        const got = await scanStatus(id);
        expect(got.scan_status, filename).toBe('clean');
        expect(got.thumbnail_url).toBeNull();
        const file = await fetchUrl(h, got.download_url);
        expect(file.body.equals(body)).toBe(true);
        expect(String(file.headers['content-disposition'])).toMatch(/^attachment/);
        expect(String(file.headers['content-type'])).toMatch(
          new RegExp(`^${content_type.split('/')[0]}`),
        );
      }
      // a WebP is an image: inline + thumbnail
      const { id } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'p.webp',
        content_type: 'image/webp',
        body: await webp(),
        kind: 'photo',
      });
      expect(await drainJobs(h)).toEqual(['attachment.scan', 'attachment.thumbnail']);
      expect((await scanStatus(id)).thumbnail_url).toBeTruthy();
    });

    it('an infected upload (EICAR) is deleted, audited, announced to the uploader and never downloadable', async () => {
      const eicar = Buffer.from(EICAR);
      const { id, key } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'invoice.csv',
        content_type: 'text/csv',
        body: eicar,
      });
      expect(await h.storage.head(key)).not.toBeNull();
      await drainJobs(h);
      const got = await scanStatus(id);
      expect(got.scan_status).toBe('infected');
      expect(got.scan_detail).toMatch(/eicar/i);
      expect(got.download_url).toBeNull();
      expect(got.thumbnail_url).toBeNull();
      expect(await h.storage.head(key)).toBeNull(); // object deleted

      const audit = (await auditRows(A.tenantId, `entity_id = '${id}'`)).find(
        (r) => r.action === 'attachment.infected',
      );
      expect(audit?.diff?.meta).toMatchObject({ filename: 'invoice.csv' });
      expect(JSON.stringify(audit?.diff?.meta?.detection)).toMatch(/eicar/i);
      const event = (await outboxRows(A.tenantId, `aggregate_id = '${id}'`)).find(
        (e) => e.event_type === 'attachment.infected',
      );
      expect(event?.payload).toMatchObject({ uploaded_by: adminUserId, entity_id: assetA });

      // a repeated scan job changes nothing
      const before = await rowOf(A.tenantId, id);
      await runJob(h, 'attachment.scan', { tenantId: A.tenantId, attachmentId: id });
      expect((await rowOf(A.tenantId, id))?.version).toBe(before?.version);
    });

    it('a client-declared sha256 that does not match the bytes is rejected at scan time and the object removed', async () => {
      const body = csv();
      const { id, key } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'rows.csv',
        content_type: 'text/csv',
        body,
        sha256: createHash('sha256').update('something else').digest('hex'),
      });
      await drainJobs(h, ['attachment.scan']);
      const row = await rowOf(A.tenantId, id);
      expect(row).toMatchObject({ scan_status: 'error', scan_detail: 'checksum-mismatch' });
      expect(row?.archived_at).not.toBeNull();
      expect(await h.storage.head(key)).toBeNull();
    });

    it('an object replaced after the scan (through a still-valid upload URL) is never served', async () => {
      const body = csv();
      const { id, key } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'swap.csv',
        content_type: 'text/csv',
        body,
      });
      await drainJobs(h);
      expect((await scanStatus(id)).download_url).toBeTruthy();
      await new Promise((r) => setTimeout(r, 15));
      await h.storage.write(key, Buffer.from('tag,name\nEVIL,swapped\n'), {
        contentType: 'text/csv',
      });
      expect((await scanStatus(id)).download_url).toBeNull();
    });

    it('an object that changed between confirmation and the scan is rejected, not scanned as clean', async () => {
      const { id, key } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'late.csv',
        content_type: 'text/csv',
        body: csv(),
      });
      await new Promise((r) => setTimeout(r, 15));
      await h.storage.write(key, Buffer.from('x'.repeat(csv().length)), {
        contentType: 'text/csv',
      });
      await drainJobs(h, ['attachment.scan']);
      const row = await rowOf(A.tenantId, id);
      expect(row).toMatchObject({ scan_status: 'error', scan_detail: 'object-changed' });
      expect(await h.storage.head(key)).toBeNull();
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('upload security (M2-SEC-02)', () => {
    const create = (over: Record<string, unknown>) =>
      A.admin.post('/v1/attachments', {
        ...pngOwner(),
        filename: 'x.png',
        content_type: 'image/png',
        size_bytes: 100,
        ...over,
      });

    it('SVG, HTML, executables, archives and unknown types cannot even be declared', async () => {
      for (const [filename, content_type] of [
        ['x.svg', 'image/svg+xml'],
        ['x.png', 'image/svg+xml'],
        ['x.html', 'text/html'],
        ['x.htm', 'application/xhtml+xml'],
        ['x.exe', 'application/x-msdownload'],
        ['x.zip', 'application/zip'],
        ['x.js', 'text/javascript'],
        ['x.bin', 'application/octet-stream'],
        ['x', 'application/octet-stream'],
      ]) {
        const res = await create({ filename, content_type });
        expect(res.status, `${filename} ${content_type}`).toBe(415);
        expect(res.body.code).toBe('unsupported-media-type');
      }
    });

    it('a file name extension that disagrees with the declared type is refused', async () => {
      for (const filename of ['x.html', 'x.svg', 'x', 'x.png.exe', 'x.jpg']) {
        const res = await create({ filename });
        expect(res.status, filename).toBe(415);
      }
      expect((await create({ filename: 'X.PNG' })).status).toBe(201);
    });

    it('size caps are enforced server-side at creation (tier cap) and for an override', async () => {
      expect((await create({ size_bytes: 11 * 1024 * 1024 })).status).toBe(413); // free tier: 10 MiB
      expect((await create({ size_bytes: 0 })).status).toBe(422);
      expect((await create({ size_bytes: -1 })).status).toBe(422);
      expect((await create({ size_bytes: 1.5 })).status).toBe(422);
      const t = await createTenant(app, tenancy, 'capx');
      const { category } = await seedBasics(t.admin);
      const asset = (await t.admin.post('/v1/assets', { category_id: category.id })).body.id;
      const settings = await t.admin.get('/v1/settings/files');
      expect(settings.body).toMatchObject({
        strip_exif_original: false,
        max_upload_bytes: null,
        tier_max_upload_bytes: 10 * 1024 * 1024,
        effective_max_upload_bytes: 10 * 1024 * 1024,
      });
      const put = await t.admin.request('PUT', '/v1/settings/files', {
        body: { strip_exif_original: false, max_upload_bytes: 2048 },
        headers: { 'if-match': String(settings.headers.etag) },
      });
      expect(put.status).toBe(200);
      expect(put.body.effective_max_upload_bytes).toBe(2048);
      const own = {
        entity_type: 'asset',
        entity_id: asset,
        filename: 'x.csv',
        content_type: 'text/csv',
      };
      expect((await t.admin.post('/v1/attachments', { ...own, size_bytes: 2049 })).status).toBe(
        413,
      );
      expect((await t.admin.post('/v1/attachments', { ...own, size_bytes: 2048 })).status).toBe(
        201,
      );
    });

    it('the upload URL itself enforces type and exact size (store-side), and the server re-checks on complete', async () => {
      const body = await png();
      const created = await createAttachment(A.admin, {
        ...pngOwner(),
        filename: 'x.png',
        content_type: 'image/png',
        size_bytes: body.length,
      });
      // wrong content type, wrong size: the store / local endpoint refuses
      const wrongType = await putBytes(h, created.upload, body, {
        'content-type': 'application/pdf',
      });
      expect(wrongType.status).toBeGreaterThanOrEqual(400);
      const tooBig = await putBytes(h, created.upload, Buffer.concat([body, Buffer.from('x')]));
      expect(tooBig.status).toBeGreaterThanOrEqual(400);
      const tooSmall = await putBytes(h, created.upload, body.subarray(0, body.length - 1));
      expect(tooSmall.status).toBeGreaterThanOrEqual(400);
      // nothing arrived: complete says so
      const done = await A.admin.post(`/v1/attachments/${created.attachment.id}/complete`);
      expect(done.status).toBe(409);
      expect(done.body.code).toBe('upload-missing');
      // the genuine upload still works afterwards
      expect((await putBytes(h, created.upload, body)).status).toBe(200);
      expect((await A.admin.post(`/v1/attachments/${created.attachment.id}/complete`)).status).toBe(
        200,
      );
    });

    it('complete sniffs the bytes: content that is not the declared type is rejected, archived and deleted', async () => {
      const cases: Array<[string, string, Buffer]> = [
        ['a.png', 'image/png', svg()],
        ['a.png', 'image/png', html()],
        ['a.pdf', 'application/pdf', await png()],
        ['a.csv', 'text/csv', exe()],
        ['a.jpg', 'image/jpeg', await png()],
        [
          'a.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          pdf(),
        ],
      ];
      for (const [filename, content_type, body] of cases) {
        const created = await createAttachment(A.admin, {
          ...pngOwner(),
          filename,
          content_type,
          size_bytes: body.length,
        });
        expect((await putBytes(h, created.upload, body)).status).toBe(200);
        const done = await A.admin.post(`/v1/attachments/${created.attachment.id}/complete`);
        expect(done.status, `${filename} <- ${body.subarray(0, 8).toString('latin1')}`).toBe(415);
        expect(done.body.code).toBe('unsupported-media-type');
        const row = await rowOf(A.tenantId, created.attachment.id);
        expect(row).toMatchObject({ scan_status: 'error', scan_detail: 'content-mismatch' });
        expect(row?.archived_at).not.toBeNull();
        expect(await h.storage.head(row!.storage_key)).toBeNull();
        expect((await A.admin.get(`/v1/attachments/${created.attachment.id}`)).status).toBe(404);
      }
      const audits = await auditRows(A.tenantId, `action = 'attachment.rejected'`);
      expect(audits.length).toBeGreaterThanOrEqual(cases.length);
    });

    it('a photo must be an image; the owner must exist in the tenant; unavailable owner types are refused', async () => {
      const photoPdf = await create({
        kind: 'photo',
        filename: 'x.pdf',
        content_type: 'application/pdf',
      });
      expect(photoPdf.status).toBe(422);
      expect(photoPdf.body.errors[0].pointer).toBe('/kind');
      const ghost = await create({ entity_id: randomUUID() });
      expect(ghost.status).toBe(422);
      expect(ghost.body.errors[0].pointer).toBe('/entity_id');
      const foreign = await create({ entity_id: assetB });
      expect(foreign.status).toBe(422);
      const unknownType = await create({ entity_type: 'user_account' });
      expect(unknownType.status).toBe(422);
      expect((await create({ entity_type: 'consumable' })).status).toBe(422);
      expect((await create({ extra: 1 })).status).toBe(422);
      expect((await create({ sha256: 'ABC' })).status).toBe(422);
    });

    it('complete before the upload, or twice for an archived/rejected upload, is a clean error', async () => {
      const created = await createAttachment(A.admin, {
        ...pngOwner(),
        filename: 'x.csv',
        content_type: 'text/csv',
        size_bytes: 10,
      });
      const early = await A.admin.post(`/v1/attachments/${created.attachment.id}/complete`);
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('upload-missing');
      expect((await A.admin.post(`/v1/attachments/${randomUUID()}/complete`)).status).toBe(404);
    });

    it('fuzzed ids and tokens in URLs never leak or crash', async () => {
      const junk = [
        'not-a-uuid',
        '00000000-0000-0000-0000-000000000000',
        randomUUID(),
        '../../etc/passwd',
        '%2e%2e%2f',
        "' or 1=1 --",
        'a'.repeat(300),
        '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d9', // one char short
        '0197A3C2-1B6E-7C3A-8D41-2F5B6A7C8D91',
      ];
      for (const j of junk) {
        for (const url of [
          `/v1/attachments/${encodeURIComponent(j)}`,
          `/v1/attachments/${encodeURIComponent(j)}/complete`,
        ]) {
          const res = await A.admin.request(url.endsWith('/complete') ? 'POST' : 'GET', url);
          expect(res.status, url).toBeLessThan(500);
          expect(res.status, url).toBeGreaterThanOrEqual(400);
        }
        const file = await A.admin.get(`/v1/files/${encodeURIComponent(j)}`, { cookie: false });
        expect(file.status, `files/${j}`).toBeLessThan(500);
        expect(file.status).toBeGreaterThanOrEqual(400);
        const put = await app.inject({
          method: 'PUT',
          url: `/v1/files/${encodeURIComponent(j)}`,
          payload: Buffer.from('x'),
          headers: { 'content-type': 'image/png' },
        });
        expect(put.statusCode, `PUT files/${j}`).toBeLessThan(500);
        expect(put.statusCode).toBeGreaterThanOrEqual(400);
      }
      for (const qs of [
        `entity_type=asset`,
        `entity_type=asset&entity_id=nope`,
        `entity_type=../x&entity_id=${assetA}`,
        `entity_type=asset&entity_id=${assetA}&kind=zzz`,
        `entity_type=asset&entity_id=${assetA}&cursor=garbage`,
      ]) {
        const res = await A.admin.get(`/v1/attachments?${qs}`);
        expect(res.status, qs).toBeGreaterThanOrEqual(400);
        expect(res.status, qs).toBeLessThan(500);
      }
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('tenant isolation of attachments', () => {
    it("tenant B cannot see, confirm, download, archive or list tenant A's attachments", async () => {
      const { id } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'secret.csv',
        content_type: 'text/csv',
        body: csv(),
      });
      await drainJobs(h);
      expect((await scanStatus(id)).download_url).toBeTruthy();
      for (const res of [
        await B.admin.get(`/v1/attachments/${id}`),
        await B.admin.post(`/v1/attachments/${id}/complete`),
        await B.admin.del(`/v1/attachments/${id}`),
      ]) {
        expect(res.status).toBe(404);
        expect(res.raw).not.toContain('secret.csv');
        expect(res.raw).not.toContain('tenants/');
      }
      const list = await B.admin.get(`/v1/attachments?entity_type=asset&entity_id=${assetA}`);
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([]);
      const create = await B.admin.post('/v1/attachments', {
        entity_type: 'asset',
        entity_id: assetA,
        filename: 'x.csv',
        content_type: 'text/csv',
        size_bytes: 5,
      });
      expect(create.status).toBe(422);
      // A is untouched
      expect((await scanStatus(id)).scan_status).toBe('clean');
    });

    it('object keys are tenant-prefixed, per attachment unique, and never shared between tenants', async () => {
      const a = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'k.csv',
        content_type: 'text/csv',
        body: csv(),
      });
      const b = await uploadFile(
        h,
        B.admin,
        B.tenantId,
        { entity_type: 'asset', entity_id: assetB },
        {
          filename: 'k.csv',
          content_type: 'text/csv',
          body: csv(),
        },
      );
      expect(a.key).toMatch(new RegExp(`^tenants/${A.tenantId}/\\d{4}/[0-9a-f-]{36}$`));
      expect(b.key).toMatch(new RegExp(`^tenants/${B.tenantId}/\\d{4}/[0-9a-f-]{36}$`));
      expect(a.key).not.toBe(b.key);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('roles and listing', () => {
    it('viewers read, technicians upload, API keys follow their scopes', async () => {
      const viewer = await createUser(app, A, 'viewer');
      const tech = await createUser(app, A, 'technician');
      const body = {
        ...pngOwner(),
        filename: 'x.csv',
        content_type: 'text/csv',
        size_bytes: 12,
      };
      expect((await viewer.client.post('/v1/attachments', body)).status).toBe(403);
      expect(
        (await viewer.client.get(`/v1/attachments?entity_type=asset&entity_id=${assetA}`)).status,
      ).toBe(200);
      const made = await tech.client.post('/v1/attachments', body);
      expect(made.status).toBe(201);
      expect(
        (await viewer.client.post(`/v1/attachments/${made.body.attachment.id}/complete`)).status,
      ).toBe(403);
      expect((await viewer.client.del(`/v1/attachments/${made.body.attachment.id}`)).status).toBe(
        403,
      );
      expect((await viewer.client.get(`/v1/attachments/${made.body.attachment.id}`)).status).toBe(
        200,
      );
    });

    it('lists an owner’s attachments newest first with a cursor, filtered by kind, archived ones hidden', async () => {
      const t = await createTenant(app, tenancy, 'listx');
      const { category } = await seedBasics(t.admin);
      const asset = (await t.admin.post('/v1/assets', { category_id: category.id })).body.id;
      const owner = { entity_type: 'asset', entity_id: asset };
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const made = await createAttachment(t.admin, {
          ...owner,
          kind: i % 2 === 0 ? 'photo' : 'document',
          filename: `f${i}.png`,
          content_type: 'image/png',
          size_bytes: 10 + i,
        });
        ids.push(made.attachment.id);
      }
      const first = await t.admin.get(
        `/v1/attachments?entity_type=asset&entity_id=${asset}&limit=2&include_total=true`,
      );
      expect(first.body.data.map((a: { id: string }) => a.id)).toEqual([ids[4], ids[3]]);
      expect(first.body.page).toMatchObject({ has_more: true, total: 5 });
      const second = await t.admin.get(
        `/v1/attachments?entity_type=asset&entity_id=${asset}&limit=2&cursor=${encodeURIComponent(first.body.page.next_cursor)}`,
      );
      expect(second.body.data.map((a: { id: string }) => a.id)).toEqual([ids[2], ids[1]]);
      const photos = await t.admin.get(
        `/v1/attachments?entity_type=asset&entity_id=${asset}&kind=photo`,
      );
      expect(photos.body.data).toHaveLength(3);
      expect((await t.admin.del(`/v1/attachments/${ids[4]}`)).status).toBe(204);
      const after = await t.admin.get(`/v1/attachments?entity_type=asset&entity_id=${asset}`);
      expect(after.body.data.map((a: { id: string }) => a.id)).not.toContain(ids[4]);
      expect((await t.admin.get(`/v1/attachments/${ids[4]}`)).status).toBe(404);
      const audit = await auditRows(t.tenantId, `action = 'attachment.archived'`);
      expect(audit).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('the orphan sweep and job resilience', () => {
    it('abandons uploads whose completion never arrived (object deleted, row archived) and re-queues lost scans', async () => {
      const t = await createTenant(app, tenancy, 'sweepx');
      const { category } = await seedBasics(t.admin);
      const asset = (await t.admin.post('/v1/assets', { category_id: category.id })).body.id;
      const owner = { entity_type: 'asset', entity_id: asset };

      // (1) created, bytes PUT, but "complete" never called
      const abandoned = await createAttachment(t.admin, {
        ...owner,
        filename: 'x.csv',
        content_type: 'text/csv',
        size_bytes: csv().length,
      });
      expect((await putBytes(h, abandoned.upload, csv())).status).toBe(200);
      const abandonedRow = await rowOf(t.tenantId, abandoned.attachment.id);
      // (2) a fresh incomplete upload is left alone
      const fresh = await createAttachment(t.admin, {
        ...owner,
        filename: 'y.csv',
        content_type: 'text/csv',
        size_bytes: 5,
      });
      // (3) completed long ago, scan job lost
      const stuck = await uploadFile(h, t.admin, t.tenantId, owner, {
        filename: 'z.csv',
        content_type: 'text/csv',
        body: csv(),
      });
      // (4) completed a moment ago: not re-queued
      const recent = await uploadFile(h, t.admin, t.tenantId, owner, {
        filename: 'r.csv',
        content_type: 'text/csv',
        body: csv(),
      });

      await ownerTenantSql(
        t.tenantId,
        `update app.attachment set created_at = now() - interval '25 hours' where id = $1`,
        [abandoned.attachment.id],
      );
      await ownerTenantSql(
        t.tenantId,
        `update app.attachment set uploaded_at = now() - interval '30 minutes' where id = $1`,
        [stuck.id],
      );
      h.jobs.jobs.length = 0;
      await runJob(h, 'attachment.sweep', { tenantId: t.tenantId });

      const gone = await rowOf(t.tenantId, abandoned.attachment.id);
      expect(gone).toMatchObject({ scan_status: 'error', scan_detail: 'upload-abandoned' });
      expect(gone?.archived_at).not.toBeNull();
      expect(await h.storage.head(abandonedRow!.storage_key)).toBeNull();
      expect((await rowOf(t.tenantId, fresh.attachment.id))?.archived_at).toBeNull();
      const queued = h.jobs.jobs
        .filter((j) => j.name === 'attachment.scan')
        .map((j) => j.payload.attachmentId);
      expect(queued).toEqual([stuck.id]);
      expect(queued).not.toContain(recent.id);
      expect((await auditRows(t.tenantId, `action = 'attachment.abandoned'`)).length).toBe(1);

      // running it again does nothing new
      h.jobs.jobs.length = 0;
      await runJob(h, 'attachment.sweep', { tenantId: t.tenantId });
      expect(h.jobs.jobs.filter((j) => j.name === 'attachment.scan')).toHaveLength(1); // the same stuck one, singleton-keyed
      expect((await auditRows(t.tenantId, `action = 'attachment.abandoned'`)).length).toBe(1);
    });

    it('a scanner outage leaves the upload pending and the job failing (so it retries); it never marks clean', async () => {
      if (!(h.scanner instanceof FakeVirusScanner)) return; // the real daemon cannot be switched off here
      const { id } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'o.csv',
        content_type: 'text/csv',
        body: csv(),
      });
      h.scanner.failing = true;
      await expect(
        runJob(h, 'attachment.scan', { tenantId: A.tenantId, attachmentId: id }),
      ).rejects.toThrow(/down/);
      expect((await rowOf(A.tenantId, id))?.scan_status).toBe('pending');
      h.scanner.failing = false;
      await runJob(h, 'attachment.scan', { tenantId: A.tenantId, attachmentId: id });
      expect((await rowOf(A.tenantId, id))?.scan_status).toBe('clean');
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('primary pictures of assets and models (M2-FILE-03)', () => {
    it('an asset picture must be a usable image attachment of that very asset; archiving it while in use is a 409', async () => {
      const { id: imageId } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'main.png',
        content_type: 'image/png',
        body: await png(),
        kind: 'photo',
      });
      const { id: pdfId } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'x.pdf',
        content_type: 'application/pdf',
        body: pdf(),
      });
      const { id: foreignId } = await uploadFile(
        h,
        B.admin,
        B.tenantId,
        { entity_type: 'asset', entity_id: assetB },
        {
          filename: 'b.png',
          content_type: 'image/png',
          body: await png(),
          kind: 'photo',
        },
      );
      const other = (
        await A.admin.post('/v1/assets', {
          category_id: (await A.admin.get(`/v1/assets/${assetA}`)).body.category_id,
        })
      ).body.id;
      const { id: otherImage } = await uploadFile(
        h,
        A.admin,
        A.tenantId,
        { entity_type: 'asset', entity_id: other },
        {
          filename: 'o.png',
          content_type: 'image/png',
          body: await png(),
          kind: 'photo',
        },
      );

      const get = await A.admin.get(`/v1/assets/${assetA}`);
      const patch = (imageAttachmentId: string | null) =>
        A.admin.patch(
          `/v1/assets/${assetA}`,
          { image_attachment_id: imageAttachmentId },
          { headers: { 'if-match': '*' } },
        );
      expect(get.body.image_attachment_id).toBeNull();
      for (const bad of [pdfId, foreignId, otherImage, randomUUID()]) {
        const res = await patch(bad);
        expect(res.status, bad).toBe(422);
        expect(res.body.errors[0].pointer).toBe('/image_attachment_id');
      }
      const ok = await patch(imageId);
      expect(ok.status).toBe(200);
      expect(ok.body.image_attachment_id).toBe(imageId);
      expect((await A.admin.get(`/v1/assets/${assetA}`)).body.image_attachment_id).toBe(imageId);
      // a picture can only be set on an existing asset
      const create = await A.admin.post('/v1/assets', {
        category_id: get.body.category_id,
        image_attachment_id: imageId,
      });
      expect(create.status).toBe(422);

      const blocked = await A.admin.del(`/v1/attachments/${imageId}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.usage).toEqual({ assets: 1, models: 0 });
      expect((await patch(null)).body.image_attachment_id).toBeNull();
      expect((await A.admin.del(`/v1/attachments/${imageId}`)).status).toBe(204);
    });

    it('a model picture is an image attachment whose owner is the model', async () => {
      const basics = await seedBasics(A.admin);
      const modelId = basics.model.id as string;
      const { id } = await uploadFile(
        h,
        A.admin,
        A.tenantId,
        { entity_type: 'asset_model', entity_id: modelId },
        {
          filename: 'model.png',
          content_type: 'image/png',
          body: await png(),
          kind: 'photo',
        },
      );
      const { id: assetPhoto } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
        filename: 'a.png',
        content_type: 'image/png',
        body: await png(),
        kind: 'photo',
      });
      const model = await A.admin.get(`/v1/models/${modelId}`);
      expect(model.body.image_attachment_id).toBeNull();
      const bad = await A.admin.patch(
        `/v1/models/${modelId}`,
        { image_attachment_id: assetPhoto },
        { headers: { 'if-match': String(model.headers.etag) } },
      );
      expect(bad.status).toBe(422);
      const ok = await A.admin.patch(
        `/v1/models/${modelId}`,
        { image_attachment_id: id },
        { headers: { 'if-match': String(model.headers.etag) } },
      );
      expect(ok.status).toBe(200);
      expect(ok.body.image_attachment_id).toBe(id);
      expect((await A.admin.del(`/v1/attachments/${id}`)).body.usage).toEqual({
        assets: 0,
        models: 1,
      });
    });
  });

  // ------------------------------------------------------------------------------------------
  if (driver === 'local') {
    describe('local storage endpoints: PUT|GET /v1/files/{token}', () => {
      const local = () =>
        h.storage as unknown as import('../../src/storage/index.js').LocalStorageAdapter;

      it('reject forged, expired, mistyped and mis-sized requests, write once, set the full header set', async () => {
        const body = await png();
        const created = await createAttachment(A.admin, {
          ...pngOwner(),
          filename: 'x.png',
          content_type: 'image/png',
          size_bytes: body.length,
        });
        const path = new URL(created.upload.url).pathname;
        const put = (p: string, payload: Buffer, ct = 'image/png') =>
          app.inject({ method: 'PUT', url: p, headers: { 'content-type': ct }, payload });
        const token = path.split('/').pop()!;
        // forged: flip a signature char
        const forged = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
        expect((await put(`/v1/files/${forged}`, body)).statusCode).toBe(404);
        // wrong operation: a GET token cannot upload
        const get = await local().presignDownload({
          key: (await rowOf(A.tenantId, created.attachment.id))!.storage_key,
          filename: 'x.png',
          contentType: 'image/png',
          disposition: 'inline',
          ttlSeconds: 60,
        });
        expect((await put(new URL(get.url).pathname, body)).statusCode).toBe(404);
        // expired
        const expired = await local().presignUpload({
          key: (await rowOf(A.tenantId, created.attachment.id))!.storage_key,
          contentType: 'image/png',
          sizeBytes: body.length,
          ttlSeconds: -5,
        });
        const gone = await put(new URL(expired.url).pathname, body);
        expect(gone.statusCode).toBe(410);
        expect(JSON.parse(gone.body).code).toBe('token-expired');
        // wrong type, too many bytes, too few bytes
        expect((await put(path, body, 'application/pdf')).statusCode).toBe(415);
        expect((await put(path, Buffer.concat([body, Buffer.from('z')]))).statusCode).toBe(413);
        expect((await put(path, body.subarray(0, 10))).statusCode).toBe(400);
        expect(
          (await rowOf(A.tenantId, created.attachment.id)) &&
            (await h.storage.head((await rowOf(A.tenantId, created.attachment.id))!.storage_key)),
        ).toBeNull();
        // the real upload works once
        expect((await put(path, body)).statusCode).toBe(200);
        expect((await put(path, body)).statusCode).toBe(409);
        // downloading with the upload token fails; with a download token it carries the hardened headers
        expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(404);
        await A.admin.post(`/v1/attachments/${created.attachment.id}/complete`);
        await drainJobs(h);
        const dl = (await scanStatus(created.attachment.id)).download_url as string;
        const res = await app.inject({ method: 'GET', url: new URL(dl).pathname });
        expect(res.statusCode).toBe(200);
        expect(res.headers).toMatchObject({
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
          'cross-origin-resource-policy': 'cross-origin',
          'cache-control': 'private, no-store',
          'referrer-policy': 'no-referrer',
          'x-frame-options': 'DENY',
          'content-type': 'image/png',
        });
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(res.headers['content-disposition']).toMatch(/^inline; filename="x.png"/);
        // an expired download link
        const oldDl = await local().presignDownload({
          key: (await rowOf(A.tenantId, created.attachment.id))!.storage_key,
          filename: 'x.png',
          contentType: 'image/png',
          disposition: 'inline',
          ttlSeconds: -5,
        });
        expect(
          (await app.inject({ method: 'GET', url: new URL(oldDl.url).pathname })).statusCode,
        ).toBe(410);
      });

      it('serves non-images as attachments with a type from the allow-list, whatever the token says', async () => {
        const { id, key } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
          filename: 'rows.csv',
          content_type: 'text/csv',
          body: csv(),
        });
        await drainJobs(h);
        // a token that asks for inline HTML is served as an octet-stream download
        const sneaky = await local().presignDownload({
          key,
          filename: 'evil.html',
          contentType: 'text/html',
          disposition: 'inline',
          ttlSeconds: 60,
        });
        const res = await app.inject({ method: 'GET', url: new URL(sneaky.url).pathname });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/octet-stream');
        expect(String(res.headers['content-disposition'])).toMatch(/^attachment/);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        const normal = (await scanStatus(id)).download_url as string;
        const csvRes = await app.inject({ method: 'GET', url: new URL(normal).pathname });
        expect(csvRes.headers['content-type']).toBe('text/csv');
        expect(String(csvRes.headers['content-disposition'])).toMatch(/^attachment/);
      });
    });
  } else {
    describe('S3 driver', () => {
      it('the local file endpoints answer 404 (files live in the object store)', async () => {
        const res = await app.inject({ method: 'GET', url: '/v1/files/abc.def' });
        expect(res.statusCode).toBe(404);
        expect(await h.storage.head(`tenants/${A.tenantId}/2026/${randomUUID()}`)).toBeNull();
      });

      it('presigned download URLs force the content type, disposition and cache headers', async () => {
        const { id } = await uploadFile(h, A.admin, A.tenantId, pngOwner(), {
          filename: 'résumé "x".csv',
          content_type: 'text/csv',
          body: csv(),
        });
        await drainJobs(h);
        const file = await fetchUrl(h, (await scanStatus(id)).download_url);
        expect(file.status).toBe(200);
        expect(String(file.headers['content-disposition'])).toBe(
          `attachment; filename="r_sum_ _x_.csv"; filename*=UTF-8''r%C3%A9sum%C3%A9%20_x_.csv`,
        );
        expect(String(file.headers['content-type'])).toMatch(/^text\/csv/);
        expect(file.headers['cache-control']).toBe('private, no-store');
      });
    });
  }
});

// ----------------------------------------------------------------------------------------------
describe.skipIf(!dbEnabled)('scan configuration (SCAN_REQUIRED)', () => {
  const tenancy = newTenancy();
  const owners = unique('scancfg');

  async function setup(scanRequired: boolean) {
    const h = await startFilesApp({ scanner: 'off', scanRequired });
    const t = await createTenant(h.app, tenancy, owners.slice(-6));
    const { category } = await seedBasics(t.admin);
    const asset = (await t.admin.post('/v1/assets', { category_id: category.id })).body.id;
    const file = await uploadFile(
      h,
      t.admin,
      t.tenantId,
      { entity_type: 'asset', entity_id: asset },
      {
        filename: 'p.png',
        content_type: 'image/png',
        body: await png(),
        kind: 'photo',
      },
    );
    return { h, t, file };
  }
  afterAll(async () => {
    await tenancy.onModuleDestroy();
  });

  it('with no scanner and SCAN_REQUIRED=true the upload stays pending (the job fails and retries)', async () => {
    const { h, t, file } = await setup(true);
    try {
      await expect(
        runJob(h, 'attachment.scan', { tenantId: t.tenantId, attachmentId: file.id }),
      ).rejects.toThrow(/scanning is required/);
      const got = (await t.admin.get(`/v1/attachments/${file.id}`)).body;
      expect(got).toMatchObject({ scan_status: 'pending', download_url: null });
    } finally {
      await h.close();
    }
  });

  it('with SCAN_REQUIRED=false it is marked clean with scan-disabled, a warning event, and still thumbnailed', async () => {
    const { h, t, file } = await setup(false);
    try {
      await drainJobs(h);
      const got = (await t.admin.get(`/v1/attachments/${file.id}`)).body;
      expect(got).toMatchObject({ scan_status: 'clean', scan_detail: 'scan-disabled' });
      expect(got.download_url).toBeTruthy();
      expect(got.thumbnail_url).toBeTruthy();
      const events = (await outboxRows(t.tenantId, `aggregate_id = '${file.id}'`)).map(
        (e) => e.event_type,
      );
      expect(events).toContain('attachment.scan_skipped');
      expect((await auditRows(t.tenantId, `action = 'attachment.scan_skipped'`)).length).toBe(1);
    } finally {
      await h.close();
    }
  });
});

void jpeg;
