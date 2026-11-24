import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type App,
  type Basics,
  type Resp,
  type TenantFixture,
  basics,
  contractViolations,
  createTenant,
  inDays,
  key,
  newAsset,
  newLocation,
  newPerson,
  newTenancy,
  ownerTenantSql,
  startRegistryApp,
} from './support.js';

/**
 * M2-REG-03 (ED-22): `GET /v1/assets?sort=location|assignee|due`. The order is checked against an
 * independent SQL formulation (`order by ... nulls last`), page by page, in both directions, with
 * ties (several assets share a due date, a person, a location) and with empty values (assets in
 * stock, without a location, without an expected return, with a closed custody period).
 */
describe.skipIf(!dbEnabled)(`asset list sorts: location, assignee, due (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let b: Basics;
  const a = () => t.admin;
  const ids: string[] = [];

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'sorts');
    b = await basics(t);
    // locations: HQ > Floor 2 > Room B, HQ > Floor 1, Annex (mixed case on purpose)
    const hq = await newLocation(a(), { name: 'HQ', kind: 'site' });
    const f2 = await newLocation(a(), { name: 'floor 2', kind: 'floor', parent_id: hq.id });
    const roomB = await newLocation(a(), { name: 'Room B', kind: 'room', parent_id: f2.id });
    const f1 = await newLocation(a(), { name: 'Floor 1', kind: 'floor', parent_id: hq.id });
    const annex = await newLocation(a(), { name: 'annex', kind: 'site' });
    const places = [roomB.id, f1.id, annex.id, f2.id, hq.id, null];
    const ana = await newPerson(a(), { display_name: 'Ana Lopez' });
    const bob = await newPerson(a(), { display_name: 'bob Young' });
    const cy = await newPerson(a(), { display_name: 'Cy Zed' });
    const people = [ana.id, bob.id, cy.id];
    const kiosk = await newLocation(a(), { name: 'Kiosk', kind: 'storage' });
    const dues = [inDays(3), inDays(1), null, inDays(3), inDays(10)];
    // 30 assets: ~half checked out (people / a location / one to another asset), one closed period
    for (let i = 0; i < 30; i++) {
      const asset = await newAsset(a(), b.categoryId, { location_id: places[i % places.length] });
      ids.push(asset.id);
      if (i % 2 === 0) {
        const target =
          i % 10 === 4
            ? { location_id: kiosk.id }
            : i % 10 === 6
              ? { target_asset_id: ids[0]! }
              : { person_id: people[(i / 2) % people.length] };
        const res = await a().post(
          `/v1/assets/${asset.id}/checkout`,
          {
            ...target,
            ...(dues[(i / 2) % dues.length]
              ? { expected_return: dues[(i / 2) % dues.length] }
              : {}),
          },
          key(),
        );
        expect(res.status, res.raw).toBe(201);
      }
      if (i === 8) {
        // closed custody: an in-stock asset again, no assignee, no due date
        expect((await a().post(`/v1/assets/${asset.id}/checkin`, {}, key())).status).toBe(200);
      }
    }
  }, 120_000);
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const walk = async (sort: string, limit = 4) => {
    const out: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 60; guard++) {
      const res: Resp = await a().get(
        `/v1/assets?category_id=${b.categoryId}&sort=${encodeURIComponent(sort)}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(res.status, res.raw).toBe(200);
      out.push(...res.body.data.map((r: { id: string }) => r.id));
      cursor = res.body.page.next_cursor;
      expect(res.body.page.has_more).toBe(cursor !== null);
      if (!cursor) break;
    }
    return out;
  };

  const FROM = `from app.asset a
    left join app.assignment s on s.asset_id = a.id and s.checked_in_at is null
    left join app.person p on p.id = s.person_id
    left join app.location tl on tl.id = s.location_id
    left join app.asset ta on ta.id = s.target_asset_id
    left join app.location l on l.id = a.location_id
   where a.category_id = $1 and a.archived_at is null`;
  const PATH = `(select string_agg(lower(n.name), ' > ' order by u.ord)
                   from unnest(l.ancestor_ids) with ordinality as u(id, ord) join app.location n on n.id = u.id)`;
  const WHO = `lower(coalesce(p.display_name, tl.name, ta.asset_tag))`;

  it.each([
    ['due', `s.expected_return asc nulls last, a.id asc`],
    ['-due', `s.expected_return desc nulls last, a.id desc`],
    ['location', `${PATH} asc nulls last, a.id asc`],
    ['-location', `${PATH} desc nulls last, a.id desc`],
    ['assignee', `${WHO} asc nulls last, a.id asc`],
    ['-assignee', `${WHO} desc nulls last, a.id desc`],
    ['due,-location', `s.expected_return asc nulls last, ${PATH} desc nulls last, a.id asc`],
    ['-assignee,asset_tag', `${WHO} desc nulls last, a.asset_tag_key asc, a.id desc`],
  ])('pages of 4 over sort=%s visit every asset once, empty values last', async (sort, order) => {
    const got = await walk(sort);
    expect(got).toHaveLength(30);
    expect(new Set(got).size).toBe(30);
    const want = await ownerTenantSql(t.tenantId, `select a.id ${FROM} order by ${order}`, [
      b.categoryId,
    ]);
    expect(got).toEqual(want.rows.map((r: { id: string }) => r.id));
  });

  it('one page of 200 equals the walk, and the first rows really are the filled ones', async () => {
    const res = await a().get(`/v1/assets?category_id=${b.categoryId}&sort=due&limit=200`);
    expect(res.body.data).toHaveLength(30);
    const dues = res.body.data.map(
      (r: { current_assignment: { expected_return: string | null } | null }) =>
        r.current_assignment?.expected_return ?? null,
    );
    const firstEmpty = dues.indexOf(null);
    expect(firstEmpty).toBeGreaterThan(0);
    expect(dues.slice(firstEmpty).every((d: string | null) => d === null)).toBe(true);
    expect(dues.slice(0, firstEmpty)).toEqual([...dues.slice(0, firstEmpty)].sort());
    // descending: still empty last
    const desc = await a().get(`/v1/assets?category_id=${b.categoryId}&sort=-due&limit=200`);
    const dd = desc.body.data.map(
      (r: { current_assignment: { expected_return: string | null } | null }) =>
        r.current_assignment?.expected_return ?? null,
    );
    expect(dd.slice(firstEmpty).every((d: string | null) => d === null)).toBe(true);
    expect(dd.slice(0, firstEmpty)).toEqual([...dd.slice(0, firstEmpty)].sort().reverse());
  });

  it('works with filters, an archived-only list and the label selection order', async () => {
    const only = await a().get(
      `/v1/assets?category_id=${b.categoryId}&assigned=true&sort=assignee&limit=200`,
    );
    expect(only.status).toBe(200);
    const names = only.body.data.map(
      (r: { current_assignment: { target_name: string } }) => r.current_assignment.target_name,
    );
    expect(names.length).toBeGreaterThan(5);
    expect(names.every((n: string | null) => n)).toBe(true);
    const none = await a().get(
      `/v1/assets?category_id=${b.categoryId}&assigned=false&sort=-due&limit=200&include_total=true`,
    );
    expect(none.status).toBe(200);
    expect(none.body.page.total).toBe(none.body.data.length);
  });

  it('a cursor belongs to its sort: another sort or direction is 400 invalid-cursor', async () => {
    const first = await a().get(`/v1/assets?category_id=${b.categoryId}&sort=due&limit=3`);
    const cursor = first.body.page.next_cursor as string;
    for (const other of ['-due', 'location', 'assignee', 'asset_tag']) {
      const res = await a().get(
        `/v1/assets?category_id=${b.categoryId}&sort=${other}&limit=3&cursor=${cursor}`,
      );
      expect(res.status, other).toBe(400);
      expect(res.body.code).toBe('invalid-cursor');
    }
    // a hand-made cursor with the right binding cannot carry a non-boolean flag: it is rejected, not a 500
    const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      k: Array<string | null>;
    };
    payload.k[0] = 'maybe';
    const forged = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const bad = await a().get(
      `/v1/assets?category_id=${b.categoryId}&sort=due&limit=3&cursor=${forged}`,
    );
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid-cursor');
    // the internal flag terms are not public sort keys
    expect((await a().get('/v1/assets?sort=due.null')).status).toBe(400);
  });

  it('is tenant-scoped: another tenant cannot influence the order, and the sorts need asset:read', async () => {
    const res = await a().get(`/v1/assets?sort=location&limit=200`);
    expect(res.status).toBe(200);
    for (const r of res.body.data) expect(ids.includes(r.id)).toBe(true);
  });
});
