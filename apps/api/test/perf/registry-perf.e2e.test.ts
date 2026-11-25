import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetListSql, assetSortTerms } from '../../src/registry/asset-queries.js';
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
import { createScopedUser } from '../scoping/support.js';

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
const BUDGET = { list: 500, search: 200, lookup: 150, custody: 300 } as const;

/**
 * The real budgets are enforced only when PERF is set (the nightly perf job and the CI perf job run the
 * machine to themselves). In the ordinary e2e run several test files share one database and one
 * machine, a p95 can be several times its budget while being fine alone, so the numbers are recorded
 * (the table printed at the end, `test-results/registry-perf.json`) and only a generous sanity ceiling
 * (10 times the budget: "it still works") is asserted.
 */
const ENFORCE = !['', '0', 'false'].includes((process.env.PERF ?? '').toLowerCase());
const SANITY_FACTOR = 10;
const limit = (budget: number): number => (ENFORCE ? budget : budget * SANITY_FACTOR);

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

describe.skipIf(!dbEnabled)(
  `registry performance budget (${PER_TENANT} assets x 2 tenants)`,
  () => {
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

    async function seedTenant(T: TenantFixture, label: string): Promise<string[]> {
      const cats: string[] = [];
      const models: string[] = [];
      const vendors: string[] = [];
      for (const [i, name] of [
        'Laptops',
        'Desktops',
        'Monitors',
        'Phones',
        'Tablets',
        'Network',
        'Printers',
        'Peripherals',
      ].entries()) {
        const c = await T.admin.post('/v1/categories', {
          name: `${name} ${label}`,
          tag_prefix: `${name.slice(0, 3).toUpperCase()}-`,
        });
        cats.push(c.body.id);
        for (let m = 0; m < 5; m++) {
          const mf = await T.admin.post('/v1/manufacturers', { name: `Maker ${label} ${i}-${m}` });
          const model = await T.admin.post('/v1/models', {
            category_id: c.body.id,
            manufacturer_id: mf.body.id,
            name: `Model ${label} ${i}-${m}`,
            model_number: `MN-${i}${m}`,
          });
          models.push(model.body.id);
        }
      }
      for (let v = 0; v < 12; v++)
        vendors.push((await T.admin.post('/v1/vendors', { name: `Vendor ${label} ${v}` })).body.id);
      const statuses = (await T.admin.get('/v1/status-labels')).body.data.map(
        (s: { id: string }) => s.id,
      ) as string[];
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
      for (const r of rows.rows as Array<{
        id: string;
        asset_tag: string;
        serial: string;
        label_code: string;
      }>) {
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
          if (!T) continue;
          // custody rows reference the assets: delete children first
          for (const table of ['asset_history', 'transfer', 'assignment', 'asset']) {
            await ownerTenantSql(T.tenantId, `delete from app.${table}`).catch(() => undefined);
          }
        }
      }
      await app?.close();
      await tenancy.onModuleDestroy();
      const dir = join(process.cwd(), 'test-results');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'registry-perf.json'),
        JSON.stringify(
          { perTenant: PER_TENANT, budgetsMs: BUDGET, enforced: ENFORCE, stats },
          null,
          2,
        ),
      );
      console.log(
        `\nregistry perf (${PER_TENANT} assets x 2 tenants, ${SAMPLES} samples each, ms; ` +
          `${ENFORCE ? 'budgets ENFORCED (PERF set)' : `budgets recorded only, ${SANITY_FACTOR}x sanity ceiling (set PERF=1 to enforce)`}):\n` +
          stats
            .map(
              (s) =>
                `  ${s.name.padEnd(44)} p50 ${String(s.p50).padStart(7)}  p95 ${String(s.p95).padStart(7)}  p99 ${String(s.p99).padStart(7)}  max ${String(s.max).padStart(7)}`,
            )
            .join('\n'),
      );
    }, 300_000);

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
        [
          'list category + state_type + sort name',
          () => `/v1/assets?limit=50&category_id=${cat}&state_type=deployed&sort=name`,
        ],
        ['list sort asset_tag', () => '/v1/assets?limit=50&sort=asset_tag'],
        ['list text q (name / tag / serial)', () => '/v1/assets?limit=50&q=thinkpad'],
        ['list text q (inner match, 6k hits)', () => '/v1/assets?limit=50&q=device%2012'],
        ['list custom field cf[os]=macOS', () => '/v1/assets?limit=50&cf[os]=macOS'],
        ['list archived=only', () => '/v1/assets?limit=50&archived=only'],
        ['list include_total=true', () => '/v1/assets?limit=50&include_total=true'],
        [
          'list warranty window',
          () =>
            '/v1/assets?limit=50&warranty_end_after=2026-01-01&warranty_end_before=2026-03-01&sort=warranty_end',
        ],
      ];
      const status = (await get('/v1/status-labels')).body.data[1].id as string;
      for (const [name, url] of scenarios) {
        const stat = await measure(name, SAMPLES, async () => {
          await get(url().replace('STATUS', status));
        });
        expect(stat.p95, name).toBeLessThan(limit(BUDGET.list));
      }
    }, 300_000);

    it(`exact tag / serial lookup p95 < ${BUDGET.lookup} ms (scan path)`, async () => {
      const byTag = await measure('lookup ?tag= (exact)', SAMPLES, async (i) => {
        const res = await get(
          `/v1/assets?tag=${sample.tags[i % sample.tags.length]!.toLowerCase()}`,
        );
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
      for (const s of [byTag, bySerial, scan, scanTag])
        expect(s.p95, s.name).toBeLessThan(limit(BUDGET.lookup));
    }, 300_000);

    it(`custody p95 < ${BUDGET.custody} ms: check-out, transfer, check-in and the custody filters (M2-LIFE-02)`, async () => {
      // deployable, active assets of the 50k-row tenant: each is used once per phase
      const pool = await ownerTenantSql(
        A.tenantId,
        `select a.id from app.asset a join app.status_label s on s.tenant_id = a.tenant_id and s.id = a.status_id
          where a.archived_at is null and s.state_type = 'deployable' order by a.id limit $1`,
        [SAMPLES + 10],
      );
      const ids = pool.rows.map((r: { id: string }) => r.id);
      expect(ids.length).toBe(SAMPLES + 10);
      const person = (await A.admin.post('/v1/people', { display_name: 'Perf Person' })).body.id;
      const other = (await A.admin.post('/v1/people', { display_name: 'Perf Other' })).body.id;
      const post = async (path: string, body: unknown) => {
        const res = await A.admin.post(path, body, {
          headers: { 'idempotency-key': randomUUID() },
        });
        if (res.status >= 300) throw new Error(`${path} -> ${res.status} ${res.raw.slice(0, 300)}`);
      };
      // the first 10 calls of a phase are warm-up and are not counted
      const phase = async (name: string, call: (id: string) => Promise<void>) => {
        const times: number[] = [];
        for (const [i, id] of ids.entries()) {
          const t0 = performance.now();
          await call(id);
          if (i >= 10) times.push(performance.now() - t0);
        }
        times.sort((x, y) => x - y);
        const stat = {
          name,
          samples: times.length,
          p50: Math.round(pct(times, 50) * 10) / 10,
          p95: Math.round(pct(times, 95) * 10) / 10,
          p99: Math.round(pct(times, 99) * 10) / 10,
          max: Math.round(times.at(-1)! * 10) / 10,
        };
        stats.push(stat);
        return stat;
      };
      const out = await phase('custody check-out', (id) =>
        post(`/v1/assets/${id}/checkout`, { person_id: person }),
      );
      // planner statistics for the new table, as autovacuum would have them
      await withClient(env.migratorUrl!, (c) => c.query('vacuum (analyze) app.assignment'));
      const filters = await measure('list assigned_person_id + assigned', SAMPLES, async () => {
        const res = await get(`/v1/assets?limit=50&assigned_person_id=${person}`);
        if (res.body.data.length !== 50) throw new Error('custody filter miss');
      });
      const assigned = await measure('list assigned=true', SAMPLES, async () => {
        await get('/v1/assets?limit=50&assigned=true');
      });
      const unassigned = await measure('list assigned=false (default order)', SAMPLES, async () => {
        await get('/v1/assets?limit=50&assigned=false');
      });
      const transfer = await phase('custody transfer', (id) =>
        post(`/v1/assets/${id}/transfer`, { person_id: other }),
      );
      const back = await phase('custody check-in', (id) => post(`/v1/assets/${id}/checkin`, {}));
      const history = await measure('asset history (first page)', SAMPLES, async (i) => {
        await get(`/v1/assets/${ids[i % ids.length]}/history?limit=50`);
      });
      const personAssignments = await measure('person assignments', SAMPLES, async () => {
        await get(`/v1/people/${other}/assignments?state=all&limit=50`);
      });
      for (const s of [
        out,
        transfer,
        back,
        filters,
        assigned,
        unassigned,
        history,
        personAssignments,
      ]) {
        expect(s.p95, s.name).toBeLessThan(limit(BUDGET.custody));
      }
    }, 300_000);

    it(`global search p95 < ${BUDGET.search} ms`, async () => {
      const exact = await measure('search exact tag', SAMPLES, async (i) => {
        const res = await get(`/v1/search?q=${sample.tags[i % sample.tags.length]}`);
        if (res.body.data[0]?.id !== sample.ids[i % sample.ids.length])
          throw new Error('exact tag not ranked first');
      });
      const serial = await measure('search exact serial', SAMPLES, async (i) => {
        const res = await get(`/v1/search?q=${sample.serials[i % sample.serials.length]}`);
        if (res.body.data[0]?.id !== sample.ids[i % sample.ids.length])
          throw new Error('exact serial not ranked first');
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
        expect(s.p95, s.name).toBeLessThan(limit(BUDGET.search));
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
      expect(pct(times, 95)).toBeLessThan(limit(BUDGET.list));
    }, 300_000);

    it('the hot statements use index plans (query plans captured)', async () => {
      const explain = async (
        name: string,
        query: Record<string, string>,
        expectIndexes: RegExp[],
        forbid: RegExp[] = [/Seq Scan on asset /],
      ) => {
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
      await explain('category filter', { category_id: categoryIds[0]!, sort: 'name' }, [
        /asset_category_idx|asset_created_idx/,
      ]);
      await explain('archived only', { archived: 'only', limit: '50' }, [/Index Scan|Bitmap/]);
      const dir = join(process.cwd(), 'test-results');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'registry-plans.txt'),
        Object.entries(plans)
          .map(([n, p]) => `== ${n}\n${p}\n`)
          .join('\n'),
      );
      console.log(
        `\nquery plans (default list, tag lookup, text q):\n${plans['default list']}\n--\n${plans['tag lookup']}\n--\n${plans['text q']}`,
      );
    }, 120_000);

    it("results never include another tenant's rows on the perf dataset", async () => {
      const idsOf = async (url: string) =>
        (await get(url)).body.data.map((r: { id: string }) => r.id as string);
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
        const mine = await ownerTenantSql(
          A.tenantId,
          'select count(*)::int as n from app.asset where id = any($1::uuid[])',
          [`{${ids.join(',')}}`],
        );
        const theirs = await ownerTenantSql(
          B.tenantId,
          'select count(*)::int as n from app.asset where id = any($1::uuid[])',
          [`{${ids.join(',')}}`],
        );
        expect(mine.rows[0].n, url).toBe(ids.length);
        expect(theirs.rows[0].n, url).toBe(0);
      }
      // B's admin sees B's rows only, with the very same tags
      const b = await B.admin.get(`/v1/assets?tag=${sample.tags[0]}`);
      expect(b.body.data).toHaveLength(1);
      expect(b.body.data[0].id).not.toBe(sample.ids[0]);
      expect((await idsOf(`/v1/assets?tag=${sample.tags[0]}`))[0]).toBe(sample.ids[0]);
    }, 120_000);

    it(`sorts by location, assignee and due date p95 < ${BUDGET.list} ms with locations and open custody on the 50k tenant (M2-REG-03, ED-22)`, async () => {
      // 5 sites x 4 floors x 5 rooms = 125 locations, 40 people; 90% of the assets sit in a room, 40% are
      // checked out (3 in 4 to a person, the rest to a location), 70% of those with an expected return
      const leaves: string[] = [];
      for (let s = 0; s < 5; s++) {
        const site = (await A.admin.post('/v1/locations', { name: `Site ${s}`, kind: 'site' }))
          .body;
        for (let f = 0; f < 4; f++) {
          const floor = (
            await A.admin.post('/v1/locations', {
              name: `Floor ${f}`,
              kind: 'floor',
              parent_id: site.id,
            })
          ).body;
          for (let r = 0; r < 5; r++) {
            const room = await A.admin.post('/v1/locations', {
              name: `Room ${s}.${f}.${r}`,
              kind: 'room',
              parent_id: floor.id,
            });
            leaves.push(room.body.id);
          }
        }
      }
      const people: string[] = [];
      for (let p = 0; p < 40; p++) {
        people.push(
          (
            await A.admin.post('/v1/people', {
              display_name: `Holder ${String(p).padStart(2, '0')}`,
            })
          ).body.id,
        );
      }
      await ownerTenantSql(
        A.tenantId,
        `update app.asset a set location_id = ($1::uuid[])[1 + x.n % $2::int]
           from (select id, row_number() over (order by id)::int as n from app.asset) x
          where x.id = a.id and x.n % 10 <> 0`,
        [`{${leaves.join(',')}}`, leaves.length],
      );
      await ownerTenantSql(
        A.tenantId,
        `insert into app.assignment (id, tenant_id, asset_id, person_id, location_id, checked_out_at, expected_return)
         select gen_random_uuid(), $1::uuid, x.id,
                case when x.n % 4 <> 0 then ($2::uuid[])[1 + x.n % $4::int] end,
                case when x.n % 4 = 0 then ($3::uuid[])[1 + x.n % $5::int] end,
                now() - interval '1 day',
                case when x.n % 10 < 7 then current_date + (x.n % 400 - 30) end
           from (select id, row_number() over (order by id)::int as n from app.asset where archived_at is null) x
          where x.n % 5 < 2`,
        [
          A.tenantId,
          `{${people.join(',')}}`,
          `{${leaves.join(',')}}`,
          people.length,
          leaves.length,
        ],
      );
      await withClient(env.migratorUrl!, async (c) => {
        for (const t of ['asset', 'assignment', 'location', 'person'])
          await c.query(`vacuum (analyze) app.${t}`);
      });
      const open = await ownerTenantSql(
        A.tenantId,
        `select count(*)::int as n from app.assignment where checked_in_at is null`,
      );
      expect(open.rows[0].n).toBeGreaterThan(PER_TENANT * 0.3);

      const sorts = ['location', '-location', 'assignee', '-assignee', 'due', '-due'];
      const deep: Record<string, string> = {};
      const sortStats: Stat[] = [];
      for (const sort of sorts) {
        // a cursor from page 20 of the same sort (deep keyset page)
        let cursor = (await get(`/v1/assets?limit=50&sort=${sort}`)).body.page
          .next_cursor as string;
        for (let i = 0; i < 18; i++) {
          cursor = (await get(`/v1/assets?limit=50&sort=${sort}&cursor=${cursor}`)).body.page
            .next_cursor;
        }
        deep[sort] = cursor;
        sortStats.push(
          await measure(`list sort=${sort} (first page)`, SAMPLES, async () => {
            const res = await get(`/v1/assets?limit=50&sort=${sort}`);
            if (res.body.data.length !== 50) throw new Error('short page');
          }),
          await measure(`list sort=${sort} (page 20 cursor)`, SAMPLES, async () => {
            await get(`/v1/assets?limit=50&sort=${sort}&cursor=${deep[sort]}`);
          }),
        );
      }
      sortStats.push(
        await measure('list sort=due, limit 200', SAMPLES, async () => {
          await get('/v1/assets?limit=200&sort=due');
        }),
        await measure('list sort=-assignee + category filter', SAMPLES, async () => {
          await get(`/v1/assets?limit=50&sort=-assignee&category_id=${categoryIds[2]}`);
        }),
        await measure('list sort=location + assigned=true', SAMPLES, async () => {
          await get('/v1/assets?limit=50&sort=location&assigned=true');
        }),
      );
      for (const s of sortStats) expect(s.p95, s.name).toBeLessThan(limit(BUDGET.list));

      // correctness on the big dataset: the first pages equal the SQL order, empty values last
      const check = async (sort: string, order: string) => {
        const got = (await get(`/v1/assets?limit=200&sort=${sort}`)).body.data.map(
          (r: { id: string }) => r.id,
        );
        const want = await ownerTenantSql(
          A.tenantId,
          `select a.id from app.asset a
             left join app.assignment s on s.asset_id = a.id and s.checked_in_at is null
            where a.archived_at is null order by ${order} limit 200`,
        );
        expect(got).toEqual(want.rows.map((r: { id: string }) => r.id));
      };
      await check('due', 's.expected_return asc nulls last, a.id asc');
      await check('-due', 's.expected_return desc nulls last, a.id desc');

      const plans: string[] = [];
      for (const sort of ['location', 'assignee', 'due']) {
        const q = assetListSchema.parse({ sort, limit: '50' });
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
        plans.push(`== sort=${sort}\n${plan}\n`);
        // the narrow part of the statement is an index-only scan of an existing partial index (no heap access)
        expect(plan, `sort=${sort}\n${plan}`).toMatch(
          /Index Only Scan using asset_[a-z_]+_idx on asset/,
        );
        expect(plan, `sort=${sort}\n${plan}`).toMatch(/top-N heapsort|Sort Key/);
      }
      const dir = join(process.cwd(), 'test-results');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'registry-plans-sorts.txt'), plans.join('\n'));
    }, 600_000);

    // M2-OPS-01 / ED-26: a location-scoped user's list, search and lookups carry the scope predicate
    // (`location_id IN (<subtree>)`, plus the holder rules). Runs after the sorts test, which placed 90%
    // of A's assets in 5 sites x 4 floors x 5 rooms: one site is about 18% of the 50k tenant, one room
    // under 1%. Same budgets as for an organisation-wide user.
    it(`location-scoped list p95 < ${BUDGET.list} ms, search < ${BUDGET.search} ms, lookup < ${BUDGET.lookup} ms (ED-26)`, async () => {
      const site = (
        await ownerTenantSql(A.tenantId, `select id from app.location where name = 'Site 0'`)
      ).rows[0].id as string;
      const room = (
        await ownerTenantSql(A.tenantId, `select id from app.location where name = 'Room 0.0.0'`)
      ).rows[0].id as string;
      const scoped: Stat[] = [];
      for (const [label, locationId, pattern] of [
        ['site', site, 'Room 0.%'],
        ['room', room, 'Room 0.0.0'],
      ] as const) {
        const user = await createScopedUser(app, A, 'technician', [locationId], `perf-${label}`);
        const inScope = (
          await ownerTenantSql(
            A.tenantId,
            `select a.asset_tag, a.label_code from app.asset a join app.location l on l.id = a.location_id
              where l.name like $1 and a.archived_at is null order by random() limit 100`,
            [pattern],
          )
        ).rows as Array<{ asset_tag: string; label_code: string }>;
        expect(inScope.length).toBeGreaterThan(10);
        const sget = async (url: string) => {
          const res = await user.client.get(url);
          if (res.status !== 200)
            throw new Error(`${url} -> ${res.status} ${res.raw.slice(0, 300)}`);
          return res;
        };
        const first = await sget('/v1/assets?limit=50&include_total=true');
        const total = first.body.page?.total ?? first.body.total;
        let cursor = first.body.page.next_cursor as string;
        for (let i = 0; i < 5 && cursor; i++) {
          cursor = (await sget(`/v1/assets?limit=50&cursor=${cursor}`)).body.page.next_cursor;
        }
        const lists = [
          await measure(`scoped ${label}: list first page`, SAMPLES, async () => {
            await sget('/v1/assets?limit=50');
          }),
          await measure(`scoped ${label}: list page 6 (cursor)`, SAMPLES, async () => {
            if (cursor) await sget(`/v1/assets?limit=50&cursor=${cursor}`);
          }),
          await measure(`scoped ${label}: list text filter`, SAMPLES, async () => {
            await sget('/v1/assets?limit=50&q=thinkpad');
          }),
          await measure(`scoped ${label}: list sort=-updated_at`, SAMPLES, async () => {
            await sget('/v1/assets?limit=50&sort=-updated_at');
          }),
        ];
        const searches = [
          await measure(`scoped ${label}: search exact tag`, SAMPLES, async (i) => {
            const res = await sget(`/v1/search?q=${inScope[i % inScope.length]!.asset_tag}`);
            if (JSON.stringify(res.body).length < 10) throw new Error('search miss');
          }),
          await measure(`scoped ${label}: search word`, SAMPLES, async () => {
            await sget('/v1/search?q=thinkpad');
          }),
        ];
        const lookups = [
          await measure(`scoped ${label}: lookup ?tag=`, SAMPLES, async (i) => {
            const res = await sget(`/v1/assets?tag=${inScope[i % inScope.length]!.asset_tag}`);
            if (res.body.data.length !== 1) throw new Error('scoped tag lookup miss');
          }),
          await measure(`scoped ${label}: scan/resolve`, SAMPLES, async (i) => {
            await sget(`/v1/scan/resolve?code=${inScope[i % inScope.length]!.label_code}`);
          }),
        ];
        // the scope really applies: an out-of-scope tag is not found
        const outside = (
          await ownerTenantSql(
            A.tenantId,
            `select a.asset_tag from app.asset a join app.location l on l.id = a.location_id
              where l.name like 'Room 4.%' and a.archived_at is null limit 1`,
          )
        ).rows[0].asset_tag as string;
        expect((await sget(`/v1/assets?tag=${outside}`)).body.data).toEqual([]);
        if (typeof total === 'number') expect(total).toBeLessThan(PER_TENANT * 0.25);
        for (const s of lists) expect(s.p95, s.name).toBeLessThan(limit(BUDGET.list));
        for (const s of searches) expect(s.p95, s.name).toBeLessThan(limit(BUDGET.search));
        for (const s of lookups) expect(s.p95, s.name).toBeLessThan(limit(BUDGET.lookup));
        scoped.push(...lists, ...searches, ...lookups);
      }
      expect(scoped).toHaveLength(16);
    }, 600_000);
  },
);
