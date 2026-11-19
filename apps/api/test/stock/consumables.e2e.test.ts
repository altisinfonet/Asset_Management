import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { env, mode, rawTenantTx, sqlState, withClient } from '../support/db.js';
import {
  type App,
  type TenantFixture,
  auditRows,
  contractViolations,
  createTenant,
  createUser,
  ifMatch,
  keyed,
  newCategory,
  newConsumable,
  newPerson,
  newTenancy,
  outboxRows,
  ownerTenantSql,
  startRegistryApp,
  unique,
} from './support.js';

/**
 * M2-ACC-02 / M2-ACC-03 consumables: the append-only stock ledger (receive, issue, return, adjust,
 * correction), the on-hand quantity as the ledger's balance protected by a non-negative CHECK,
 * concurrent consumes that can never drive stock negative, the consume log per consumable and per
 * person, and the minimum-stock alert (`consumable.low_stock`, once per crossing, re-armed).
 */
describe.skipIf(!dbEnabled)(`consumables (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'con1');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const move = (id: string, body: Record<string, unknown>, k = keyed()) =>
    a().post(`/v1/consumables/${id}/movements`, body, k);
  const onHand = async (id: string) => (await a().get(`/v1/consumables/${id}`)).body.qty_on_hand;
  const lowEvents = async (id: string) =>
    (await outboxRows(t.tenantId, `aggregate_id = '${id}' and event_type = 'consumable.low_stock'`))
      .length;

  describe('catalogue', () => {
    it('creates a consumable; initial_qty becomes the first receive movement; the category must be a consumable category', async () => {
      const cat = await newCategory(a(), 'consumable');
      const res = await a().post('/v1/consumables', {
        category_id: cat.id,
        name: unique('Toner black'),
        unit: 'cartridge',
        min_qty: 2,
        initial_qty: 6,
        unit_cost: { amount_minor: 8900, currency: 'EUR' },
        model_number: 'CF410X',
      });
      expect(res.status, res.raw).toBe(201);
      expect(res.headers.location).toBe(`/v1/consumables/${res.body.id}`);
      expect(res.body).toMatchObject({
        unit: 'cartridge',
        qty_on_hand: 6,
        min_qty: 2,
        low_stock: false,
        unit_cost: { amount_minor: 8900, currency: 'EUR' },
      });
      expect(res.body.label_code).toMatch(/^[0-9a-f]{32}$/);
      const ledger = await a().get(`/v1/consumables/${res.body.id}/movements`);
      expect(ledger.body.data).toHaveLength(1);
      expect(ledger.body.data[0]).toMatchObject({
        qty_delta: 6,
        reason: 'receive',
        balance_after: 6,
        note: 'Opening stock',
        consumable_name: res.body.name,
      });
      expect(ledger.body.data[0].by_user_id).toBeTruthy();

      const assetCat = (await a().post('/v1/categories', { name: unique('AssetCat') })).body;
      const wrong = await a().post('/v1/consumables', { category_id: assetCat.id, name: 'x' });
      expect(wrong.status).toBe(422);
      expect(wrong.body.errors[0]).toMatchObject({ pointer: '/category_id', code: 'wrong-kind' });
      const accCat = await newCategory(a(), 'accessory');
      expect(
        (await a().post('/v1/consumables', { category_id: accCat.id, name: 'x' })).status,
      ).toBe(422);
      expect(
        (await a().post('/v1/consumables', { category_id: cat.id, name: 'x', qty_on_hand: 5 }))
          .status,
      ).toBe(422);
      expect(
        (await a().post('/v1/consumables', { category_id: cat.id, name: 'x', initial_qty: -1 }))
          .status,
      ).toBe(422);
      // a consumable without opening stock starts at zero, with no movement
      const empty = await newConsumable(a(), { category_id: cat.id });
      expect(empty.body.qty_on_hand).toBe(0);
      expect((await a().get(`/v1/consumables/${empty.id}/movements`)).body.data).toHaveLength(0);
    });

    it('lists, filters, sorts and pages; edits and archives with If-Match (quantity is not editable)', async () => {
      const cat = await newCategory(a(), 'consumable');
      const names = ['Alpha', 'Bravo', 'Charlie'].map((n) => unique(n));
      const [x, y, z] = [
        await newConsumable(a(), { category_id: cat.id, name: names[0], initial_qty: 10 }),
        await newConsumable(a(), {
          category_id: cat.id,
          name: names[1],
          initial_qty: 2,
          min_qty: 5,
        }),
        await newConsumable(a(), { category_id: cat.id, name: names[2], initial_qty: 4 }),
      ];
      const list = await a().get(`/v1/consumables?category_id=${cat.id}&include_total=true`);
      expect(list.body.page.total).toBe(3);
      expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([x.id, y.id, z.id]);
      expect(
        (await a().get(`/v1/consumables?category_id=${cat.id}&low_stock=true`)).body.data.map(
          (r: { id: string }) => r.id,
        ),
      ).toEqual([y.id]);
      expect(
        (await a().get(`/v1/consumables?category_id=${cat.id}&low_stock=false`)).body.data,
      ).toHaveLength(2);
      const first = await a().get(
        `/v1/consumables?category_id=${cat.id}&sort=-qty_on_hand&limit=2`,
      );
      expect(first.body.data.map((r: { id: string }) => r.id)).toEqual([x.id, z.id]);
      const second = await a().get(
        `/v1/consumables?category_id=${cat.id}&sort=-qty_on_hand&limit=2&cursor=${first.body.page.next_cursor}`,
      );
      expect(second.body.data.map((r: { id: string }) => r.id)).toEqual([y.id]);

      const cur = await a().get(`/v1/consumables/${x.id}`);
      expect((await a().patch(`/v1/consumables/${x.id}`, { notes: 'n' }, {})).status).toBe(428);
      const renamed = await a().patch(
        `/v1/consumables/${x.id}`,
        { name: unique('Renamed'), unit: 'box' },
        ifMatch(cur.headers.etag),
      );
      expect(renamed.status, renamed.raw).toBe(200);
      expect(renamed.body).toMatchObject({ unit: 'box', qty_on_hand: 10 });
      expect(
        (await a().patch(`/v1/consumables/${x.id}`, { notes: 'x' }, ifMatch(cur.headers.etag)))
          .status,
      ).toBe(412);
      // the quantity is the ledger's: a PATCH cannot set it
      const sneaky = await a().patch(
        `/v1/consumables/${x.id}`,
        { qty_on_hand: 999 },
        ifMatch(renamed.headers.etag),
      );
      expect(sneaky.status).toBe(422);
      expect(await onHand(x.id)).toBe(10);

      const archived = await a().del(
        `/v1/consumables/${x.id}`,
        undefined,
        ifMatch(renamed.headers.etag),
      );
      expect(archived.status).toBe(204);
      expect((await move(x.id, { qty_delta: 1, reason: 'receive' })).status).toBe(409);
      expect(
        (await a().get(`/v1/consumables?archived=only&category_id=${cat.id}`)).body.data,
      ).toHaveLength(1);
      expect((await a().get(`/v1/consumables/${randomUUID()}`)).status).toBe(404);
    });
  });

  describe('the ledger', () => {
    it('receives, issues, returns, adjusts and corrects: the balance is the sum of the ledger, newest first', async () => {
      const c = await newConsumable(a(), { initial_qty: 10 });
      const person = await newPerson(a());
      const r1 = await move(c.id, { qty_delta: 5, reason: 'receive', note: 'delivery 77' });
      expect(r1.status, r1.raw).toBe(201);
      expect(r1.headers.location).toBe(`/v1/consumables/${c.id}/movements`);
      expect(r1.body).toMatchObject({
        consumable_id: c.id,
        qty_delta: 5,
        reason: 'receive',
        balance_after: 15,
      });
      const r2 = await move(c.id, {
        qty_delta: -4,
        reason: 'issue',
        person_id: person.id,
        note: 'floor 2',
      });
      expect(r2.body).toMatchObject({ qty_delta: -4, balance_after: 11, person_id: person.id });
      expect(
        (await move(c.id, { qty_delta: 1, reason: 'return', person_id: person.id })).body
          .balance_after,
      ).toBe(12);
      const adj = await move(c.id, {
        qty_delta: -2,
        reason: 'adjust',
        note: 'stock count: 2 missing',
      });
      expect(adj.body.balance_after).toBe(10);
      const fix = await move(c.id, { qty_delta: 1, reason: 'correction', note: 'miscounted' });
      expect(fix.body.balance_after).toBe(11);
      expect(await onHand(c.id)).toBe(11);

      const ledger = await a().get(`/v1/consumables/${c.id}/movements`);
      expect(ledger.body.data.map((m: { reason: string }) => m.reason)).toEqual([
        'correction',
        'adjust',
        'return',
        'issue',
        'receive',
        'receive',
      ]);
      const sum = ledger.body.data.reduce(
        (n: number, m: { qty_delta: number }) => n + m.qty_delta,
        0,
      );
      expect(sum).toBe(11);
      // balance_after is a running balance in ledger order
      const chrono = [...ledger.body.data].reverse();
      let running = 0;
      for (const m of chrono) {
        running += m.qty_delta;
        expect(m.balance_after).toBe(running);
      }
      // the database agrees
      const db = await ownerTenantSql(
        t.tenantId,
        `select c.qty_on_hand, coalesce(sum(m.qty_delta), 0)::int as ledger
           from app.consumable c left join app.stock_movement m on m.consumable_id = c.id
          where c.id = $1 group by c.id`,
        [c.id],
      );
      expect(db.rows[0]).toEqual({ qty_on_hand: 11, ledger: 11 });

      // filters and pages
      expect(
        (await a().get(`/v1/consumables/${c.id}/movements?reason=receive,issue`)).body.data,
      ).toHaveLength(3);
      expect(
        (await a().get(`/v1/consumables/${c.id}/movements?person_id=${person.id}`)).body.data,
      ).toHaveLength(2);
      const p1 = await a().get(`/v1/consumables/${c.id}/movements?limit=4`);
      expect(p1.body.page.has_more).toBe(true);
      const p2 = await a().get(
        `/v1/consumables/${c.id}/movements?limit=4&cursor=${p1.body.page.next_cursor}`,
      );
      expect([...p1.body.data, ...p2.body.data].map((m: { id: string }) => m.id)).toEqual(
        ledger.body.data.map((m: { id: string }) => m.id),
      );
      expect((await a().get(`/v1/consumables/${c.id}/movements?reason=bogus`)).status).toBe(400);
      expect((await a().get(`/v1/consumables/${randomUUID()}/movements`)).status).toBe(404);
    });

    it('validates sign, reason and note: 422 for a wrong sign, zero, a missing note on adjust / correction, an unknown person', async () => {
      const c = await newConsumable(a(), { initial_qty: 5 });
      const bad = async (body: Record<string, unknown>) => (await move(c.id, body)).status;
      expect(await bad({ qty_delta: 0, reason: 'receive' })).toBe(422);
      expect(await bad({ qty_delta: -1, reason: 'receive' })).toBe(422);
      expect(await bad({ qty_delta: -1, reason: 'return' })).toBe(422);
      expect(await bad({ qty_delta: 1, reason: 'issue' })).toBe(422);
      expect(await bad({ qty_delta: -1, reason: 'adjust' })).toBe(422);
      expect(await bad({ qty_delta: -1, reason: 'correction', note: '   ' })).toBe(422);
      expect(await bad({ qty_delta: 1, reason: 'bogus' })).toBe(422);
      expect(await bad({ qty_delta: 1.5, reason: 'receive' })).toBe(422);
      expect(await bad({ qty_delta: 1, reason: 'receive', person_id: randomUUID() })).toBe(422);
      expect(await bad({ qty_delta: 1, reason: 'receive', extra: true })).toBe(422);
      const noKey = await a().post(`/v1/consumables/${c.id}/movements`, {
        qty_delta: 1,
        reason: 'receive',
      });
      expect(noKey.status).toBe(400);
      expect((await move(randomUUID(), { qty_delta: 1, reason: 'receive' })).status).toBe(404);
      expect(await onHand(c.id)).toBe(5);
      expect(await bad({ qty_delta: 1, reason: 'adjust', note: 'found one' })).toBe(201);
    });

    it('refuses an overdraw with 409 insufficient-stock and writes nothing', async () => {
      const c = await newConsumable(a(), { initial_qty: 3 });
      const res = await move(c.id, { qty_delta: -4, reason: 'issue' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('insufficient-stock');
      expect(res.body).toMatchObject({ on_hand: 3, requested: 4 });
      const adj = await move(c.id, { qty_delta: -4, reason: 'adjust', note: 'count says -1' });
      expect(adj.status).toBe(409);
      expect(await onHand(c.id)).toBe(3);
      expect((await a().get(`/v1/consumables/${c.id}/movements`)).body.data).toHaveLength(1);
      // taking exactly what is there is fine
      expect((await move(c.id, { qty_delta: -3, reason: 'issue' })).status).toBe(201);
      expect(await onHand(c.id)).toBe(0);
    });

    it('replays a movement with the same Idempotency-Key exactly once', async () => {
      const c = await newConsumable(a(), { initial_qty: 5 });
      const k = unique('mv-key');
      const first = await move(c.id, { qty_delta: -2, reason: 'issue' }, keyed(undefined, k));
      const replay = await move(c.id, { qty_delta: -2, reason: 'issue' }, keyed(undefined, k));
      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body.id).toBe(first.body.id);
      expect(await onHand(c.id)).toBe(3);
      const reuse = await move(c.id, { qty_delta: -1, reason: 'issue' }, keyed(undefined, k));
      expect(reuse.status).toBe(422);
    });

    it('concurrent consumes cannot drive stock negative: 60 requests for 1 unit on 25 in stock, exactly 25 succeed', async () => {
      const c = await newConsumable(a(), { initial_qty: 25 });
      const results = await Promise.all(
        Array.from({ length: 60 }, () => move(c.id, { qty_delta: -1, reason: 'issue' })),
      );
      const statuses = results.map((r) => r.status);
      expect(
        statuses.filter((s) => s === 201),
        JSON.stringify(statuses),
      ).toHaveLength(25);
      expect(statuses.filter((s) => s === 409)).toHaveLength(35);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.code).toBe('insufficient-stock');
      }
      expect(await onHand(c.id)).toBe(0);
      const ledger = await ownerTenantSql(
        t.tenantId,
        `select count(*)::int as n, min(balance_after)::int as lowest, coalesce(sum(qty_delta), 0)::int as total
           from app.stock_movement where consumable_id = $1`,
        [c.id],
      );
      expect(ledger.rows[0]).toEqual({ n: 26, lowest: 0, total: 0 });
      // balances are unique: no two movements saw the same stock (serialised on the row)
      const balances = await ownerTenantSql(
        t.tenantId,
        `select count(distinct balance_after)::int as d from app.stock_movement where consumable_id = $1`,
        [c.id],
      );
      expect(balances.rows[0].d).toBe(26);
    });

    it('mixed concurrent receives and issues keep the balance equal to the ledger', async () => {
      const c = await newConsumable(a(), { initial_qty: 10 });
      const ops = Array.from({ length: 30 }, (_, i) =>
        i % 3 === 0
          ? move(c.id, { qty_delta: 3, reason: 'receive' })
          : move(c.id, { qty_delta: -2, reason: 'issue' }),
      );
      const results = await Promise.all(ops);
      expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
      const db = await ownerTenantSql(
        t.tenantId,
        `select c.qty_on_hand, coalesce(sum(m.qty_delta), 0)::int as ledger
           from app.consumable c left join app.stock_movement m on m.consumable_id = c.id
          where c.id = $1 group by c.id`,
        [c.id],
      );
      expect(db.rows[0].qty_on_hand).toBe(db.rows[0].ledger);
      expect(db.rows[0].qty_on_hand).toBeGreaterThanOrEqual(0);
    });
  });

  describe('database guarantees', () => {
    it('the ledger is append-only and the balance moves only through it', async () => {
      const c = await newConsumable(a(), { initial_qty: 4 });
      const asTenant = (sql: string, params: unknown[] = []) =>
        sqlState(
          withClient(env.databaseUrl!, (client) =>
            rawTenantTx(client, t.tenantId, () => client.query(sql, params)),
          ),
        );
      expect(
        await asTenant(`update app.stock_movement set note = 'tampered' where consumable_id = $1`, [
          c.id,
        ]),
      ).toBe('42501');
      expect(
        await asTenant(`delete from app.stock_movement where consumable_id = $1`, [c.id]),
      ).toBe('42501');
      // a direct change of the on-hand quantity is refused by the guard trigger (23514), the CHECK refuses a negative one
      expect(
        await asTenant(`update app.consumable set qty_on_hand = 99 where id = $1`, [c.id]),
      ).toBe('23514');
      expect(
        await asTenant(`update app.consumable set qty_on_hand = -1 where id = $1`, [c.id]),
      ).toBe('23514');
      expect(
        await asTenant(
          `insert into app.consumable (id, tenant_id, company_id, category_id, name, qty_on_hand)
           select $1, $2, (select id from app.company where is_default), (select category_id from app.consumable where id = $3), 'x', 5`,
          [randomUUID(), t.tenantId, c.id],
        ),
      ).toBe('23514');
      // the sign and note rules are repeated in the table
      const insert = (reason: string, delta: number, note: string | null) =>
        asTenant(
          `insert into app.stock_movement (id, tenant_id, consumable_id, qty_delta, reason, note) values ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), t.tenantId, c.id, delta, reason, note],
        );
      expect(await insert('issue', 1, null)).toBe('23514');
      expect(await insert('receive', -1, null)).toBe('23514');
      expect(await insert('adjust', 1, null)).toBe('23514');
      expect(await insert('issue', 0, null)).toBe('23514');
      expect(await insert('issue', -9, null)).toBe('23514'); // overdraw: the CHECK on qty_on_hand
      expect(await onHand(c.id)).toBe(4);
    });
  });

  describe('audit, events and the low-stock alert (M2-ACC-03)', () => {
    it('writes an audit row and an outbox event per movement, with ids only in the payload', async () => {
      const c = await newConsumable(a(), { initial_qty: 4 });
      const person = await newPerson(a());
      const mv = await move(c.id, {
        qty_delta: -1,
        reason: 'issue',
        person_id: person.id,
        note: 'lab',
      });
      const audit = await auditRows(t.tenantId, `entity_id = '${c.id}'`);
      expect(audit.map((r) => r.action)).toEqual(['consumable.created', 'consumable.stock_moved']);
      expect(audit[1]!.diff).toMatchObject({
        before: { qty_on_hand: 4 },
        after: { qty_on_hand: 3 },
        meta: {
          movement_id: mv.body.id,
          reason: 'issue',
          qty_delta: -1,
          person_id: person.id,
          note: 'lab',
        },
      });
      const events = await outboxRows(t.tenantId, `aggregate_id = '${c.id}'`);
      expect(events.map((e) => e.event_type)).toEqual([
        'consumable.created',
        'consumable.stock_moved',
      ]);
      expect(events[1]!.payload).toMatchObject({ movementId: mv.body.id, personId: person.id });
    });

    it('emits consumable.low_stock once per crossing, not once per movement, and re-arms when restocked above the minimum', async () => {
      const c = await newConsumable(a(), { initial_qty: 10, min_qty: 3 });
      expect(await lowEvents(c.id)).toBe(0);
      await move(c.id, { qty_delta: -5, reason: 'issue' }); // 5: above
      await move(c.id, { qty_delta: -1, reason: 'issue' }); // 4: above
      expect(await lowEvents(c.id)).toBe(0);
      const cross = await move(c.id, { qty_delta: -1, reason: 'issue' }); // 3 = minimum: crossing
      expect(await lowEvents(c.id)).toBe(1);
      const ev = (
        await outboxRows(
          t.tenantId,
          `aggregate_id = '${c.id}' and event_type = 'consumable.low_stock'`,
        )
      )[0]!;
      expect(ev.payload).toEqual({ consumableId: c.id, movementId: cross.body.id });
      expect(ev.aggregate_type).toBe('consumable');
      await move(c.id, { qty_delta: -1, reason: 'issue' }); // 2: still low
      await move(c.id, { qty_delta: -2, reason: 'issue' }); // 0
      await move(c.id, { qty_delta: 1, reason: 'receive' }); // 1: still low
      expect(await lowEvents(c.id)).toBe(1);
      expect(
        (await a().get(`/v1/consumables?low_stock=true&q=${c.body.name}`)).body.data,
      ).toHaveLength(1);

      // restocked above the minimum: re-armed, silent
      await move(c.id, { qty_delta: 10, reason: 'receive' }); // 11
      expect(await lowEvents(c.id)).toBe(1);
      expect((await a().get(`/v1/consumables/${c.id}`)).body.low_stock).toBe(false);
      // the next crossing alerts again
      await move(c.id, { qty_delta: -8, reason: 'issue' }); // 3
      expect(await lowEvents(c.id)).toBe(2);
    });

    it('does not alert without a minimum; changing the minimum re-evaluates; creating an item that is already low alerts', async () => {
      const c = await newConsumable(a(), { initial_qty: 4, min_qty: 0 });
      await move(c.id, { qty_delta: -4, reason: 'issue' });
      expect(await lowEvents(c.id)).toBe(0);
      expect((await a().get(`/v1/consumables/${c.id}`)).body.low_stock).toBe(false);
      let cur = await a().get(`/v1/consumables/${c.id}`);
      const raised = await a().patch(
        `/v1/consumables/${c.id}`,
        { min_qty: 2 },
        ifMatch(cur.headers.etag),
      );
      expect(raised.body.low_stock).toBe(true);
      expect(await lowEvents(c.id)).toBe(1);
      cur = await a().get(`/v1/consumables/${c.id}`);
      await a().patch(`/v1/consumables/${c.id}`, { min_qty: 0 }, ifMatch(cur.headers.etag));
      cur = await a().get(`/v1/consumables/${c.id}`);
      await a().patch(`/v1/consumables/${c.id}`, { min_qty: 1 }, ifMatch(cur.headers.etag));
      expect(await lowEvents(c.id)).toBe(2);

      const born = await newConsumable(a(), { initial_qty: 1, min_qty: 5 });
      expect(await lowEvents(born.id)).toBe(1);
      const opening = (
        await outboxRows(
          t.tenantId,
          `aggregate_id = '${born.id}' and event_type = 'consumable.low_stock'`,
        )
      )[0]!;
      expect(opening.payload.movementId).toBeTruthy();
    });

    it('concurrent consumes across the minimum raise the alert exactly once', async () => {
      const c = await newConsumable(a(), { initial_qty: 20, min_qty: 10 });
      await Promise.all(
        Array.from({ length: 20 }, () => move(c.id, { qty_delta: -1, reason: 'issue' })),
      );
      expect(await onHand(c.id)).toBe(0);
      expect(await lowEvents(c.id)).toBe(1);
    });
  });

  describe('consume log per person and permissions', () => {
    it('lists what was issued to / returned by a person across consumables, newest first', async () => {
      const person = await newPerson(a());
      const other = await newPerson(a());
      const c1 = await newConsumable(a(), { initial_qty: 9 });
      const c2 = await newConsumable(a(), { initial_qty: 9 });
      await move(c1.id, { qty_delta: -1, reason: 'issue', person_id: person.id });
      await move(c2.id, { qty_delta: -2, reason: 'issue', person_id: person.id });
      await move(c2.id, { qty_delta: 1, reason: 'return', person_id: person.id });
      await move(c1.id, { qty_delta: -1, reason: 'issue', person_id: other.id });
      const log = await a().get(`/v1/people/${person.id}/stock-movements`);
      expect(log.status).toBe(200);
      expect(log.body.data).toHaveLength(3);
      expect(log.body.data.map((m: { reason: string }) => m.reason)).toEqual([
        'return',
        'issue',
        'issue',
      ]);
      expect(log.body.data.every((m: { person_id: string }) => m.person_id === person.id)).toBe(
        true,
      );
      expect(log.body.data[0]).toMatchObject({
        consumable_id: c2.id,
        consumable_name: c2.body.name,
        person_name: person.body.display_name,
      });
      expect(
        (await a().get(`/v1/people/${person.id}/stock-movements?reason=return`)).body.data,
      ).toHaveLength(1);
      const p1 = await a().get(`/v1/people/${person.id}/stock-movements?limit=2`);
      const p2 = await a().get(
        `/v1/people/${person.id}/stock-movements?limit=2&cursor=${p1.body.page.next_cursor}`,
      );
      expect(p1.body.page.has_more).toBe(true);
      expect([...p1.body.data, ...p2.body.data]).toHaveLength(3);
      expect((await a().get(`/v1/people/${randomUUID()}/stock-movements`)).status).toBe(404);
    });

    it('viewers read, technicians move stock, only managers create and edit', async () => {
      const c = await newConsumable(a(), { initial_qty: 5 });
      const viewer = await createUser(app, t, 'viewer');
      const tech = await createUser(app, t, 'technician');
      expect((await viewer.client.get(`/v1/consumables/${c.id}`)).status).toBe(200);
      expect((await viewer.client.get(`/v1/consumables/${c.id}/movements`)).status).toBe(200);
      expect(
        (
          await viewer.client.post(
            `/v1/consumables/${c.id}/movements`,
            { qty_delta: -1, reason: 'issue' },
            keyed(),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await tech.client.post(
            `/v1/consumables/${c.id}/movements`,
            { qty_delta: -1, reason: 'issue' },
            keyed(),
          )
        ).status,
      ).toBe(201);
      expect((await tech.client.post('/v1/consumables', { name: 'x' })).status).toBe(403);
      expect(
        (await tech.client.patch(`/v1/consumables/${c.id}`, { notes: 'x' }, ifMatch('*'))).status,
      ).toBe(403);
    });

    it('scan resolve answers a consumable label with its own entity type and the allowed actions', async () => {
      const c = await newConsumable(a(), { initial_qty: 2 });
      const res = await a().get(`/v1/scan/resolve?code=${c.body.label_code}`);
      expect(res.status, res.raw).toBe(200);
      expect(res.body).toMatchObject({
        match_type: 'label_code',
        entity_type: 'consumable',
        consumable: { id: c.id, qty_on_hand: 2 },
        allowed_actions: ['issue', 'receive', 'adjust', 'update'],
      });
      await move(c.id, { qty_delta: -2, reason: 'issue' });
      expect(
        (await a().get(`/v1/scan/resolve?code=${c.body.label_code}`)).body.allowed_actions,
      ).toEqual(['receive', 'adjust', 'update']);
      const viewer = await createUser(app, t, 'viewer');
      expect(
        (await viewer.client.get(`/v1/scan/resolve?code=${c.body.label_code}`)).body
          .allowed_actions,
      ).toEqual([]);
    });
  });
});
