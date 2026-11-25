import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportEngine, ImportRunner } from '../../src/importer/index.js';
import { TenancyService } from '../../src/tenancy/index.js';
import { dbEnabled, env, withClient } from '../auth/support.js';
import { type Driver, fetchUrl, runJob, s3Env, startFilesApp } from '../files/support.js';
import {
  type ImportHarness,
  type TenantFixture,
  analyzed,
  basics,
  createTenant,
  newAsset,
  newTenancy,
  ownerTenantSql,
} from '../importer/support.js';
import { mode } from '../support/db.js';
import { runLabelJob } from '../tagging/support.js';

/**
 * M2-SEC-01: every stored file is under its tenant's prefix, and fuzzed ids, tokens and keys in file and
 * download URLs fail without leaking: attachments, label PDFs, export files, import uploads (and the
 * import error report, which is streamed from the rows, not stored). Runs on the local driver (signed
 * file tokens served by the API) and, with S3_ENDPOINT, on MinIO (presigned URLs), in both e2e modes.
 *
 * The object-key columns are found in the catalogue by name (`storage_key`, `thumb_key`, `*_object_key`,
 * `*_file_key`): a new one without the tenant-prefix CHECK fails here.
 */
const OBJECT_KEY_COLUMN = /^(storage_key|thumb_key|.+_storage_key|.+_object_key|.+_file_key)$/;

const drivers: Driver[] = ['local', ...(s3Env ? (['s3'] as const) : [])];

describe.skipIf(!dbEnabled).each(drivers)(
  `stored files and download URLs: %s (${mode})`,
  (driver) => {
    const tenancy = newTenancy();
    let ih: ImportHarness;
    let A: TenantFixture;
    let B: TenantFixture;
    /** download URLs of A's objects, by kind, and the bytes each one serves */
    const urls: Record<string, { url: string; body: Buffer }> = {};
    let bExportUrl: string;
    const ids: Record<string, string> = {};

    /** A label PDF, an export file and an import upload of tenant T (its download URLs). */
    async function filesOf(T: TenantFixture) {
      const { categoryId } = await basics(T);
      const asset = await newAsset(T.admin, categoryId, { name: `${T.slug} laptop` });
      const batch = await T.admin.post(
        '/v1/labels/batches',
        { template_key: 'letter-30up-qr', asset_ids: [asset.id] },
        { headers: { 'idempotency-key': randomUUID() } },
      );
      expect(batch.status, batch.raw).toBe(202);
      await runLabelJob(ih.h, 'label.render', { tenantId: T.tenantId, batchId: batch.body.id });
      const exp = await T.admin.post('/v1/exports', { resource: 'assets' });
      expect(exp.status, exp.raw).toBe(202);
      await runJob(ih.h, 'export.run', { tenantId: T.tenantId, exportId: exp.body.id });
      const job = await analyzed(ih, T.admin, T.tenantId, 'asset', {
        filename: 'assets.csv',
        body: 'Name,Serial\nA laptop,SN-1\n',
      });
      ih.h.jobs.jobs.splice(0);
      const label = (await T.admin.get(`/v1/labels/batches/${batch.body.id}`)).body;
      const file = (await T.admin.get(`/v1/exports/${exp.body.id}`)).body;
      const upload = (await T.admin.get(`/v1/attachments/${job.file_attachment_id}`)).body;
      for (const [what, url] of [
        ['label PDF', label.download_url],
        ['export file', file.download_url],
        ['import upload', upload.download_url],
      ]) {
        expect(typeof url, `${what} download_url`).toBe('string');
      }
      return {
        batchId: batch.body.id as string,
        exportId: exp.body.id as string,
        importId: job.id as string,
        uploadId: job.file_attachment_id as string,
        label: label.download_url as string,
        export: file.download_url as string,
        upload: upload.download_url as string,
      };
    }

    beforeAll(async () => {
      // the import harness, on the driver of this run
      const h = await startFilesApp({ driver, scanner: 'fake' });
      ih = {
        h,
        runtime: h.app.get(TenancyService, { strict: false }),
        runner: h.app.get(ImportRunner, { strict: false }),
        engine: h.app.get(ImportEngine, { strict: false }),
      };
      A = await createTenant(ih.h.app, tenancy, 'keysa');
      B = await createTenant(ih.h.app, tenancy, 'keysb');
      const a = await filesOf(A);
      const b = await filesOf(B);
      bExportUrl = b.export;
      Object.assign(ids, {
        batchId: a.batchId,
        exportId: a.exportId,
        importId: a.importId,
        uploadId: a.uploadId,
      });
      for (const [what, url] of [
        ['label PDF', a.label],
        ['export file', a.export],
        ['import upload', a.upload],
      ] as const) {
        const res = await fetchUrl(ih.h, url);
        expect(res.status, `${what}: ${url}`).toBe(200);
        expect(res.body.length).toBeGreaterThan(0);
        urls[what] = { url, body: res.body };
      }
    }, 120_000);
    afterAll(async () => {
      await ih?.h.close();
      await tenancy.onModuleDestroy();
    });

    it('every object-key column has a tenant-prefix CHECK, and every stored key of A and B is under its tenant', async () => {
      const columns = await withClient(env.migratorUrl!, async (c) => {
        const { rows } = await c.query<{ tbl: string; col: string }>(
          `select c.relname as tbl, a.attname as col
           from pg_attribute a join pg_class c on c.oid = a.attrelid
          where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p') and not c.relispartition
            and a.attnum > 0 and not a.attisdropped and a.atttypid = 'text'::regtype`,
        );
        const keyColumns = rows.filter((r) => OBJECT_KEY_COLUMN.test(r.col));
        for (const { tbl, col } of keyColumns) {
          const checks = await c.query<{ def: string }>(
            `select pg_get_constraintdef(oid) as def from pg_constraint
            where conrelid = ('app.' || $1)::regclass and contype = 'c'`,
            [tbl],
          );
          expect(
            checks.rows.some(
              (r) =>
                r.def.includes(col) && /'tenants\/'::text \|\| \(?tenant_id\)?::text/.test(r.def),
            ),
            `app.${tbl}.${col} has no tenant-prefix CHECK`,
          ).toBe(true);
        }
        return keyColumns;
      });
      expect(columns.map((r) => `${r.tbl}.${r.col}`).sort()).toEqual(
        expect.arrayContaining([
          'attachment.storage_key',
          'attachment.thumb_key',
          'export_job.storage_key',
          'label_batch.storage_key',
        ]),
      );
      for (const T of [A, B]) {
        for (const { tbl, col } of columns) {
          const { rows } = await ownerTenantSql(
            T.tenantId,
            `select ${col} as k from app.${tbl} where ${col} is not null`,
          );
          for (const r of rows as Array<{ k: string }>) {
            expect(r.k.startsWith(`tenants/${T.tenantId}/`), `${tbl}.${col} ${r.k}`).toBe(true);
          }
        }
      }
      // A's three files really are stored: a label PDF, an export file and an import upload
      const stored = await ownerTenantSql(
        A.tenantId,
        `select (select count(*) from app.label_batch where storage_key is not null)::int as labels,
              (select count(*) from app.export_job where storage_key is not null)::int as exports,
              (select count(*) from app.attachment where kind = 'import_file')::int as uploads`,
      );
      expect(stored.rows[0]).toEqual({ labels: 1, exports: 1, uploads: 1 });
    });

    it("tampered download URLs (another tenant's key, a forged or truncated signature, junk) fail without serving A's bytes", async () => {
      const aPrefix = `tenants/${A.tenantId}/`;
      const bPrefix = `tenants/${B.tenantId}/`;
      for (const [what, { url, body }] of Object.entries(urls)) {
        const tampered: string[] = [];
        const u = new URL(url);
        if (driver === 'local') {
          // /v1/files/<base64url(json)>.<mac>: the token names the key, the mac covers it
          const token = decodeURIComponent(u.pathname.split('/').pop()!);
          const [payload, mac] = token.split('.') as [string, string];
          const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
            k: string;
          };
          expect(claims.k.startsWith(aPrefix), `${what} key ${claims.k}`).toBe(true);
          const forge = (k: string) =>
            `${Buffer.from(JSON.stringify({ ...claims, k }), 'utf8').toString('base64url')}.${mac}`;
          const bKey = claims.k.replace(aPrefix, bPrefix);
          const withToken = (t: string) => `${u.origin}/v1/files/${encodeURIComponent(t)}`;
          tampered.push(
            withToken(forge(bKey)),
            withToken(forge(`${aPrefix}../${bPrefix}x`)),
            withToken(forge(`${aPrefix}${randomUUID()}`)),
            withToken(`${payload}.${mac.slice(0, -2)}${mac.endsWith('AA') ? 'BB' : 'AA'}`),
            withToken(`${payload}.`),
            withToken(payload),
            withToken(`${payload}.${mac}.${mac}`),
            withToken('not-a-token'),
            withToken('../../etc/passwd'),
            withToken(randomUUID()),
          );
        } else {
          // a presigned S3 URL: the signature covers the key in the path
          const swapPath = (path: string) => `${u.origin}${path}${u.search}`;
          const key = decodeURIComponent(u.pathname);
          expect(key.includes(aPrefix), `${what} key ${key}`).toBe(true);
          tampered.push(
            swapPath(u.pathname.replace(A.tenantId, B.tenantId)),
            swapPath(u.pathname.replace(/[^/]+$/, randomUUID())),
            `${u.origin}${u.pathname}${u.search.replace(/X-Amz-Signature=[0-9a-f]{4}/, 'X-Amz-Signature=0000')}`,
            `${u.origin}${u.pathname}`,
            // B's own (valid) URL with A's key in its path: B's signature does not cover A's key
            swapPath(new URL(bExportUrl).pathname.replace(B.tenantId, A.tenantId)).replace(
              u.search,
              new URL(bExportUrl).search,
            ),
          );
        }
        for (const bad of tampered) {
          const res = await fetchUrl(ih.h, bad);
          expect(res.status, `${what}: ${bad}`).toBeGreaterThanOrEqual(400);
          expect(res.status, `${what}: ${bad}`).toBeLessThan(500);
          expect(res.body.equals(body), `${what}: ${bad} served A's file`).toBe(false);
        }
      }
    });

    it("B cannot reach A's files by id, and fuzzed ids in the file routes are a 4xx, never a 5xx", async () => {
      for (const url of [
        `/v1/labels/batches/${ids.batchId}`,
        `/v1/exports/${ids.exportId}`,
        `/v1/attachments/${ids.uploadId}`,
        `/v1/imports/${ids.importId}`,
        `/v1/imports/${ids.importId}/errors.csv`,
        `/v1/imports/${ids.importId}/rows`,
      ]) {
        const res = await B.admin.get(url);
        expect(res.status, url).toBe(404);
        expect(res.raw).not.toContain(A.tenantId);
      }
      // B naming A's upload as the file of its own import is refused
      const own = await B.admin.post('/v1/imports', { entity_type: 'asset' });
      const steal = await B.admin.post(`/v1/imports/${own.body.id}/analyze`, {
        file_attachment_id: ids.uploadId,
      });
      expect([404, 422]).toContain(steal.status);
      expect(steal.raw).not.toContain('assets.csv');
      const junk = [
        'not-a-uuid',
        '00000000-0000-0000-0000-000000000000',
        randomUUID(),
        '..%2F..%2Fetc%2Fpasswd',
        "' or 1=1 --",
        'a'.repeat(300),
        `${A.tenantId}`,
        encodeURIComponent(`tenants/${A.tenantId}/x`),
      ];
      for (const j of junk) {
        for (const url of [
          `/v1/labels/batches/${j}`,
          `/v1/exports/${j}`,
          `/v1/attachments/${j}`,
          `/v1/imports/${j}/errors.csv`,
          `/v1/imports/${j}/rows`,
        ]) {
          const res = await A.admin.get(url);
          expect(res.status, url).toBeGreaterThanOrEqual(400);
          expect(res.status, url).toBeLessThan(500);
        }
      }
    });
  },
);
