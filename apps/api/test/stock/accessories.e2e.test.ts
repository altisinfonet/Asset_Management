import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type App,
  type TenantFixture,
  auditRows,
  contractViolations,
  createTenant,
  createUser,
  ifMatch,
  inDays,
  keyed,
  newAccessory,
  newCategory,
  newLocation,
  newPerson,
  newTenancy,
  outboxRows,
  ownerTenantSql,
  startRegistryApp,
  unique,
} from './support.js';

/**
 * M2-ACC-01 accessories (ED-11): quantity-tracked stock handed out through assignments. Covers the
 * acceptance criteria (over-checkout refused with 409, concurrent check-outs never exceed the stock,
 * audit and events, list shows total / checked out / available) plus partial returns, the target
 * rules, the low-stock latch (once per crossing, re-armed on restock), ETags and offboarding.
 */
describe.skipIf(!dbEnabled)(`accessories (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'acc1');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const checkout = (id: string, body: Record<string, unknown>, k = keyed()) =>
    a().post(`/v1/accessories/${id}/checkout`, body, k);
  const checkin = (id: string, body: Record<string, unknown>) =>
    a().post(`/v1/accessories/${id}/checkin`, body, keyed());

  describe('catalogue', () => {
    it('creates an accessory with computed availability and a label code; the category must be an accessory category', async () => {
      const cat = await newCategory(a(), 'accessory');
      const res = await a().post('/v1/accessories', {
        category_id: cat.id,
        name: unique('USB-C charger'),
        qty_total: 12,
        min_qty: 3,
        model_number: 'PD-65',
        purchase_date: '2026-01-15',
        purchase_cost: { amount_minor: 2599, currency: 'EUR' },
        notes: 'spare stock',
      });
      expect(res.status, res.raw).toBe(201);
      expect(res.headers.etag).toBeTruthy();
      expect(res.headers.location).toBe(`/v1/accessories/${res.body.id}`);
      expect(res.body).toMatchObject({
        qty_total: 12,
        qty_checked_out: 0,
        qty_available: 12,
        min_qty: 3,
        low_stock: false,
        archived_at: null,
        purchase_date: '2026-01-15',
        purchase_cost: { amount_minor: 2599, currency: 'EUR' },
      });
      expect(res.body.label_code).toMatch(/^[0-9a-f]{32}$/);

      // wrong kind, unknown category, bad bodies
      const assetCat = (await a().post('/v1/categories', { name: unique('AssetCat') })).body;
      const wrongKind = await a().post('/v1/accessories', {
        category_id: assetCat.id,
        name: 'x',
        qty_total: 1,
      });
      expect(wrongKind.status).toBe(422);
      expect(wrongKind.body.errors[0]).toMatchObject({
        pointer: '/category_id',
        code: 'wrong-kind',
      });
      expect(
        (await a().post('/v1/accessories', { category_id: randomUUID(), name: 'x', qty_total: 1 }))
          .status,
      ).toBe(422);
      expect((await a().post('/v1/accessories', { category_id: cat.id, name: 'x' })).status).toBe(
        422,
      );
      expect(
        (await a().post('/v1/accessories', { category_id: cat.id, name: 'x', qty_total: -1 }))
          .status,
      ).toBe(422);
      expect(
        (
          await a().post('/v1/accessories', {
            category_id: cat.id,
            name: 'x',
            qty_total: 1,
            qty_available: 1,
          })
        ).status,
      ).toBe(422);
      // a cost needs its currency (the database CHECK is mirrored by the money object)
      expect(
        (
          await a().post('/v1/accessories', {
            category_id: cat.id,
            name: 'x',
            qty_total: 1,
            purchase_cost: { amount_minor: 5 },
          })
        ).status,
      ).toBe(422);
    });

    it('lists with total / checked out / available, filters, search, sort and cursor pages', async () => {
      const cat = await newCategory(a(), 'accessory');
      const room = await newLocation(a());
      const person = await newPerson(a());
      const names = ['Alpha', 'Bravo', 'Charlie'].map((n) => unique(n));
      const [x, y, z] = [
        await newAccessory(a(), { category_id: cat.id, name: names[0], qty_total: 5 }),
        await newAccessory(a(), {
          category_id: cat.id,
          name: names[1],
          qty_total: 4,
          min_qty: 2,
          location_id: room.id,
        }),
        await newAccessory(a(), { category_id: cat.id, name: names[2], qty_total: 9 }),
      ];
      expect((await checkout(x.id, { person_id: person.id, quantity: 2 })).status).toBe(201);
      expect((await checkout(y.id, { person_id: person.id, quantity: 3 })).status).toBe(201);

      const list = await a().get(`/v1/accessories?category_id=${cat.id}&include_total=true`);
      expect(list.status).toBe(200);
      expect(list.body.page.total).toBe(3);
      const byName = Object.fromEntries(
        list.body.data.map((r: { name: string }) => [r.name, r]),
      ) as Record<string, { qty_total: number; qty_checked_out: number; qty_available: number }>;
      expect(byName[names[0]!]).toMatchObject({
        qty_total: 5,
        qty_checked_out: 2,
        qty_available: 3,
      });
      expect(byName[names[1]!]).toMatchObject({
        qty_total: 4,
        qty_checked_out: 3,
        qty_available: 1,
      });
      expect(byName[names[2]!]).toMatchObject({
        qty_total: 9,
        qty_checked_out: 0,
        qty_available: 9,
      });

      // low stock: Bravo has 1 available <= min 2
      const low = await a().get(`/v1/accessories?category_id=${cat.id}&low_stock=true`);
      expect(low.body.data.map((r: { id: string }) => r.id)).toEqual([y.id]);
      expect(low.body.data[0].low_stock).toBe(true);
      const notLow = await a().get(`/v1/accessories?category_id=${cat.id}&low_stock=false`);
      expect(notLow.body.data.map((r: { id: string }) => r.id).sort()).toEqual([x.id, z.id].sort());
      expect(
        (await a().get(`/v1/accessories?location_id=${room.id}`)).body.data.map(
          (r: { id: string }) => r.id,
        ),
      ).toEqual([y.id]);
      expect(
        (await a().get(`/v1/accessories?q=${names[2]!.toLowerCase().slice(0, 12)}`)).body.data,
      ).toHaveLength(1);

      // sort + cursor
      const first = await a().get(`/v1/accessories?category_id=${cat.id}&sort=-qty_total&limit=2`);
      expect(first.body.data.map((r: { id: string }) => r.id)).toEqual([z.id, x.id]);
      expect(first.body.page.has_more).toBe(true);
      const second = await a().get(
        `/v1/accessories?category_id=${cat.id}&sort=-qty_total&limit=2&cursor=${first.body.page.next_cursor}`,
      );
      expect(second.body.data.map((r: { id: string }) => r.id)).toEqual([y.id]);
      expect((await a().get(`/v1/accessories?category_id=${cat.id}&sort=bogus`)).status).toBe(400);
    });

    it('updates with If-Match, refuses a total below what is out, and archives only when nothing is out', async () => {
      const acc = await newAccessory(a(), { qty_total: 5 });
      const person = await newPerson(a());
      expect((await checkout(acc.id, { person_id: person.id, quantity: 4 })).status).toBe(201);

      const noMatch = await a().patch(`/v1/accessories/${acc.id}`, { name: 'x' });
      expect(noMatch.status).toBe(428);
      // the check-out does not move the ETag of the accessory itself (nothing editable changed)
      const renamed = await a().patch(
        `/v1/accessories/${acc.id}`,
        { name: unique('Renamed'), min_qty: 1 },
        ifMatch(acc.etag),
      );
      expect(renamed.status, renamed.raw).toBe(200);
      expect(renamed.body).toMatchObject({ qty_checked_out: 4, qty_available: 1, min_qty: 1 });
      expect(renamed.headers.etag).not.toBe(acc.etag);
      const stale = await a().patch(`/v1/accessories/${acc.id}`, { notes: 'x' }, ifMatch(acc.etag));
      expect(stale.status).toBe(412);

      // 4 are out: the total cannot go below 4
      const tooLow = await a().patch(
        `/v1/accessories/${acc.id}`,
        { qty_total: 3 },
        ifMatch(renamed.headers.etag),
      );
      expect(tooLow.status, tooLow.raw).toBe(409);
      expect(tooLow.body.code).toBe('insufficient-stock');
      const ok = await a().patch(
        `/v1/accessories/${acc.id}`,
        { qty_total: 4 },
        ifMatch(renamed.headers.etag),
      );
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ qty_total: 4, qty_available: 0 });

      // cannot archive while units are out
      const blocked = await a().del(
        `/v1/accessories/${acc.id}`,
        undefined,
        ifMatch(ok.headers.etag),
      );
      expect(blocked.status).toBe(409);
      expect(blocked.body.usage).toEqual({ open_assignments: 1 });
      const open = (await a().get(`/v1/accessories/${acc.id}/assignments`)).body.data[0];
      expect((await checkin(acc.id, { assignment_id: open.id })).status).toBe(200);
      const current = await a().get(`/v1/accessories/${acc.id}`);
      const archived = await a().del(
        `/v1/accessories/${acc.id}`,
        undefined,
        ifMatch(current.headers.etag),
      );
      expect(archived.status).toBe(204);
      expect((await a().get(`/v1/accessories?archived=only&q=${acc.body.name}`)).status).toBe(200);
      // an archived accessory takes no check-outs
      const late = await checkout(acc.id, { person_id: person.id });
      expect(late.status).toBe(409);
      expect((await a().get(`/v1/accessories/${randomUUID()}`)).status).toBe(404);
    });
  });

  describe('check-out and check-in (ED-11)', () => {
    it('checks out N units to a person, a location and an asset; shows who holds how many', async () => {
      const acc = await newAccessory(a(), { qty_total: 20 });
      const person = await newPerson(a());
      const room = await newLocation(a());
      const cat = (await a().post('/v1/categories', { name: unique('AssetCat') })).body;
      const asset = (await a().post('/v1/assets', { category_id: cat.id, name: 'Laptop' })).body;

      const toPerson = await checkout(acc.id, {
        person_id: person.id,
        quantity: 3,
        expected_return: inDays(14),
        note: 'new starter',
      });
      expect(toPerson.status, toPerson.raw).toBe(201);
      expect(toPerson.headers.location).toBe(`/v1/accessories/${acc.id}/assignments`);
      expect(toPerson.body).toMatchObject({
        accessory_id: acc.id,
        asset_id: null,
        person_id: person.id,
        quantity: 3,
        quantity_returned: 0,
        checked_in_at: null,
        expected_return: inDays(14),
        note: 'new starter',
        accessory_name: acc.body.name,
        overdue: false,
      });
      const toRoom = await checkout(acc.id, { location_id: room.id, quantity: 2 });
      expect(toRoom.status).toBe(201);
      const toAsset = await checkout(acc.id, { target_asset_id: asset.id });
      expect(toAsset.status).toBe(201);
      expect(toAsset.body.quantity).toBe(1);

      const got = await a().get(`/v1/accessories/${acc.id}`);
      expect(got.body).toMatchObject({ qty_checked_out: 6, qty_available: 14 });

      const holders = await a().get(`/v1/accessories/${acc.id}/assignments`);
      expect(holders.body.data).toHaveLength(3);
      const names = Object.fromEntries(
        holders.body.data.map((r: { id: string; target_name: string }) => [r.id, r.target_name]),
      );
      expect(names[toPerson.body.id]).toBe(person.body.display_name);
      expect(names[toRoom.body.id]).toBe(room.body.name);
      expect(names[toAsset.body.id]).toContain('Laptop');

      // the person's own list holds the accessory assignment (offboarding checklist)
      const mine = await a().get(`/v1/people/${person.id}/assignments`);
      expect(mine.body.data).toHaveLength(1);
      expect(mine.body.data[0]).toMatchObject({
        id: toPerson.body.id,
        accessory_id: acc.id,
        accessory_name: acc.body.name,
        quantity: 3,
      });
      // and so does the deactivation guard
      const inactive = await a().patch(
        `/v1/people/${person.id}`,
        { status: 'inactive' },
        ifMatch('*'),
      );
      expect(inactive.status).toBe(409);
      expect(inactive.body.usage).toEqual({ open_assignments: 1 });
    });

    it('refuses over-checkout with 409 insufficient-stock and bad targets with 422', async () => {
      const acc = await newAccessory(a(), { qty_total: 3 });
      const person = await newPerson(a());
      expect((await checkout(acc.id, { person_id: person.id, quantity: 2 })).status).toBe(201);
      const over = await checkout(acc.id, { person_id: person.id, quantity: 2 });
      expect(over.status).toBe(409);
      expect(over.body.code).toBe('insufficient-stock');
      expect(over.body.available).toBe(1);
      // nothing was written for the refused request
      expect((await a().get(`/v1/accessories/${acc.id}`)).body.qty_checked_out).toBe(2);
      expect((await checkout(acc.id, { person_id: person.id, quantity: 1 })).status).toBe(201);
      expect((await checkout(acc.id, { person_id: person.id, quantity: 1 })).status).toBe(409);

      const other = await newAccessory(a(), { qty_total: 3 });
      const bad = async (body: Record<string, unknown>) => (await checkout(other.id, body)).status;
      expect(await bad({})).toBe(422);
      expect(await bad({ person_id: person.id, location_id: randomUUID() })).toBe(422);
      expect(await bad({ person_id: randomUUID() })).toBe(422);
      expect(await bad({ location_id: randomUUID() })).toBe(422);
      expect(await bad({ target_asset_id: randomUUID() })).toBe(422);
      expect(await bad({ person_id: person.id, quantity: 0 })).toBe(422);
      expect(await bad({ person_id: person.id, expected_return: '2001-01-01' })).toBe(422);
      expect((await checkout(randomUUID(), { person_id: person.id })).status).toBe(404);
      const inactive = await newPerson(a(), { status: 'inactive' });
      const res = await checkout(other.id, { person_id: inactive.id });
      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('inactive');
      // a custody action needs an Idempotency-Key
      expect(
        (await a().post(`/v1/accessories/${other.id}/checkout`, { person_id: person.id })).status,
      ).toBe(400);
    });

    it('partial returns raise quantity_returned on the same row; the last units close it; freed units are available again', async () => {
      const acc = await newAccessory(a(), { qty_total: 5 });
      const person = await newPerson(a());
      const out = await checkout(acc.id, { person_id: person.id, quantity: 5 });
      expect(out.status).toBe(201);
      expect((await checkout(acc.id, { person_id: person.id })).status).toBe(409);

      const first = await checkin(acc.id, {
        assignment_id: out.body.id,
        quantity: 2,
        note: 'two back',
      });
      expect(first.status, first.raw).toBe(200);
      expect(first.body).toMatchObject({
        id: out.body.id,
        quantity: 5,
        quantity_returned: 2,
        checked_in_at: null,
        checked_in_by: null,
        checkin_note: 'two back',
      });
      expect((await a().get(`/v1/accessories/${acc.id}`)).body).toMatchObject({
        qty_checked_out: 3,
        qty_available: 2,
      });
      // the two freed units can be checked out again, a third cannot
      expect((await checkout(acc.id, { person_id: person.id, quantity: 2 })).status).toBe(201);
      expect((await checkout(acc.id, { person_id: person.id })).status).toBe(409);

      // more than outstanding: 422, nothing changes
      const tooMany = await checkin(acc.id, { assignment_id: out.body.id, quantity: 4 });
      expect(tooMany.status).toBe(422);
      expect(tooMany.body.errors[0]).toMatchObject({ pointer: '/quantity', code: 'too-many' });

      const second = await checkin(acc.id, { assignment_id: out.body.id, quantity: 1 });
      expect(second.body).toMatchObject({ quantity_returned: 3, checked_in_at: null });
      // default quantity = everything still outstanding; this closes the period
      const last = await checkin(acc.id, { assignment_id: out.body.id });
      expect(last.status).toBe(200);
      expect(last.body).toMatchObject({ quantity: 5, quantity_returned: 5 });
      expect(last.body.checked_in_at).toBeTruthy();
      expect(last.body.checked_in_by).toBeTruthy();
      // closed: another return is a conflict, and it never reopens
      const again = await checkin(acc.id, { assignment_id: out.body.id, quantity: 1 });
      expect(again.status).toBe(409);
      expect(
        (await a().get(`/v1/accessories/${acc.id}/assignments?state=closed`)).body.data.map(
          (r: { id: string }) => r.id,
        ),
      ).toEqual([out.body.id]);
      expect(
        (await a().get(`/v1/accessories/${acc.id}/assignments?state=open`)).body.data,
      ).toHaveLength(1);
      expect(
        (await a().get(`/v1/accessories/${acc.id}/assignments?state=all`)).body.data,
      ).toHaveLength(2);

      // an assignment of another accessory (or a random id) is not a valid reference
      const other = await newAccessory(a(), { qty_total: 2 });
      const foreign = await checkin(other.id, { assignment_id: out.body.id });
      expect(foreign.status).toBe(422);
      expect(foreign.body.errors[0].pointer).toBe('/assignment_id');
      expect((await checkin(acc.id, { assignment_id: randomUUID() })).status).toBe(422);
    });

    it('replays a check-out with the same Idempotency-Key and refuses the key with another body', async () => {
      const acc = await newAccessory(a(), { qty_total: 5 });
      const person = await newPerson(a());
      const k = unique('acc-key');
      const first = await checkout(
        acc.id,
        { person_id: person.id, quantity: 2 },
        keyed(undefined, k),
      );
      const replay = await checkout(
        acc.id,
        { person_id: person.id, quantity: 2 },
        keyed(undefined, k),
      );
      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body.id).toBe(first.body.id);
      expect((await a().get(`/v1/accessories/${acc.id}`)).body.qty_checked_out).toBe(2);
      const reuse = await checkout(
        acc.id,
        { person_id: person.id, quantity: 3 },
        keyed(undefined, k),
      );
      expect(reuse.status).toBe(422);
      expect(reuse.body.code).toBe('idempotency-key-reuse');
    });

    it('concurrent check-outs never exceed the stock: 40 requests for 1 unit each on 7 units, exactly 7 succeed', async () => {
      const acc = await newAccessory(a(), { qty_total: 7 });
      const people = await Promise.all(Array.from({ length: 8 }, () => newPerson(a())));
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          checkout(acc.id, { person_id: people[i % people.length]!.id }),
        ),
      );
      const statuses = results.map((r) => r.status);
      expect(
        statuses.filter((s) => s === 201),
        JSON.stringify(statuses),
      ).toHaveLength(7);
      expect(statuses.filter((s) => s === 409)).toHaveLength(33);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.code).toBe('insufficient-stock');
      }
      const got = await a().get(`/v1/accessories/${acc.id}`);
      expect(got.body).toMatchObject({ qty_total: 7, qty_checked_out: 7, qty_available: 0 });
      // the ledger of assignments agrees
      const rows = await ownerTenantSql(
        t.tenantId,
        `select coalesce(sum(quantity - quantity_returned), 0)::int as n, count(*)::int as c
           from app.assignment where accessory_id = $1 and checked_in_at is null`,
        [acc.id],
      );
      expect(rows.rows[0]).toEqual({ n: 7, c: 7 });
    });

    it('mixed concurrent check-outs and returns keep 0 <= out <= total', async () => {
      const acc = await newAccessory(a(), { qty_total: 6 });
      const person = await newPerson(a());
      const seed = await Promise.all(
        Array.from({ length: 6 }, () => checkout(acc.id, { person_id: person.id })),
      );
      const ids = seed.map((r) => r.body.id as string);
      const ops = [
        ...ids.slice(0, 3).map((id) => checkin(acc.id, { assignment_id: id })),
        ...Array.from({ length: 10 }, () => checkout(acc.id, { person_id: person.id })),
      ];
      const results = await Promise.all(ops);
      expect(results.every((r) => [200, 201, 409].includes(r.status))).toBe(true);
      const got = await a().get(`/v1/accessories/${acc.id}`);
      expect(got.body.qty_checked_out).toBeLessThanOrEqual(6);
      expect(got.body.qty_checked_out).toBeGreaterThanOrEqual(3);
      expect(got.body.qty_available).toBe(6 - got.body.qty_checked_out);
    });
  });

  describe('audit, events and the low-stock alert (M2-ACC-03)', () => {
    it('writes audit rows and outbox events for every change, in the same transaction', async () => {
      const acc = await newAccessory(a(), { qty_total: 4 });
      const person = await newPerson(a());
      const out = await checkout(acc.id, { person_id: person.id, quantity: 2 });
      const back = await checkin(acc.id, { assignment_id: out.body.id, quantity: 1 });
      expect(back.status).toBe(200);
      await a().patch(`/v1/accessories/${acc.id}`, { notes: 'n' }, ifMatch('*'));

      const audit = await auditRows(t.tenantId, `entity_id = '${acc.id}'`);
      expect(audit.map((r) => r.action)).toEqual([
        'accessory.created',
        'accessory.checked_out',
        'accessory.checked_in',
        'accessory.updated',
      ]);
      expect(audit[1]!.diff).toMatchObject({
        meta: {
          assignment_id: out.body.id,
          quantity: 2,
          target_type: 'person',
          target_id: person.id,
        },
      });
      expect(audit[2]!.diff).toMatchObject({
        meta: { assignment_id: out.body.id, quantity: 1, quantity_returned: 1, closed: false },
      });
      const events = await outboxRows(t.tenantId, `aggregate_id = '${acc.id}'`);
      expect(events.map((e) => e.event_type)).toEqual([
        'accessory.created',
        'accessory.checked_out',
        'accessory.checked_in',
        'accessory.updated',
      ]);
      expect(events[1]!.payload).toMatchObject({ assignmentId: out.body.id, personId: person.id });
    });

    it('emits accessory.low_stock once per crossing (not per check-out) and re-arms when units come back', async () => {
      const acc = await newAccessory(a(), { qty_total: 5, min_qty: 2 });
      const person = await newPerson(a());
      const lowEvents = async () =>
        (
          await outboxRows(
            t.tenantId,
            `aggregate_id = '${acc.id}' and event_type = 'accessory.low_stock'`,
          )
        ).length;

      const c1 = await checkout(acc.id, { person_id: person.id, quantity: 2 }); // available 3: above 2
      expect(await lowEvents()).toBe(0);
      const c2 = await checkout(acc.id, { person_id: person.id, quantity: 1 }); // 2: at the minimum -> alert
      expect(await lowEvents()).toBe(1);
      const alert = (
        await outboxRows(
          t.tenantId,
          `aggregate_id = '${acc.id}' and event_type = 'accessory.low_stock'`,
        )
      )[0]!;
      expect(alert.payload).toEqual({ accessoryId: acc.id, assignmentId: c2.body.id });
      expect(alert.aggregate_type).toBe('accessory');
      await checkout(acc.id, { person_id: person.id, quantity: 1 }); // 1: still low, no second alert
      await checkout(acc.id, { person_id: person.id, quantity: 1 }); // 0
      expect(await lowEvents()).toBe(1);

      // units come back above the minimum: re-armed; the next crossing alerts again
      await checkin(acc.id, { assignment_id: c1.body.id }); // out 3 -> available 2: still at the minimum
      expect(await lowEvents()).toBe(1);
      await checkin(acc.id, { assignment_id: c2.body.id }); // out 2 -> available 3: re-armed
      expect(
        (await a().get(`/v1/accessories?low_stock=true&q=${acc.body.name}`)).body.data,
      ).toHaveLength(0);
      await checkout(acc.id, { person_id: person.id, quantity: 1 }); // available 2 -> alert #2
      expect(await lowEvents()).toBe(2);

      // restocking by raising the total re-arms too
      const cur = await a().get(`/v1/accessories/${acc.id}`);
      await a().patch(`/v1/accessories/${acc.id}`, { qty_total: 10 }, ifMatch(cur.headers.etag));
      await checkout(acc.id, { person_id: person.id, quantity: 7 }); // available 0 -> alert #3
      expect(await lowEvents()).toBe(3);
    });

    it('a new minimum that the stock is already under raises the alert, a lower one re-arms', async () => {
      const acc = await newAccessory(a(), { qty_total: 4, min_qty: 0 });
      const person = await newPerson(a());
      await checkout(acc.id, { person_id: person.id, quantity: 3 }); // available 1, min 0: not low
      const lowEvents = async () =>
        (
          await outboxRows(
            t.tenantId,
            `aggregate_id = '${acc.id}' and event_type = 'accessory.low_stock'`,
          )
        ).length;
      expect(await lowEvents()).toBe(0);
      let cur = await a().get(`/v1/accessories/${acc.id}`);
      let res = await a().patch(
        `/v1/accessories/${acc.id}`,
        { min_qty: 2 },
        ifMatch(cur.headers.etag),
      );
      expect(res.body.low_stock).toBe(true);
      expect(await lowEvents()).toBe(1);
      cur = await a().get(`/v1/accessories/${acc.id}`);
      res = await a().patch(`/v1/accessories/${acc.id}`, { min_qty: 0 }, ifMatch(cur.headers.etag));
      expect(res.body.low_stock).toBe(false);
      cur = await a().get(`/v1/accessories/${acc.id}`);
      res = await a().patch(`/v1/accessories/${acc.id}`, { min_qty: 3 }, ifMatch(cur.headers.etag));
      expect(await lowEvents()).toBe(2);
    });
  });

  describe('permissions and scan codes', () => {
    it('viewers read, technicians check out and return, only managers edit', async () => {
      const acc = await newAccessory(a(), { qty_total: 3 });
      const person = await newPerson(a());
      const viewer = await createUser(app, t, 'viewer');
      const tech = await createUser(app, t, 'technician');
      expect((await viewer.client.get(`/v1/accessories/${acc.id}`)).status).toBe(200);
      expect(
        (
          await viewer.client.post(
            `/v1/accessories/${acc.id}/checkout`,
            { person_id: person.id },
            keyed(),
          )
        ).status,
      ).toBe(403);
      const out = await tech.client.post(
        `/v1/accessories/${acc.id}/checkout`,
        { person_id: person.id },
        keyed(),
      );
      expect(out.status).toBe(201);
      expect(
        (
          await tech.client.post(
            `/v1/accessories/${acc.id}/checkin`,
            { assignment_id: out.body.id },
            keyed(),
          )
        ).status,
      ).toBe(200);
      expect(
        (await tech.client.patch(`/v1/accessories/${acc.id}`, { notes: 'x' }, ifMatch('*'))).status,
      ).toBe(403);
      expect((await tech.client.post('/v1/accessories', { name: 'x' })).status).toBe(403);
    });

    it('scan resolve answers an accessory label with its own entity type and the allowed actions', async () => {
      const acc = await newAccessory(a(), { qty_total: 2 });
      const person = await newPerson(a());
      const res = await a().get(`/v1/scan/resolve?code=${acc.body.label_code}`);
      expect(res.status, res.raw).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).toMatchObject({
        match_type: 'label_code',
        entity_type: 'accessory',
        accessory: { id: acc.id, qty_available: 2 },
        allowed_actions: ['checkout', 'update'],
      });
      expect(res.body.asset).toBeUndefined();
      // the whole label URL works as for assets
      const url = encodeURIComponent(`https://app.example/s/${acc.body.label_code}`);
      expect((await a().get(`/v1/scan/resolve?code=${url}`)).body.accessory.id).toBe(acc.id);

      await checkout(acc.id, { person_id: person.id, quantity: 2 });
      const none = await a().get(`/v1/scan/resolve?code=${acc.body.label_code}`);
      expect(none.body.allowed_actions).toEqual(['checkin', 'update']);
      const viewer = await createUser(app, t, 'viewer');
      const asViewer = await viewer.client.get(`/v1/scan/resolve?code=${acc.body.label_code}`);
      expect(asViewer.status).toBe(200);
      expect(asViewer.body.allowed_actions).toEqual([]);
      expect((await a().get(`/v1/scan/resolve?code=${'0'.repeat(32)}`)).status).toBe(404);
    });
  });

  it('keeps the location and the category in use while accessories point at them', async () => {
    const cat = await newCategory(a(), 'accessory');
    const room = await newLocation(a());
    await newAccessory(a(), { category_id: cat.id, location_id: room.id });
    const c = await a().get(`/v1/categories/${cat.id}`);
    const del = await a().del(`/v1/categories/${cat.id}`, undefined, ifMatch(c.headers.etag));
    expect(del.status).toBe(409);
    expect(del.body.usage.accessories).toBe(1);
    const l = await a().get(`/v1/locations/${room.id}`);
    const delLoc = await a().del(`/v1/locations/${room.id}`, undefined, ifMatch(l.headers.etag));
    expect(delLoc.status).toBe(409);
    expect(delLoc.body.usage.accessories).toBe(1);
  });
});
