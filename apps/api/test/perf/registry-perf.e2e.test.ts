import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assetListSql,
  assetSortTerms,
} from '../../src/registry/asset-queries.js';
import { assetListSchema } from '../../src/registry/schemas.js';
import { dbEnabled, env, withClient } from '../auth/support.js';
import {
  type App,
  type TenantFixture,
  createTenant,
  newTenancy,
  ownerTenantSql,
  startRegistryApp,
} from '../registry/support.js';

/**
 * M1-REG-07 / M1-REG-08 performance budget on the real stack: two tenants of 50,000 assets each (so
 * "a second 50,000-asset tenant is present"), measured server side through the full HTTP pipeline
 * (authentication, tenant transaction, SQL, serialisation) with `app.inject` (no network).
 *
 *   list p95 < 500 ms, global search p95 < 200 ms, exact tag / serial lookup p95 < 150 ms.
 *
 * It also captures the query plans of the hot statements and asserts they are index plans, and
 * re-checks isolation on the perf dataset. Results are printed and written to
 * `test-results/registry-perf.json` (the nightly perf job, M1-CI-05, publishes that file).
 * PERF_ASSETS overrides the per-tenant size (default 50000).
 */
const PER_TENANT = Number(process.env.PERF_ASSETS ?? 50_000);
const SAMPLES = Number(process.env.PERF_SAMPLES ?? 120);
const BUDGET = { list: 500, search: 200, lookup: 150 } as const;

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

interface Stat {
  name: string;
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}
const stats: Stat[] = [];

async function measure(name: string, n: number, call: (i: number) => Promise<void>): Promise<Stat> {
  for (let i = 0; i < 10; i++) await call(i); // warm-up: connections, plan caches
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await call(i);
    times.push(performance.now() - t0);
  }
  times.sort((x, y) => x - y);
  const stat = {
    name,
    samples: n,
    p50: Math.round(pct(times, 50) * 10) / 10,
    p95: Math.round(pct(times, 95) * 10) / 10,
    p99: Math.round(pct(times, 99) * 10) / 10,
    max: Math.round(times.at(-1)! * 10) / 10,
  };
  stats.push(stat);
  return stat;
}

describe.skipIf(!dbEnabled)(`registry performance budget (${PER_TENANT} assets x 2 tenants)`, () => {
  const tenancy = newTenancy();
  let app: App;
  let A: TenantFixture;
  let B: TenantFixture;
  const sample: { tags: string[]; serials: string[]; labels: string[]; ids: string[] } = {
    tags: [],
    serials: [],
    labels: [],
    ids: [],
  };
  let categoryIds: string[] = [];
  let osCategory = '';

  async function seedTenant(T: TenantFixture, label: string): Promise<string[]> {
    const cats: string[] = [];
    const models: string[] = [];
    const vendors: string[] = [];
    for (const [i, name] of ['Laptops', 'Desktops', 'Monitors', 'Phones', 'Tablets', 'Network', 'Printers', 'Peripherals'].entries()) {
      const c = await T.admin.post('/v1/categories', { name: `${name} ${label}`, tag_prefix: `${name.slice(0, 3).toUpperCase()}-` });
      cats.push(c.body.id);
      for (let m = 0; m < 5; m++) {
        const mf = await T.admin.post('/v1/manufacturers', { name: `Maker ${label} ${i}-${m}` });
        const model = await T.admin.post('/v1/models', { category_id: c.body.id, manufacturer_id: mf.body.id, name: `Model ${label} ${i}-${m}`, model_number: `MN-${i}${m}` });
        models.push(model.body.id);
      }
    }
    for (let v = 0; v < 12; v++) vendors.push((await T.admin.post('/v1/vendors', { name: `Vendor ${label} ${v}` })).body.id);
    const statuses = (await T.admin.get('/v1/status-labels')).body.data.map((s: { id: string }) => s.id) as string[];
    // 50,000 rows in one statement. Same tags and serials in both tenants (overlap on purpose).
    await ownerTenantSql(
      T.tenantId,
      `insert into app.asset (id, tenant_id, company_id, asset_tag, name, serial, category_id, model_id, vendor_id, status_id,
                              purchase_date, purchase_cost_minor, currency, warranty_end, order_number, notes, custom_data,
                              created_at, updated_at, archived_at)
       select gen_random_uuid(), $1::uuid, (select id from app.company where is_default),
              ($2::text[])[1 + g % 8] || lpad(g::text, 6, '0'),
              (array['ThinkPad','Latitude','MacBook','EliteBook','UltraSharp','iPhone','Catalyst','LaserJet'])[1 + g % 8] || ' device ' || g,
              'SN' || upper(substr(md5(g::text), 1, 10)),
              ($3::uuid[])[1 + g % 8], ($4::uuid[])[1 + (g % 8) * 5 + (g / 8) % 5], ($5::uuid[])[1 + g % 12], ($6::uuid[])[1 + (g * 31 % 7)],
              date '2022-01-01' + (g % 1400), 50000 + (g % 200) * 500, 'USD', date '2025-01-01' + (g % 1000),
              'PO-' || (1000 + g % 400),
              case when g % 10 = 0 then 'Imaged with the standard build; asset sticker on the lid.' else null end,
              jsonb_build_object('os', (array['macOS','Windows 11','Ubuntu'])[1 + g % 3], 'ram_gb', (array[8,16,32])[1 + g % 3], 'cost_center', 'CC-' || (g % 20)),
              now() - (g * 13 || ' seconds')::interval, now() - (g * 13 || ' seconds')::interval,
              case when g % 33 = 0 then now() else null end
         from generate_series(1, $7::int) g`,
      [
        T.tenantId,
        cats.map((_, i) => `${['LAP', 'DES', 'MON', 'PHO', 'TAB', 'NET', 'PRI', 'PER'][i]}-`),
        `{${cats.join(',')}}`,
        `{${models.join(',')}}`,
        `{${vendors.join(',')}}`,
        `{${statuses.join(',')}}`,
        PER_TENANT,
      ],
    );
    return cats;
  }

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    A = await createTenant(app, tenancy, 'perfa');
    B = await createTenant(app, tenancy, 'perfb');
    categoryIds = await seedTenant(A, 'A');
    await seedTenant(B, 'B');
    osCategory = categoryIds[0]!;
    await A.admin.post('/v1/custom-fields', { key: 'os', label: 'OS', data_type: 'text' });
    // planner statistics, as autovacuum would have
    await withClient(env.migratorUrl!, async (c) => {
      // VACUUM ANALYZE now, so autovacuum does not start in the middle of the measurements
      await c.query('vacuum (analyze) app.asset');
      await c.query('vacuum (analyze) app.asset_model');
      await c.query('vacuum (analyze) app.status_label');
    });
    const rows = await ownerTenantSql(
      A.tenantId,
      `select id, asset_tag, serial, label_code from app.asset where archived_at is null order by random() limit 300`,
    );
    for (const r of rows.rows as Array<{ id: string; asset_tag: string; serial: string; label_code: string }>) {
      sample.ids.push(r.id);
      sample.tags.push(r.asset_tag);
      sample.serials.push(r.serial);
      sample.labels.push(r.label_code);
    }
  }, 600_000);

  afterAll(async () => {
    // the perf dataset is large: leave the shared database as it was found
    if (process.env.PERF_KEEP) console.log(`PERF_KEEP: tenants ${A?.tenantId} ${B?.tenantId}`);
    else {
      for (const T of [A, B]) {
        if (T) await ownerTenantSql(T.tenantId, 'delete from app.asset').catch(() => undefined);
      }
    }
    await app?.close();
    await tenancy.onModuleDestroy();
    const dir = join(process.cwd(), 'test-results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'registry-perf.json'),
      JSON.stringify({ perTenant: PER_TENANT, budgetsMs: BUDGET, stats }, null, 2),
    );
    console.log(
      `\nregistry perf (${PER_TENANT} assets x 2 tenants, ${SAMPLES} samples each, ms):\n` +
        stats.map((s) => `  ${s.name.padEnd(44)} p50 ${String(s.p50).padStart(7)}  p95 ${String(s.p95).padStart(7)}  p99 ${String(s.p99).padStart(7)}  max ${String(s.max).padStart(7)}`).join('\n'),
    );
  });

  const get = async (url: string) => {
    const res = await A.admin.get(url);
    if (res.status !== 200) throw new Error(`${url} -> ${res.status} ${res.raw.slice(0, 300)}`);
    return res;
  };

  it('seeded two tenants of the expected size', async () => {
    for (const T of [A, B]) {
      const r = await ownerTenantSql(T.tenantId, 'select count(*)::int as n from app.asset');
      expect(r.rows[0].n).toBe(PER_TENANT);
    }
  });

  it(`list p95 < ${BUDGET.list} ms: default page, deep pages, filters, sorts, text, custom field`, async () => {
    const first = await get('/v1/assets?limit=50');
    expect(first.body.data).toHaveLength(50);
    const cursors: string[] = [first.body.page.next_cursor];
    // walk to page 20 to get a deep cursor
    let cursor = first.body.page.next_cursor as string;
    for (let i = 0; i < 19; i++) {
      cursor = (await get(`/v1/assets?limit=50&cursor=${cursor}`)).body.page.next_cursor;
    }
    cursors.push(cursor);
    const cat = categoryIds[1]!;
    const scenarios: Array<[string, () => string]> = [
      ['list default (limit 50, -created_at)', () => '/v1/assets?limit=50'],
      ['list page 20 (cursor)', () => `/v1/assets?limit=50&cursor=${cursors[1]}`],
      ['list limit 200', () => '/v1/assets?limit=200'],
      ['list status filter', () => `/v1/assets?limit=50&status_id=${'STATUS'}`],
      ['list category + state_type + sort name', () => `/v1/assets?limit=50&category_id=${cat}&state_type=deployed&sort=name`],
      ['list sort asset_tag', () => '/v1/assets?limit=50&sort=asset_tag'],
      ['list text q (name / tag / serial)', () => '/v1/assets?limit=50&q=thinkpad'],
      ['list text q (inner match, 6k hits)', () => '/v1/assets?limit=50&q=device%2012'],
      ['list custom field cf[os]=macOS', () => '/v1/assets?limit=50&cf[os]=macOS'],
      ['list archived=only', () => '/v1/assets?limit=50&archived=only'],
      ['list include_total=true', () => '/v1/assets?limit=50&include_total=true'],
      ['list warranty window', () => '/v1/assets?limit=50&warranty_end_after=2026-01-01&warranty_end_before=2026-03-01&sort=warranty_end'],
    ];
    const status = (await get('/v1/status-labels')).body.data[1].id as string;
    for (const [name, url] of scenarios) {
      const stat = await measure(name, SAMPLES, async () => {
        await get(url().replace('STATUS', status));
      });
      expect(stat.p95, name).toBeLessThan(BUDGET.list);
    }
  }, 300_000);

  it(`exact tag / serial lookup p95 < ${BUDGET.lookup} ms (scan path)`, async () => {
    const byTag = await measure('lookup ?tag= (exact)', SAMPLES, async (i) => {
      const res = await get(`/v1/assets?tag=${sample.tags[i % sample.tags.length]!.toLowerCase()}`);
      if (res.body.data.length !== 1) throw new Error('tag lookup miss');
    });
    const bySerial = await measure('lookup ?serial= (exact)', SAMPLES, async (i) => {
      const res = await get(`/v1/assets?serial=${sample.serials[i % sample.serials.length]}`);
      if (res.body.data.length < 1) throw new Error('serial lookup miss');
    });
    const scan = await measure('scan/resolve by label_code', SAMPLES, async (i) => {
      await get(`/v1/scan/resolve?code=${sample.labels[i % sample.labels.length]}`);
    });
    const scanTag = await measure('scan/resolve by tag', SAMPLES, async (i) => {
      await get(`/v1/scan/resolve?code=${sample.tags[i % sample.tags.length]}`);
    });
    for (const s of [byTag, bySerial, scan, scanTag]) expect(s.p95, s.name).toBeLessThan(BUDGET.lookup);
  }, 300_000);

  it(`global search p95 < ${BUDGET.search} ms`, async () => {
    const exact = await measure('search exact tag', SAMPLES, async (i) => {
      const res = await get(`/v1/search?q=${sample.tags[i % sample.tags.length]}`);
      if (res.body.data[0]?.id !== sample.ids[i % sample.ids.length]) throw new Error('exact tag not ranked first');
    });
    const serial = await measure('search exact serial', SAMPLES, async (i) => {
      const res = await get(`/v1/search?q=${sample.serials[i % sample.serials.length]}`);
      if (res.body.data[0]?.id !== sample.ids[i % sample.ids.length]) throw new Error('exact serial not ranked first');
    });
    const partialTag = await measure('search partial tag (LAP-0123)', SAMPLES, async () => {
      await get('/v1/search?q=LAP-0123&limit=5');
    });
    const word = await measure('search word (thinkpad)', SAMPLES, async () => {
      await get('/v1/search?q=thinkpad&limit=5');
    });
    const short = await measure('search 2 chars (la)', SAMPLES, async () => {
      await get('/v1/search?q=la&limit=5');
    });
    const typed = await measure('search model/category (maker)', SAMPLES, async () => {
      await get('/v1/search?q=maker&limit=5&types=model,category');
    });
    for (const s of [exact, serial, partialTag, word, short, typed]) {
      expect(s.p95, s.name).toBeLessThan(BUDGET.search);
    }
  }, 300_000);

  it('holds the budget under concurrency (8 clients, mixed list / lookup / search)', async () => {
    const times: number[] = [];
    const worker = async (w: number) => {
      const c = A.admin.clone();
      for (let i = 0; i < 40; i++) {
        const urls = [
          '/v1/assets?limit=50',
          `/v1/assets?tag=${sample.tags[(w * 40 + i) % sample.tags.length]}`,
          `/v1/search?q=${sample.tags[(w * 40 + i) % sample.tags.length]}`,
          `/v1/assets?limit=50&category_id=${categoryIds[i % 8]}&sort=name`,
        ];
        const url = urls[i % urls.length]!;
        const t0 = performance.now();
        const res = await c.get(url);
        times.push(performance.now() - t0);
        if (res.status !== 200) throw new Error(`${url} -> ${res.status}`);
      }
    };
    await Promise.all(Array.from({ length: 8 }, (_, w) => worker(w)));
    times.sort((x, y) => x - y);
    stats.push({
      name: 'mixed, 8 concurrent clients',
      samples: times.length,
      p50: Math.round(pct(times, 50) * 10) / 10,
      p95: Math.round(pct(times, 95) * 10) / 10,
      p99: Math.round(pct(times, 99) * 10) / 10,
      max: Math.round(times.at(-1)! * 10) / 10,
    });
    expect(pct(times, 95)).toBeLessThan(BUDGET.list);
  }, 300_000);

  it('the hot statements use index plans (query plans captured)', async () => {
    const explain = async (name: string, query: Record<string, string>, expectIndexes: RegExp[], forbid: RegExp[] = [/Seq Scan on asset /]) => {
      const q = assetListSchema.parse(query);
      const stmt = assetListSql(q, [], assetSortTerms(q.sort), undefined);
      const plan = await withClient(env.migratorUrl!, async (c) => {
        await c.query('begin');
        try {
          await c.query(`select set_config('app.tenant_id', $1, true)`, [A.tenantId]);
          const res = await c.query(`explain (costs off) ${stmt.text}`, stmt.values);
          return res.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
        } finally {
          await c.query('rollback');
        }
      });
      plans[name] = plan;
      for (const re of expectIndexes) expect(plan, `${name}\n${plan}`).toMatch(re);
      for (const re of forbid) expect(plan, `${name}\n${plan}`).not.toMatch(re);
    };
    const plans: Record<string, string> = {};
    await explain('default list', { limit: '50' }, [/asset_created_idx/]);
    await explain('tag lookup', { tag: 'LAP-000008' }, [/asset_tag_uq/]);
    await explain('serial lookup', { serial: 'SN1234567890' }, [/asset_serial_idx/]);
    // ILIKE / strpos are not leakproof: the scan is bounded to the tenant by the index, never the table
    await explain('text q', { q: 'thinkpad', limit: '50' }, [/Index Cond: \(tenant_id =/]);
    await explain('category filter', { category_id: categoryIds[0]!, sort: 'name' }, [/asset_category_idx|asset_created_idx/]);
    await explain('archived only', { archived: 'only', limit: '50' }, [/Index Scan|Bitmap/]);
    const dir = join(process.cwd(), 'test-results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'registry-plans.txt'),
      Object.entries(plans).map(([n, p]) => `== ${n}\n${p}\n`).join('\n'),
    );
    console.log(`\nquery plans (default list, tag lookup, text q):\n${plans['default list']}\n--\n${plans['tag lookup']}\n--\n${plans['text q']}`);
  }, 120_000);

  it('results never include another tenant\'s rows on the perf dataset', async () => {
    const idsOf = async (url: string) => (await get(url)).body.data.map((r: { id: string }) => r.id as string);
    const checks = [
      '/v1/assets?limit=200',
      '/v1/assets?limit=200&sort=asset_tag',
      '/v1/assets?limit=200&q=device',
      '/v1/assets?limit=200&cf[os]=macOS',
      `/v1/assets?limit=200&category_id=${categoryIds[2]}`,
      `/v1/assets?tag=${sample.tags[0]}`,
      `/v1/search?q=${sample.tags[1]}&limit=50`,
    ];
    for (const url of checks) {
      const res = await get(url);
      const ids: string[] = (res.body.data as Array<{ id: string }>).map((r) => r.id);
      expect(ids.length, url).toBeGreaterThan(0);
      const mine = await ownerTenantSql(A.tenantId, 'select count(*)::int as n from app.asset where id = any($1::uuid[])', [`{${ids.join(',')}}`]);
      const theirs = await ownerTenantSql(B.tenantId, 'select count(*)::int as n from app.asset where id = any($1::uuid[])', [`{${ids.join(',')}}`]);
      expect(mine.rows[0].n, url).toBe(ids.length);
      expect(theirs.rows[0].n, url).toBe(0);
    }
    // B's admin sees B's rows only, with the very same tags
    const b = await B.admin.get(`/v1/assets?tag=${sample.tags[0]}`);
    expect(b.body.data).toHaveLength(1);
    expect(b.body.data[0].id).not.toBe(sample.ids[0]);
    expect((await idsOf(`/v1/assets?tag=${sample.tags[0]}`))[0]).toBe(sample.ids[0]);
  }, 120_000);
});
