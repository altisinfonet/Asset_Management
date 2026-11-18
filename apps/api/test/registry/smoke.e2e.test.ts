import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import {
  type App,
  type TenantFixture,
  createTenant,
  newTenancy,
  startRegistryApp,
  unique,
} from './support.js';

describe.skipIf(!dbEnabled)('registry smoke', () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  beforeAll(async () => {
    ({ app } = await startRegistryApp({ LOG_LEVEL: 'error' }));
    t = await createTenant(app, tenancy, 'smoke');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
  });

  it('walks the whole flow', async () => {
    const a = t.admin;
    const cat = await a.post('/v1/categories', { name: unique('Cat'), tag_prefix: 'SM-' });
    expect(cat.status, cat.raw).toBe(201);
    const cf = await a.post('/v1/custom-fields', {
      category_id: cat.body.id,
      key: 'ram_gb',
      label: 'RAM',
      data_type: 'number',
      validation: { min: 1 },
    });
    expect(cf.status, cf.raw).toBe(201);
    const man = await a.post('/v1/manufacturers', { name: unique('M') });
    expect(man.status, man.raw).toBe(201);
    const model = await a.post('/v1/models', {
      category_id: cat.body.id,
      manufacturer_id: man.body.id,
      name: unique('Mod'),
    });
    expect(model.status, model.raw).toBe(201);
    const asset = await a.post('/v1/assets', {
      category_id: cat.body.id,
      model_id: model.body.id,
      name: 'Smoke asset',
      serial: 'SN-1',
      custom_data: { ram_gb: '16' },
    });
    expect(asset.status, asset.raw).toBe(201);
    expect(asset.body.asset_tag).toMatch(/^SM-00001$/);
    expect(asset.body.custom_data).toEqual({ ram_gb: 16 });
    const etag = asset.headers.etag as string;
    const patched = await a.patch(
      `/v1/assets/${asset.body.id}`,
      { name: 'Renamed' },
      { headers: { 'if-match': etag } },
    );
    expect(patched.status, patched.raw).toBe(200);
    const list = await a.get(`/v1/assets?category_id=${cat.body.id}&cf[ram_gb]=16`);
    expect(list.status, list.raw).toBe(200);
    expect(list.body.data).toHaveLength(1);
    const search = await a.get('/v1/search?q=Renamed');
    expect(search.status, search.raw).toBe(200);
    expect(search.body.data[0].type).toBe('asset');
    const del = await a.del(`/v1/assets/${asset.body.id}`, undefined, {
      headers: { 'if-match': patched.headers.etag as string },
    });
    expect(del.status, del.raw).toBe(204);
  });
});
