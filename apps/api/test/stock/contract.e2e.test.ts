import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, dbEnabled, type Resp } from '../auth/support.js';
import { contractViolations } from '../support/contract-observer.js';
import {
  ACC_TAGS,
  UNIVERSAL_STATUSES,
  loadContract,
  loadProblemCodes,
} from '../support/contract.js';
import { mode } from '../support/db.js';
import { check } from '../support/schema-check.js';
import {
  type App,
  type TenantFixture,
  createTenant,
  ifMatch,
  keyed,
  newAccessory,
  newCategory,
  newConsumable,
  newPerson,
  newTenancy,
  startRegistryApp,
  unique,
} from './support.js';

/**
 * Live half of the contract test for M2 wave 2 (accessories and consumables): every operation of the
 * tags `Accessories` and `Consumables` is called with valid input, and each answer must have a
 * documented status, validate against the response schema, and, for errors, be a problem document
 * with a code of the catalogue. `GET /v1/scan/resolve` is walked for the accessory and consumable
 * answers (`ScanResolveResponse`).
 */
describe.skipIf(!dbEnabled)(`accessories and consumables contract (live, ${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  const { operations } = loadContract();
  const byId = new Map(operations.map((o) => [o.operationId, o]));
  const walked = new Set<string>();
  const problemCodes = loadProblemCodes();

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'accc');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  async function hit(
    operationId: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    expected: number,
    options: { body?: unknown; headers?: Record<string, string>; client?: Client } = {},
  ): Promise<Resp> {
    const op = byId.get(operationId);
    expect(op, `operation ${operationId} is not in the contract`).toBeDefined();
    const res = await (options.client ?? t.admin).request(method, url, {
      body: options.body,
      headers: options.headers ?? {},
    });
    expect(res.status, `${operationId}: ${method} ${url} -> ${res.raw.slice(0, 300)}`).toBe(
      expected,
    );
    expect(
      op!.statuses.includes(res.status) || UNIVERSAL_STATUSES.includes(res.status),
      `${operationId} answered ${res.status}, the contract documents ${op!.statuses.join(', ')}`,
    ).toBe(true);
    if (res.status < 400) {
      walked.add(operationId);
      const schema = op!.responseSchemas[res.status];
      if (schema) {
        expect(
          check({ $ref: `#/components/schemas/${schema}` }, res.body),
          `${operationId} response body`,
        ).toEqual([]);
      } else if (res.status !== 204) {
        expect(res.raw, `${operationId}: no body documented for ${res.status}`).toBe('');
      }
    } else {
      expect(String(res.headers['content-type'])).toMatch(/^application\/problem\+json/);
      expect(check({ $ref: '#/components/schemas/Problem' }, res.body)).toEqual([]);
      expect(problemCodes[res.body.code], `unknown problem code ${res.body.code}`).toContain(
        res.status,
      );
    }
    return res;
  }

  it('walks every Accessories and Consumables operation: statuses and bodies match the contract', async () => {
    const uuid = () => randomUUID();
    const etag = (r: Resp) => String(r.headers.etag);
    const accCat = await newCategory(t.admin, 'accessory');
    const conCat = await newCategory(t.admin, 'consumable');
    const person = await newPerson(t.admin);

    // ---- accessories
    const acc = await hit('createAccessory', 'POST', '/v1/accessories', 201, {
      body: {
        category_id: accCat.id,
        name: unique('Headset'),
        qty_total: 6,
        min_qty: 1,
        purchase_cost: { amount_minor: 1500, currency: 'USD' },
      },
    });
    await hit('createAccessory', 'POST', '/v1/accessories', 422, {
      body: { category_id: accCat.id, name: '', qty_total: 1 },
    });
    await hit('listAccessories', 'GET', '/v1/accessories?include_total=true&sort=-qty_total', 200);
    await hit(
      'listAccessories',
      'GET',
      `/v1/accessories?category_id=${accCat.id}&low_stock=false`,
      200,
    );
    await hit('listAccessories', 'GET', '/v1/accessories?sort=bogus', 400);
    await hit('getAccessory', 'GET', `/v1/accessories/${acc.body.id}`, 200);
    await hit('getAccessory', 'GET', `/v1/accessories/${uuid()}`, 404);
    const upd = await hit('updateAccessory', 'PATCH', `/v1/accessories/${acc.body.id}`, 200, {
      body: { notes: 'shelf 3', purchase_cost: null },
      headers: ifMatch(etag(acc)).headers,
    });
    await hit('updateAccessory', 'PATCH', `/v1/accessories/${acc.body.id}`, 412, {
      body: { notes: 'x' },
      headers: ifMatch(etag(acc)).headers,
    });
    await hit('updateAccessory', 'PATCH', `/v1/accessories/${acc.body.id}`, 428, {
      body: { notes: 'x' },
    });
    await hit('updateAccessory', 'PATCH', `/v1/accessories/${acc.body.id}`, 422, {
      body: { qty_total: -1 },
      headers: ifMatch('*').headers,
    });
    const out = await hit(
      'checkoutAccessory',
      'POST',
      `/v1/accessories/${acc.body.id}/checkout`,
      201,
      {
        body: { person_id: person.id, quantity: 4, expected_return: '2999-01-01', note: 'n' },
        headers: keyed().headers,
      },
    );
    expect(out.headers.location).toBe(`/v1/accessories/${acc.body.id}/assignments`);
    await hit('checkoutAccessory', 'POST', `/v1/accessories/${acc.body.id}/checkout`, 409, {
      body: { person_id: person.id, quantity: 3 },
      headers: keyed().headers,
    });
    await hit('checkoutAccessory', 'POST', `/v1/accessories/${acc.body.id}/checkout`, 422, {
      body: {},
      headers: keyed().headers,
    });
    await hit('checkoutAccessory', 'POST', `/v1/accessories/${acc.body.id}/checkout`, 400, {
      body: { person_id: person.id },
    });
    await hit('checkoutAccessory', 'POST', `/v1/accessories/${uuid()}/checkout`, 404, {
      body: { person_id: person.id },
      headers: keyed().headers,
    });
    await hit(
      'listAccessoryAssignments',
      'GET',
      `/v1/accessories/${acc.body.id}/assignments?state=all`,
      200,
    );
    await hit(
      'listAccessoryAssignments',
      'GET',
      `/v1/accessories/${acc.body.id}/assignments?state=x`,
      400,
    );
    await hit('listAccessoryAssignments', 'GET', `/v1/accessories/${uuid()}/assignments`, 404);
    const part = await hit(
      'checkinAccessory',
      'POST',
      `/v1/accessories/${acc.body.id}/checkin`,
      200,
      {
        body: { assignment_id: out.body.id, quantity: 1 },
        headers: keyed().headers,
      },
    );
    expect(part.body.checked_in_at).toBeNull();
    await hit('checkinAccessory', 'POST', `/v1/accessories/${acc.body.id}/checkin`, 422, {
      body: { assignment_id: out.body.id, quantity: 9 },
      headers: keyed().headers,
    });
    await hit('checkinAccessory', 'POST', `/v1/accessories/${acc.body.id}/checkin`, 200, {
      body: { assignment_id: out.body.id },
      headers: keyed().headers,
    });
    await hit('checkinAccessory', 'POST', `/v1/accessories/${acc.body.id}/checkin`, 409, {
      body: { assignment_id: out.body.id },
      headers: keyed().headers,
    });
    await hit('checkinAccessory', 'POST', `/v1/accessories/${acc.body.id}/checkin`, 400, {
      body: { assignment_id: out.body.id },
    });
    await hit('checkinAccessory', 'POST', `/v1/accessories/${uuid()}/checkin`, 404, {
      body: { assignment_id: out.body.id },
      headers: keyed().headers,
    });
    // an accessory that is out cannot be archived; once returned it can
    const second = await hit(
      'checkoutAccessory',
      'POST',
      `/v1/accessories/${acc.body.id}/checkout`,
      201,
      {
        body: { person_id: person.id },
        headers: keyed().headers,
      },
    );
    await hit('archiveAccessory', 'DELETE', `/v1/accessories/${acc.body.id}`, 409, {
      headers: ifMatch('*').headers,
    });
    await hit('checkinAccessory', 'POST', `/v1/accessories/${acc.body.id}/checkin`, 200, {
      body: { assignment_id: second.body.id },
      headers: keyed().headers,
    });
    await hit('archiveAccessory', 'DELETE', `/v1/accessories/${acc.body.id}`, 204, {
      headers: ifMatch('*').headers,
    });
    await hit('archiveAccessory', 'DELETE', `/v1/accessories/${acc.body.id}`, 404, {
      headers: ifMatch('*').headers,
    });
    await hit('archiveAccessory', 'DELETE', `/v1/accessories/${uuid()}`, 428);

    // ---- consumables
    const con = await hit('createConsumable', 'POST', '/v1/consumables', 201, {
      body: {
        category_id: conCat.id,
        name: unique('Labels'),
        unit: 'roll',
        min_qty: 2,
        initial_qty: 5,
        unit_cost: { amount_minor: 450, currency: 'USD' },
      },
    });
    await hit('createConsumable', 'POST', '/v1/consumables', 422, {
      body: { category_id: conCat.id, name: 'x', initial_qty: -3 },
    });
    await hit(
      'listConsumables',
      'GET',
      '/v1/consumables?include_total=true&sort=-qty_on_hand',
      200,
    );
    await hit(
      'listConsumables',
      'GET',
      `/v1/consumables?category_id=${conCat.id}&low_stock=true`,
      200,
    );
    await hit('listConsumables', 'GET', '/v1/consumables?limit=0', 400);
    await hit('getConsumable', 'GET', `/v1/consumables/${con.body.id}`, 200);
    await hit('getConsumable', 'GET', `/v1/consumables/${uuid()}`, 404);
    await hit('updateConsumable', 'PATCH', `/v1/consumables/${con.body.id}`, 200, {
      body: { notes: 'fridge', unit_cost: null },
      headers: ifMatch(etag(con)).headers,
    });
    await hit('updateConsumable', 'PATCH', `/v1/consumables/${con.body.id}`, 412, {
      body: { notes: 'x' },
      headers: ifMatch(etag(con)).headers,
    });
    await hit('updateConsumable', 'PATCH', `/v1/consumables/${con.body.id}`, 428, {
      body: { notes: 'x' },
    });
    await hit('updateConsumable', 'PATCH', `/v1/consumables/${con.body.id}`, 422, {
      body: { qty_on_hand: 50 },
      headers: ifMatch('*').headers,
    });
    const mv = await hit(
      'createStockMovement',
      'POST',
      `/v1/consumables/${con.body.id}/movements`,
      201,
      {
        body: { qty_delta: -2, reason: 'issue', person_id: person.id, note: 'office' },
        headers: keyed().headers,
      },
    );
    expect(mv.headers.location).toBe(`/v1/consumables/${con.body.id}/movements`);
    expect(mv.body.balance_after).toBe(3);
    await hit('createStockMovement', 'POST', `/v1/consumables/${con.body.id}/movements`, 409, {
      body: { qty_delta: -9, reason: 'issue' },
      headers: keyed().headers,
    });
    await hit('createStockMovement', 'POST', `/v1/consumables/${con.body.id}/movements`, 422, {
      body: { qty_delta: 1, reason: 'issue' },
      headers: keyed().headers,
    });
    await hit('createStockMovement', 'POST', `/v1/consumables/${con.body.id}/movements`, 400, {
      body: { qty_delta: 1, reason: 'receive' },
    });
    await hit('createStockMovement', 'POST', `/v1/consumables/${uuid()}/movements`, 404, {
      body: { qty_delta: 1, reason: 'receive' },
      headers: keyed().headers,
    });
    await hit(
      'listStockMovements',
      'GET',
      `/v1/consumables/${con.body.id}/movements?reason=issue,receive&person_id=${person.id}`,
      200,
    );
    await hit(
      'listStockMovements',
      'GET',
      `/v1/consumables/${con.body.id}/movements?reason=nope`,
      400,
    );
    await hit('listStockMovements', 'GET', `/v1/consumables/${uuid()}/movements`, 404);
    await hit(
      'listPersonStockMovements',
      'GET',
      `/v1/people/${person.id}/stock-movements?limit=1`,
      200,
    );
    await hit('listPersonStockMovements', 'GET', `/v1/people/${uuid()}/stock-movements`, 404);
    await hit('archiveConsumable', 'DELETE', `/v1/consumables/${con.body.id}`, 204, {
      headers: ifMatch('*').headers,
    });
    await hit('archiveConsumable', 'DELETE', `/v1/consumables/${con.body.id}`, 404, {
      headers: ifMatch('*').headers,
    });
    await hit('archiveConsumable', 'DELETE', `/v1/consumables/${uuid()}`, 428);
    expect(upd.body.notes).toBe('shelf 3');
  });

  it('scan resolve answers accessory and consumable labels with documented bodies', async () => {
    const acc = await newAccessory(t.admin, { qty_total: 3 });
    const con = await newConsumable(t.admin, { initial_qty: 2 });
    const a = await hit('resolveScan', 'GET', `/v1/scan/resolve?code=${acc.body.label_code}`, 200);
    expect(a.body.entity_type).toBe('accessory');
    expect(check({ $ref: '#/components/schemas/ScanResolveAccessoryResult' }, a.body)).toEqual([]);
    const c = await hit('resolveScan', 'GET', `/v1/scan/resolve?code=${con.body.label_code}`, 200);
    expect(c.body.entity_type).toBe('consumable');
    expect(check({ $ref: '#/components/schemas/ScanResolveConsumableResult' }, c.body)).toEqual([]);
    await hit('resolveScan', 'GET', `/v1/scan/resolve?code=${'f'.repeat(32)}`, 404);
  });

  it('the walk covered every operation of the accessory and consumable tags', () => {
    const required = operations.filter((o) => ACC_TAGS.has(o.tag)).map((o) => o.operationId);
    expect(required.length).toBeGreaterThanOrEqual(16);
    expect(required.filter((id) => !walked.has(id))).toEqual([]);
  });
});
