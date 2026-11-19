import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, dbEnabled, type Resp } from '../auth/support.js';
import { type TenantFixture, createTenant, newTenancy, seedBasics } from '../registry/support.js';
import {
  FILES_TAGS,
  UNIVERSAL_STATUSES,
  loadContract,
  loadProblemCodes,
} from '../support/contract.js';
import { contractViolations } from '../support/contract-observer.js';
import { csv, png } from '../support/file-fixtures.js';
import { check } from '../support/schema-check.js';
import {
  type FilesHarness,
  createAttachment,
  drainJobs,
  putBytes,
  startFilesApp,
} from './support.js';

/**
 * M1-PLAT-03 contract test, live half, for the Attachments tag (files, settings, local file links):
 * every operation is called with valid input and its answer must match the contract (status,
 * response schema, problem code), and the walk must cover every operation of the tag.
 */
describe.skipIf(!dbEnabled)('attachments contract (live)', () => {
  const tenancy = newTenancy();
  let h: FilesHarness;
  let t: TenantFixture;
  const { operations } = loadContract();
  const byId = new Map(operations.map((o) => [o.operationId, o]));
  const walked = new Set<string>();
  const problemCodes = loadProblemCodes();

  beforeAll(async () => {
    h = await startFilesApp({ driver: 'local', scanner: 'fake' });
    t = await createTenant(h.app, tenancy, 'filescontract');
  });
  afterAll(async () => {
    await h.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  function verify(operationId: string, status: number, body: unknown, raw: string, ctype: string) {
    const op = byId.get(operationId);
    expect(op, `operation ${operationId} is not in the contract`).toBeDefined();
    expect(
      op!.statuses.includes(status) || UNIVERSAL_STATUSES.includes(status),
      `${operationId} answered ${status}, the contract documents ${op!.statuses.join(', ')}`,
    ).toBe(true);
    if (status < 400) {
      walked.add(operationId);
      const schema = op!.responseSchemas[status];
      if (schema) {
        expect(
          check({ $ref: `#/components/schemas/${schema}` }, body),
          `${operationId} body`,
        ).toEqual([]);
      } else if (status !== 204 && !/octet|binary|image|text\/csv/.test(ctype)) {
        expect(raw, `${operationId}: the contract documents no body for ${status}`).toBe('');
      }
    } else {
      expect(ctype).toMatch(/^application\/problem\+json/);
      expect(check({ $ref: '#/components/schemas/Problem' }, body)).toEqual([]);
      const code = (body as { code: string }).code;
      expect(problemCodes[code], `unknown problem code ${code}`).toContain(status);
    }
  }

  async function hit(
    operationId: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    expected: number,
    options: { body?: unknown; ifMatch?: string; client?: Client } = {},
  ): Promise<Resp> {
    const res = await (options.client ?? t.admin).request(method, url, {
      body: options.body,
      headers: options.ifMatch ? { 'if-match': options.ifMatch } : {},
    });
    expect(res.status, `${operationId}: ${method} ${url} -> ${res.raw.slice(0, 300)}`).toBe(
      expected,
    );
    verify(operationId, res.status, res.body, res.raw, String(res.headers['content-type']));
    return res;
  }

  it('walks every Attachments operation: statuses, bodies and problem codes match the contract', async () => {
    const { category } = await seedBasics(t.admin);
    const asset = (await t.admin.post('/v1/assets', { category_id: category.id })).body
      .id as string;
    const owner = { entity_type: 'asset', entity_id: asset };
    const body = await png();

    // ---- create / upload / complete / get / list / archive
    const created = await hit('createAttachment', 'POST', '/v1/attachments', 201, {
      body: {
        ...owner,
        kind: 'photo',
        filename: 'a.png',
        content_type: 'image/png',
        size_bytes: body.length,
      },
    });
    const id = created.body.attachment.id as string;
    expect(created.headers.location).toBe(`/v1/attachments/${id}`);
    await hit('createAttachment', 'POST', '/v1/attachments', 415, {
      body: { ...owner, filename: 'a.svg', content_type: 'image/svg+xml', size_bytes: 10 },
    });
    await hit('createAttachment', 'POST', '/v1/attachments', 413, {
      body: { ...owner, filename: 'a.csv', content_type: 'text/csv', size_bytes: 50 * 1024 * 1024 },
    });
    await hit('createAttachment', 'POST', '/v1/attachments', 422, {
      body: {
        ...owner,
        entity_id: randomUUID(),
        filename: 'a.csv',
        content_type: 'text/csv',
        size_bytes: 10,
      },
    });
    await hit('completeAttachment', 'POST', `/v1/attachments/${id}/complete`, 409);
    expect((await putBytes(h, created.body.upload, body)).status).toBe(200);
    await hit('completeAttachment', 'POST', `/v1/attachments/${id}/complete`, 200);
    await hit('completeAttachment', 'POST', `/v1/attachments/${randomUUID()}/complete`, 404);
    await drainJobs(h);
    const got = await hit('getAttachment', 'GET', `/v1/attachments/${id}`, 200);
    expect(got.body.scan_status).toBe('clean');
    expect(got.body.download_url).toBeTruthy();
    await hit('getAttachment', 'GET', `/v1/attachments/${randomUUID()}`, 404);
    await hit(
      'listAttachments',
      'GET',
      `/v1/attachments?entity_type=asset&entity_id=${asset}&limit=5&include_total=true`,
      200,
    );
    await hit('listAttachments', 'GET', '/v1/attachments?entity_type=asset', 400);

    // upload with wrong content: a rejected completion documents 415
    const fake = await createAttachment(t.admin, {
      ...owner,
      filename: 'b.png',
      content_type: 'image/png',
      size_bytes: csv().length,
    });
    expect((await putBytes(h, fake.upload, csv())).status).toBe(200);
    await hit('completeAttachment', 'POST', `/v1/attachments/${fake.attachment.id}/complete`, 415);

    // an attachment in use as the asset picture cannot be archived (409 with usage), then can
    await hit('updateAsset', 'PATCH', `/v1/assets/${asset}`, 200, {
      body: { image_attachment_id: id },
      ifMatch: '*',
    });
    await hit('archiveAttachment', 'DELETE', `/v1/attachments/${id}`, 409);
    await t.admin.patch(
      `/v1/assets/${asset}`,
      { image_attachment_id: null },
      { headers: { 'if-match': '*' } },
    );
    const gone = await hit('archiveAttachment', 'DELETE', `/v1/attachments/${id}`, 204);
    expect(gone.raw).toBe('');
    await hit('archiveAttachment', 'DELETE', `/v1/attachments/${randomUUID()}`, 404);

    // ---- settings
    const settings = await hit('getFilesSettings', 'GET', '/v1/settings/files', 200);
    await hit('putFilesSettings', 'PUT', '/v1/settings/files', 200, {
      body: { strip_exif_original: true, max_upload_bytes: null },
      ifMatch: String(settings.headers.etag),
    });
    await hit('putFilesSettings', 'PUT', '/v1/settings/files', 412, {
      body: { strip_exif_original: false, max_upload_bytes: null },
      ifMatch: String(settings.headers.etag),
    });
    await hit('putFilesSettings', 'PUT', '/v1/settings/files', 428, {
      body: { strip_exif_original: false, max_upload_bytes: null },
    });
    await hit('putFilesSettings', 'PUT', '/v1/settings/files', 422, {
      body: { strip_exif_original: false, max_upload_bytes: 5 },
      ifMatch: '*',
    });

    // ---- local file links (token is the credential)
    const link = await createAttachment(t.admin, {
      ...owner,
      filename: 'c.csv',
      content_type: 'text/csv',
      size_bytes: csv().length,
    });
    const path = new URL(link.upload.url).pathname;
    const put = await h.app.inject({
      method: 'PUT',
      url: path,
      headers: { 'content-type': 'text/csv' },
      payload: csv(),
    });
    verify(
      'uploadLocalFile',
      put.statusCode,
      put.body ? JSON.parse(put.body) : undefined,
      put.body,
      String(put.headers['content-type'] ?? ''),
    );
    expect(put.statusCode).toBe(200);
    for (const [status, req] of [
      [409, { content: 'text/csv', body: csv() }],
      [415, { content: 'image/png', body: csv() }],
      [400, { content: 'text/csv', body: Buffer.from('x') }],
    ] as const) {
      const again = await h.app.inject({
        method: 'PUT',
        url: path,
        headers: { 'content-type': req.content },
        payload: req.body,
      });
      expect(again.statusCode).toBe(status);
      verify(
        'uploadLocalFile',
        again.statusCode,
        JSON.parse(again.body),
        again.body,
        String(again.headers['content-type']),
      );
    }
    const forged = await h.app.inject({
      method: 'PUT',
      url: '/v1/files/abc.def',
      headers: { 'content-type': 'text/csv' },
      payload: csv(),
    });
    expect(forged.statusCode).toBe(404);
    verify(
      'uploadLocalFile',
      404,
      JSON.parse(forged.body),
      forged.body,
      String(forged.headers['content-type']),
    );

    await t.admin.post(`/v1/attachments/${link.attachment.id}/complete`);
    await drainJobs(h);
    const url = (await t.admin.get(`/v1/attachments/${link.attachment.id}`)).body
      .download_url as string;
    const dl = await h.app.inject({ method: 'GET', url: new URL(url).pathname });
    expect(dl.statusCode).toBe(200);
    verify('downloadLocalFile', 200, undefined, dl.body, String(dl.headers['content-type']));
    const bad = await h.app.inject({ method: 'GET', url: '/v1/files/abc.def' });
    verify(
      'downloadLocalFile',
      bad.statusCode,
      JSON.parse(bad.body),
      bad.body,
      String(bad.headers['content-type']),
    );
    expect(bad.statusCode).toBe(404);
  });

  it('the walk covered every Attachments operation of the contract', () => {
    const required = operations.filter((o) => FILES_TAGS.has(o.tag)).map((o) => o.operationId);
    expect(required.length).toBeGreaterThanOrEqual(9);
    expect(required.filter((id) => !walked.has(id))).toEqual([]);
  });
});
