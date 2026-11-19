import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, dbEnabled, type Resp } from '../auth/support.js';
import {
  type TenantFixture,
  createTenant,
  createUser,
  newTenancy,
  seedBasics,
} from '../registry/support.js';
import {
  LABELS_TAGS,
  UNIVERSAL_STATUSES,
  loadContract,
  loadProblemCodes,
} from '../support/contract.js';
import { contractViolations } from '../support/contract-observer.js';
import { check } from '../support/schema-check.js';
import {
  type FilesHarness,
  WEB_BASE,
  idem,
  runLabelJob,
  startFilesApp,
  takeRenderJobs,
} from './support.js';

/**
 * M1-PLAT-03 contract test, live half, for the Labels tag: every operation is called with valid and
 * invalid input and its answer must match the contract (status, response schema, problem code), and
 * the walk must cover every operation of the tag.
 */
describe.skipIf(!dbEnabled)('labels contract (live)', () => {
  const tenancy = newTenancy();
  let h: FilesHarness;
  let t: TenantFixture;
  const { operations } = loadContract();
  const byId = new Map(operations.map((o) => [o.operationId, o]));
  const walked = new Set<string>();
  const problemCodes = loadProblemCodes();

  beforeAll(async () => {
    h = await startFilesApp({
      driver: 'local',
      scanner: 'fake',
      extra: { WEB_BASE_URL: WEB_BASE },
    });
    t = await createTenant(h.app, tenancy, 'labelscontract');
  });
  afterAll(async () => {
    await h.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  function verify(operationId: string, res: Resp) {
    const op = byId.get(operationId);
    expect(op, `operation ${operationId} is not in the contract`).toBeDefined();
    const { status } = res;
    expect(
      op!.statuses.includes(status) || UNIVERSAL_STATUSES.includes(status),
      `${operationId} answered ${status}, the contract documents ${op!.statuses.join(', ')}`,
    ).toBe(true);
    if (status < 400) {
      walked.add(operationId);
      const schema = op!.responseSchemas[status];
      expect(schema, `${operationId}: no response schema documented for ${status}`).toBeDefined();
      expect(
        check({ $ref: `#/components/schemas/${schema}` }, res.body),
        `${operationId} body`,
      ).toEqual([]);
    } else {
      expect(String(res.headers['content-type'])).toMatch(/^application\/problem\+json/);
      expect(check({ $ref: '#/components/schemas/Problem' }, res.body)).toEqual([]);
      const code = (res.body as { code: string }).code;
      expect(problemCodes[code], `unknown problem code ${code}`).toContain(status);
    }
  }

  async function hit(
    operationId: string,
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    expected: number,
    options: { body?: unknown; headers?: Record<string, string>; client?: Client } = {},
  ): Promise<Resp> {
    const res = await (options.client ?? t.admin).request(method, url, {
      body: options.body,
      headers: options.headers ?? {},
    });
    expect(res.status, `${operationId}: ${method} ${url} -> ${res.raw.slice(0, 300)}`).toBe(
      expected,
    );
    verify(operationId, res);
    return res;
  }

  it('walks every Labels operation: statuses, bodies and problem codes match the contract', async () => {
    const { category } = await seedBasics(t.admin);
    const assets = [];
    for (let i = 0; i < 3; i++) {
      assets.push(
        (await t.admin.post('/v1/assets', { category_id: category.id, name: `L${i}` })).body,
      );
    }

    // ---- templates
    const list = await hit('listLabelTemplates', 'GET', '/v1/labels/templates', 200);
    const first = list.body.data[0];
    const one = await hit('getLabelTemplate', 'GET', `/v1/labels/templates/${first.id}`, 200);
    await hit('getLabelTemplate', 'GET', `/v1/labels/templates/${randomUUID()}`, 404);
    const etag = String(one.headers.etag);
    await hit('updateLabelTemplate', 'PATCH', `/v1/labels/templates/${first.id}`, 428, {
      body: { offset_x_mm: 1 },
    });
    await hit('updateLabelTemplate', 'PATCH', `/v1/labels/templates/${first.id}`, 412, {
      body: { offset_x_mm: 1 },
      headers: { 'if-match': 'W/"999"' },
    });
    await hit('updateLabelTemplate', 'PATCH', `/v1/labels/templates/${first.id}`, 422, {
      body: { offset_x_mm: 99 },
      headers: { 'if-match': etag },
    });
    const patched = await hit(
      'updateLabelTemplate',
      'PATCH',
      `/v1/labels/templates/${first.id}`,
      200,
      {
        body: { offset_x_mm: 0.5 },
        headers: { 'if-match': etag },
      },
    );
    expect(patched.body.offset_x_mm).toBe(0.5);
    await hit('updateLabelTemplate', 'PATCH', `/v1/labels/templates/${randomUUID()}`, 404, {
      body: { offset_x_mm: 0 },
      headers: { 'if-match': etag },
    });
    // put the calibration back
    await t.admin.patch(
      `/v1/labels/templates/${first.id}`,
      { offset_x_mm: 0 },
      {
        headers: { 'if-match': String(patched.headers.etag) },
      },
    );

    // ---- batches
    const body = {
      template_key: 'letter-30up-qr',
      asset_ids: assets.map((a) => a.id),
      start_position: 3,
    };
    const created = await hit('createLabelBatch', 'POST', '/v1/labels/batches', 202, {
      body,
      headers: idem().headers,
    });
    const id = created.body.id as string;
    expect(created.headers.location).toBe(`/v1/labels/batches/${id}`);
    await hit('createLabelBatch', 'POST', '/v1/labels/batches', 400, { body });
    await hit('createLabelBatch', 'POST', '/v1/labels/batches', 422, {
      body: { ...body, start_position: 99 },
      headers: idem().headers,
    });
    await hit('createLabelBatch', 'POST', '/v1/labels/batches', 422, {
      body: { ...body, filter: {} },
      headers: idem().headers,
    });
    await hit('createLabelBatch', 'POST', '/v1/labels/batches', 403, {
      body,
      headers: idem().headers,
      client: (await createUser(h.app, t, 'viewer')).client,
    });
    const queued = await hit('getLabelBatch', 'GET', `/v1/labels/batches/${id}`, 200);
    expect(queued.body.status).toBe('queued');
    await hit('getLabelBatch', 'GET', `/v1/labels/batches/${randomUUID()}`, 404);

    const job = takeRenderJobs(h).find((j) => j.batchId === id)!;
    await runLabelJob(h, 'label.render', job);
    const ready = await hit('getLabelBatch', 'GET', `/v1/labels/batches/${id}`, 200);
    expect(ready.body.status).toBe('ready');
    expect(ready.body.download_url).toMatch(/^https?:\/\//);

    const page = await hit(
      'listLabelBatches',
      'GET',
      '/v1/labels/batches?limit=1&include_total=true&status=ready,queued',
      200,
    );
    expect(page.body.page.total).toBeGreaterThanOrEqual(1);
    await hit('listLabelBatches', 'GET', '/v1/labels/batches?status=nope', 400);
  });

  it('the walk covered every Labels operation of the contract', () => {
    const required = operations.filter((o) => LABELS_TAGS.has(o.tag)).map((o) => o.operationId);
    expect(required.length).toBe(6);
    expect(required.filter((id) => !walked.has(id))).toEqual([]);
  });
});
