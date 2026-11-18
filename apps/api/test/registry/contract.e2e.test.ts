import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, dbEnabled, type Resp } from '../auth/support.js';
import {
  M2_OPERATIONS,
  REGISTRY_TAGS,
  UNIVERSAL_STATUSES,
  loadContract,
  loadDocument,
  loadProblemCodes,
} from '../support/contract.js';
import { contractViolations } from '../support/contract-observer.js';
import { check } from '../support/schema-check.js';
import {
  type App,
  type TenantFixture,
  createTenant,
  newTenancy,
  startRegistryApp,
  unique,
} from './support.js';

/**
 * M1-PLAT-03 contract test, live half. Calls EVERY registry operation of
 * docs/engineering/openapi.yaml once with valid input, and asserts for each answer that
 *   - the status is the documented one (and any other status the walk provokes is documented too),
 *   - the JSON body validates against the response schema of the contract,
 *   - error answers are `application/problem+json` documents with a code from `x-problem-codes`
 *     that carries the status the catalogue says.
 * The static half (paths, methods, permissions, success statuses) is src/auth/route-rules.test.ts.
 */
describe.skipIf(!dbEnabled)('registry contract (live)', () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  const { operations } = loadContract();
  const byId = new Map(operations.map((o) => [o.operationId, o]));
  const walked = new Set<string>();
  const problemCodes = loadProblemCodes();

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'contract');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  /** Performs a call and checks it against the contract operation `operationId`. */
  async function hit(
    operationId: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    expected: number,
    options: { body?: unknown; ifMatch?: string; client?: Client; headers?: Record<string, string> } = {},
  ): Promise<Resp> {
    const op = byId.get(operationId);
    expect(op, `operation ${operationId} is not in the contract`).toBeDefined();
    const headers = { ...(options.headers ?? {}), ...(options.ifMatch ? { 'if-match': options.ifMatch } : {}) };
    const res = await (options.client ?? t.admin).request(method, url, { body: options.body, headers });
    expect(res.status, `${operationId}: ${method} ${url} -> ${res.raw.slice(0, 300)}`).toBe(expected);
    expect(
      op!.statuses.includes(res.status) || UNIVERSAL_STATUSES.includes(res.status),
      `${operationId} answered ${res.status}, the contract documents ${op!.statuses.join(', ')}`,
    ).toBe(true);
    if (res.status < 400) {
      walked.add(operationId);
      const schema = op!.responseSchemas[res.status];
      if (schema) {
        expect(check({ $ref: `#/components/schemas/${schema}` }, res.body), `${operationId} response body`).toEqual([]);
      } else if (res.status !== 204) {
        expect(res.raw, `${operationId}: the contract documents no body for ${res.status}`).toBe('');
      }
    } else {
      expect(String(res.headers['content-type'])).toMatch(/^application\/problem\+json/);
      expect(check({ $ref: '#/components/schemas/Problem' }, res.body)).toEqual([]);
      expect(problemCodes[res.body.code], `unknown problem code ${res.body.code}`).toContain(res.status);
    }
    return res;
  }

  it('walks every registry operation: statuses and bodies match the contract', async () => {
    const uuid = () => crypto.randomUUID();
    const etag = (r: Resp) => String(r.headers.etag);

    // ---- categories
    const cat = await hit('createCategory', 'POST', '/v1/categories', 201, { body: { name: unique('Cat'), tag_prefix: 'CT-' } });
    await hit('listCategories', 'GET', '/v1/categories?limit=5&include_total=true', 200);
    await hit('getCategory', 'GET', `/v1/categories/${cat.body.id}`, 200);
    await hit('getCategory', 'GET', `/v1/categories/${uuid()}`, 404);
    const cat2 = await hit('updateCategory', 'PATCH', `/v1/categories/${cat.body.id}`, 200, { body: { description: 'd' }, ifMatch: etag(cat) });
    await hit('updateCategory', 'PATCH', `/v1/categories/${cat.body.id}`, 412, { body: { description: 'e' }, ifMatch: etag(cat) });
    await hit('updateCategory', 'PATCH', `/v1/categories/${cat.body.id}`, 428, { body: { description: 'e' } });
    await hit('updateCategory', 'PATCH', `/v1/categories/${cat.body.id}`, 422, { body: { name: '' }, ifMatch: etag(cat2) });
    await hit('createCategory', 'POST', '/v1/categories', 409, { body: { name: cat.body.name } });

    // ---- manufacturers, models, vendors
    const man = await hit('createManufacturer', 'POST', '/v1/manufacturers', 201, { body: { name: unique('Maker'), support_email: 'a@b.example' } });
    await hit('listManufacturers', 'GET', '/v1/manufacturers?q=Maker', 200);
    await hit('getManufacturer', 'GET', `/v1/manufacturers/${man.body.id}`, 200);
    const man2 = await hit('updateManufacturer', 'PATCH', `/v1/manufacturers/${man.body.id}`, 200, { body: { notes: 'n' }, ifMatch: etag(man) });
    const model = await hit('createAssetModel', 'POST', '/v1/models', 201, {
      body: { category_id: cat.body.id, manufacturer_id: man.body.id, name: unique('Model'), model_number: 'M1', default_depreciation_months: 36, eol_date: '2031-01-01' },
    });
    await hit('listModels', 'GET', `/v1/models?category_id=${cat.body.id}&manufacturer_id=${man.body.id}`, 200);
    await hit('getAssetModel', 'GET', `/v1/models/${model.body.id}`, 200);
    const model2 = await hit('updateAssetModel', 'PATCH', `/v1/models/${model.body.id}`, 200, { body: { notes: 'n' }, ifMatch: etag(model) });
    const vendor = await hit('createVendor', 'POST', '/v1/vendors', 201, { body: { name: unique('Vendor'), contact_email: 'v@v.example', url: 'https://v.example' } });
    await hit('listVendors', 'GET', '/v1/vendors', 200);
    await hit('getVendor', 'GET', `/v1/vendors/${vendor.body.id}`, 200);
    const vendor2 = await hit('updateVendor', 'PATCH', `/v1/vendors/${vendor.body.id}`, 200, { body: { phone: '+1 555 0100' }, ifMatch: etag(vendor) });

    // ---- status labels
    const label = await hit('createStatusLabel', 'POST', '/v1/status-labels', 201, { body: { name: unique('Quarantine'), state_type: 'undeployable', color: '#112233' } });
    await hit('listStatusLabels', 'GET', '/v1/status-labels?state_type=undeployable,deployable', 200);
    await hit('getStatusLabel', 'GET', `/v1/status-labels/${label.body.id}`, 200);
    const label2 = await hit('updateStatusLabel', 'PATCH', `/v1/status-labels/${label.body.id}`, 200, { body: { position: 3 }, ifMatch: etag(label) });

    // ---- custom fields
    const field = await hit('createCustomFieldDef', 'POST', '/v1/custom-fields', 201, {
      body: { category_id: cat.body.id, key: 'ram_gb', label: 'RAM', data_type: 'number', validation: { min: 1 } },
    });
    const select = await hit('createCustomFieldDef', 'POST', '/v1/custom-fields', 201, {
      body: { category_id: cat.body.id, key: 'os', label: 'OS', data_type: 'select', options: [{ value: 'macOS', label: 'macOS' }, { value: 'Linux' }] },
    });
    await hit('listCustomFields', 'GET', `/v1/custom-fields?category_id=${cat.body.id}`, 200);
    await hit('getCustomFieldDef', 'GET', `/v1/custom-fields/${field.body.id}`, 200);
    const field2 = await hit('updateCustomFieldDef', 'PATCH', `/v1/custom-fields/${field.body.id}`, 200, { body: { label: 'RAM (GB)' }, ifMatch: etag(field) });
    await hit('createCustomFieldDef', 'POST', '/v1/custom-fields', 422, { body: { category_id: cat.body.id, key: 'bad', label: 'x', data_type: 'select' } });

    // ---- asset tag template
    const tpl = await hit('getAssetTagTemplate', 'GET', '/v1/settings/asset-tag-template', 200);
    await hit('putAssetTagTemplate', 'PUT', '/v1/settings/asset-tag-template', 200, { body: { prefix: '', width: 5, use_category_prefix: true }, ifMatch: etag(tpl) });
    await hit('putAssetTagTemplate', 'PUT', '/v1/settings/asset-tag-template', 412, { body: { prefix: '', width: 5, use_category_prefix: true }, ifMatch: etag(tpl) });

    // ---- assets
    const key = unique('idem-contract');
    const asset = await hit('createAsset', 'POST', '/v1/assets', 201, {
      body: { category_id: cat.body.id, model_id: model.body.id, vendor_id: vendor.body.id, name: 'Contract asset', serial: 'CT-1', purchase_cost: { amount_minor: 1999, currency: 'USD' }, purchase_date: '2025-01-02', warranty_end: '2028-01-02', custom_data: { ram_gb: 16, os: 'macOS' } },
      headers: { 'idempotency-key': key },
    });
    const replay = await hit('createAsset', 'POST', '/v1/assets', 201, { body: { category_id: cat.body.id, model_id: model.body.id, vendor_id: vendor.body.id, name: 'Contract asset', serial: 'CT-1', purchase_cost: { amount_minor: 1999, currency: 'USD' }, purchase_date: '2025-01-02', warranty_end: '2028-01-02', custom_data: { ram_gb: 16, os: 'macOS' } }, headers: { 'idempotency-key': key } });
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(asset.body.id);
    await hit('createAsset', 'POST', '/v1/assets', 409, { body: { category_id: cat.body.id, asset_tag: asset.body.asset_tag } });
    await hit('createAsset', 'POST', '/v1/assets', 422, { body: { category_id: cat.body.id, custom_data: { os: 'BeOS' } } });
    await hit('listAssets', 'GET', `/v1/assets?category_id=${cat.body.id}&cf[os]=macOS&include_total=true&expand=model,category,vendor&sort=-updated_at`, 200);
    await hit('listAssets', 'GET', `/v1/assets?tag=${asset.body.asset_tag}`, 200);
    await hit('listAssets', 'GET', '/v1/assets?cursor=nope', 400);
    await hit('getAsset', 'GET', `/v1/assets/${asset.body.id}?expand=model`, 200);
    await hit('getAsset', 'GET', `/v1/assets/${uuid()}`, 404);
    const asset2 = await hit('updateAsset', 'PATCH', `/v1/assets/${asset.body.id}`, 200, { body: { name: 'Renamed', custom_data: { ram_gb: 32 } }, ifMatch: etag(asset) });
    await hit('updateAsset', 'PATCH', `/v1/assets/${asset.body.id}`, 412, { body: { name: 'x' }, ifMatch: etag(asset) });
    await hit('updateAsset', 'PATCH', `/v1/assets/${asset.body.id}`, 428, { body: { name: 'x' } });
    await hit('updateAsset', 'PATCH', `/v1/assets/${asset.body.id}`, 422, { body: { status_id: uuid() }, ifMatch: etag(asset2) });
    await hit('updateAsset', 'PATCH', `/v1/assets/${uuid()}`, 404, { body: { name: 'x' }, ifMatch: '*' });
    await hit('resolveScan', 'GET', `/v1/scan/resolve?code=${asset.body.label_code}`, 200);
    await hit('resolveScan', 'GET', '/v1/scan/resolve?code=nope', 404);
    await hit('search', 'GET', '/v1/search?q=Renamed&types=asset,model,category&limit=3', 200);
    await hit('search', 'GET', '/v1/search?q=', 400);

    const clone = await hit('cloneAsset', 'POST', `/v1/assets/${asset.body.id}/clone`, 201, { body: { count: 2 } });
    await hit('cloneAsset', 'POST', `/v1/assets/${uuid()}/clone`, 404, { body: {} });
    const ids = clone.body.data.map((a: { id: string }) => a.id) as string[];
    await hit('bulkUpdateAssets', 'POST', '/v1/assets/bulk-update', 200, { body: { ids: [...ids, uuid()], changes: { custom_data: { ram_gb: 8 } } } });
    await hit('bulkUpdateAssets', 'POST', '/v1/assets/bulk-update', 422, { body: { ids, changes: {} } });
    await hit('bulkArchiveAssets', 'POST', '/v1/assets/bulk-archive', 200, { body: { ids } });
    await hit('bulkRestoreAssets', 'POST', '/v1/assets/bulk-restore', 200, { body: { ids } });
    await hit('bulkArchiveAssets', 'POST', '/v1/assets/bulk-archive', 422, { body: { ids: [] } });

    const gone = await hit('archiveAsset', 'DELETE', `/v1/assets/${asset.body.id}`, 204, { ifMatch: etag(asset2) });
    expect(gone.raw).toBe('');
    await hit('archiveAsset', 'DELETE', `/v1/assets/${asset.body.id}`, 409, { ifMatch: '*' });
    await hit('archiveAsset', 'DELETE', `/v1/assets/${uuid()}`, 404, { ifMatch: '*' });
    await hit('archiveAsset', 'DELETE', `/v1/assets/${asset.body.id}`, 428);
    const archived = (await t.admin.get(`/v1/assets/${asset.body.id}`)).headers.etag as string;
    await hit('restoreAsset', 'POST', `/v1/assets/${asset.body.id}/restore`, 200, { ifMatch: archived });
    await hit('restoreAsset', 'POST', `/v1/assets/${asset.body.id}/restore`, 409, { ifMatch: '*' });

    // ---- deletes of the catalogue (the asset keeps category, model, vendor and label in use)
    await hit('archiveCategory', 'DELETE', `/v1/categories/${cat.body.id}`, 409, { ifMatch: '*' });
    await hit('archiveAssetModel', 'DELETE', `/v1/models/${model.body.id}`, 409, { ifMatch: etag(model2) });
    await hit('archiveVendor', 'DELETE', `/v1/vendors/${vendor.body.id}`, 409, { ifMatch: etag(vendor2) });
    await hit('archiveManufacturer', 'DELETE', `/v1/manufacturers/${man.body.id}`, 409, { ifMatch: etag(man2) });
    await hit('archiveCustomFieldDef', 'DELETE', `/v1/custom-fields/${select.body.id}`, 204, { ifMatch: etag(select) });
    await hit('archiveCustomFieldDef', 'DELETE', `/v1/custom-fields/${field.body.id}`, 204, { ifMatch: etag(field2) });
    await hit('archiveStatusLabel', 'DELETE', `/v1/status-labels/${label.body.id}`, 204, { ifMatch: etag(label2) });
    const free = await hit('createVendor', 'POST', '/v1/vendors', 201, { body: { name: unique('Free') } });
    await hit('archiveVendor', 'DELETE', `/v1/vendors/${free.body.id}`, 204, { ifMatch: etag(free) });
    const freeMan = await hit('createManufacturer', 'POST', '/v1/manufacturers', 201, { body: { name: unique('FreeMaker') } });
    await hit('archiveManufacturer', 'DELETE', `/v1/manufacturers/${freeMan.body.id}`, 204, { ifMatch: etag(freeMan) });
    const freeModel = await hit('createAssetModel', 'POST', '/v1/models', 201, { body: { category_id: cat.body.id, name: unique('FreeModel') } });
    await hit('archiveAssetModel', 'DELETE', `/v1/models/${freeModel.body.id}`, 204, { ifMatch: etag(freeModel) });
    const freeCat = await hit('createCategory', 'POST', '/v1/categories', 201, { body: { name: unique('FreeCat') } });
    await hit('archiveCategory', 'DELETE', `/v1/categories/${freeCat.body.id}`, 204, { ifMatch: etag(freeCat) });
  });

  it('the walk covered every registry operation of the contract', () => {
    const required = operations
      .filter((o) => REGISTRY_TAGS.has(o.tag) && !M2_OPERATIONS.has(o.operationId))
      .map((o) => o.operationId);
    expect(required.length).toBeGreaterThanOrEqual(40);
    expect(required.filter((id) => !walked.has(id))).toEqual([]);
  });

  it('GET /v1/openapi.json serves the contract: public, cacheable, equal to docs/engineering/openapi.yaml', async () => {
    const anon = new Client(app);
    const res = await anon.get('/v1/openapi.json', { cookie: false });
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/^application\/json/);
    expect(res.body).toEqual(JSON.parse(JSON.stringify(loadDocument())));
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toContain('/v1/assets/{id}/clone');
    const etag = String(res.headers.etag);
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const cached = await anon.get('/v1/openapi.json', { cookie: false, headers: { 'if-none-match': etag } });
    expect(cached.status).toBe(304);
    expect(cached.raw).toBe('');
  });

  it('the documented permission of each operation is enforced: an API key without it gets 403', async () => {
    // a key with ONLY search:read cannot call anything else of the registry
    const key = await t.admin.post('/v1/api-keys', { name: 'only-search', scopes: ['search:read'] });
    const c = new Client(app);
    const bearer = { headers: { authorization: `Bearer ${key.body.secret}` }, cookie: false } as const;
    expect((await c.get('/v1/search?q=x', bearer)).status).toBe(200);
    for (const [method, url] of [
      ['GET', '/v1/assets'],
      ['GET', '/v1/categories'],
      ['GET', '/v1/scan/resolve?code=x'],
      ['GET', '/v1/settings/asset-tag-template'],
    ] as const) {
      expect((await c.request(method, url, bearer)).status, `${method} ${url}`).toBe(403);
    }
  });
});
