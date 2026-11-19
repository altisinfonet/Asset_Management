import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, dbEnabled, type Resp } from '../auth/support.js';
import { contractViolations } from '../support/contract-observer.js';
import {
  UNIVERSAL_STATUSES,
  WAVE1_TAGS,
  loadContract,
  loadProblemCodes,
} from '../support/contract.js';
import { mode } from '../support/db.js';
import { check } from '../support/schema-check.js';
import {
  type App,
  type TenantFixture,
  basics,
  createTenant,
  ifMatch,
  inDays,
  keyed,
  newAsset,
  newPerson,
  newPhoto,
  newTenancy,
  startRegistryApp,
  unique,
} from './support.js';

/**
 * Live half of the contract test for M2 wave 1 (locations, people, custody): every operation of the
 * tags `Locations`, `People` and `Custody` is called with valid input, and each answer must have a
 * documented status, validate against the response schema, and, for errors, be a problem document
 * with a code of the catalogue. Wave-1 operations of the Assets tag (move, history, ...) are walked
 * in the registry contract test.
 */
describe.skipIf(!dbEnabled)(`wave-1 contract (live, ${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  const { operations } = loadContract();
  const byId = new Map(operations.map((o) => [o.operationId, o]));
  const walked = new Set<string>();
  const problemCodes = loadProblemCodes();

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'w1c');
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

  it('walks every Locations, People and Custody operation: statuses and bodies match the contract', async () => {
    const uuid = () => randomUUID();
    const etag = (r: Resp) => String(r.headers.etag);
    const { categoryId } = await basics(t);

    // ---- locations
    const site = await hit('createLocation', 'POST', '/v1/locations', 201, {
      body: {
        name: unique('Site'),
        kind: 'site',
        address: { city: 'Oslo', country: 'NO' },
        latitude: 59.91,
        longitude: 10.75,
      },
    });
    const room = await hit('createLocation', 'POST', '/v1/locations', 201, {
      body: { name: unique('Room'), kind: 'room', parent_id: site.body.id },
    });
    await hit('createLocation', 'POST', '/v1/locations', 409, {
      body: { name: room.body.name, parent_id: site.body.id },
    });
    await hit('createLocation', 'POST', '/v1/locations', 422, { body: { name: '' } });
    await hit(
      'listLocations',
      'GET',
      `/v1/locations?parent_id=${site.body.id}&include_total=true&sort=-depth`,
      200,
    );
    await hit('listLocations', 'GET', '/v1/locations?kind=bogus', 400);
    await hit('getLocation', 'GET', `/v1/locations/${site.body.id}`, 200);
    await hit('getLocation', 'GET', `/v1/locations/${uuid()}`, 404);
    await hit('updateLocation', 'PATCH', `/v1/locations/${room.body.id}`, 200, {
      body: { notes: 'north wing' },
      headers: { 'if-match': etag(room) },
    });
    await hit('updateLocation', 'PATCH', `/v1/locations/${room.body.id}`, 412, {
      body: { notes: 'x' },
      headers: { 'if-match': etag(room) },
    });
    await hit('updateLocation', 'PATCH', `/v1/locations/${room.body.id}`, 428, {
      body: { notes: 'x' },
    });
    await hit('updateLocation', 'PATCH', `/v1/locations/${site.body.id}`, 422, {
      body: { parent_id: room.body.id },
      headers: { 'if-match': '*' },
    });
    await hit('archiveLocation', 'DELETE', `/v1/locations/${site.body.id}`, 409, {
      headers: { 'if-match': '*' },
    });

    // ---- people
    const person = await hit('createPerson', 'POST', '/v1/people', 201, {
      body: {
        display_name: unique('Pat'),
        email: `${unique('pat')}@w1.example`,
        employee_ref: unique('E'),
        location_id: room.body.id,
      },
    });
    await hit('createPerson', 'POST', '/v1/people', 409, {
      body: { display_name: 'Dup', email: person.body.email },
    });
    await hit('createPerson', 'POST', '/v1/people', 422, {
      body: { display_name: 'x', kind: 'robot' },
    });
    await hit('listPeople', 'GET', '/v1/people?limit=5&include_total=true&sort=display_name', 200);
    await hit('listPeople', 'GET', '/v1/people?has_login=maybe', 400);
    await hit('getPerson', 'GET', `/v1/people/${person.body.id}`, 200);
    await hit('getPerson', 'GET', `/v1/people/${uuid()}`, 404);
    const person2 = await hit('updatePerson', 'PATCH', `/v1/people/${person.body.id}`, 200, {
      body: { department: 'Maths' },
      headers: { 'if-match': etag(person) },
    });
    await hit('updatePerson', 'PATCH', `/v1/people/${person.body.id}`, 412, {
      body: { department: 'x' },
      headers: { 'if-match': etag(person) },
    });
    await hit('updatePerson', 'PATCH', `/v1/people/${person.body.id}`, 428, {
      body: { department: 'x' },
    });
    await hit('updatePerson', 'PATCH', `/v1/people/${person.body.id}`, 422, {
      body: { status: 'sleeping' },
      headers: { 'if-match': '*' },
    });

    // ---- custody
    const asset = await newAsset(t.admin, categoryId);
    const out = await hit('checkoutAsset', 'POST', `/v1/assets/${asset.id}/checkout`, 201, {
      body: { person_id: person.body.id, expected_return: inDays(7), note: 'n' },
      headers: keyed(asset.etag).headers,
    });
    expect(out.headers.location).toMatch(/^\/v1\/assets\//);
    await hit('checkoutAsset', 'POST', `/v1/assets/${asset.id}/checkout`, 409, {
      body: { person_id: person.body.id },
      headers: keyed().headers,
    });
    await hit('checkoutAsset', 'POST', `/v1/assets/${asset.id}/checkout`, 422, {
      body: {},
      headers: keyed().headers,
    });
    await hit('checkoutAsset', 'POST', `/v1/assets/${asset.id}/checkout`, 400, {
      body: { person_id: person.body.id },
    });
    await hit('checkoutAsset', 'POST', `/v1/assets/${uuid()}/checkout`, 404, {
      body: { person_id: person.body.id },
      headers: keyed().headers,
    });
    await hit('checkoutAsset', 'POST', `/v1/assets/${asset.id}/checkout`, 412, {
      body: { person_id: person.body.id },
      headers: keyed('W/"1"').headers,
    });
    await hit(
      'listPersonAssignments',
      'GET',
      `/v1/people/${person.body.id}/assignments?state=all&limit=5`,
      200,
    );
    await hit('listPersonAssignments', 'GET', `/v1/people/${uuid()}/assignments`, 404);
    await hit(
      'listPersonAssignments',
      'GET',
      `/v1/people/${person.body.id}/assignments?state=nope`,
      400,
    );
    await hit('listPersonHistory', 'GET', `/v1/people/${person.body.id}/history?limit=5`, 200);
    await hit('listPersonHistory', 'GET', `/v1/people/${uuid()}/history`, 404);
    const other = await newPerson(t.admin);
    const room3 = await hit('createLocation', 'POST', '/v1/locations', 201, {
      body: { name: unique('Dock') },
    });
    await hit('transferAsset', 'POST', `/v1/assets/${asset.id}/transfer`, 201, {
      body: { person_id: other.id, reason: 'handover', to_location_id: room3.body.id },
      headers: keyed().headers,
    });
    await hit('transferAsset', 'POST', `/v1/assets/${asset.id}/transfer`, 422, {
      body: { person_id: other.id },
      headers: keyed().headers,
    });
    await hit('transferAsset', 'POST', `/v1/assets/${uuid()}/transfer`, 404, {
      body: { person_id: other.id },
      headers: keyed().headers,
    });
    await hit('transferAsset', 'POST', `/v1/assets/${asset.id}/transfer`, 400, {
      body: { person_id: person.body.id },
    });
    await hit('checkinAsset', 'POST', `/v1/assets/${asset.id}/checkin`, 200, {
      body: { note: 'back', attachment_ids: [await newPhoto(t.admin, asset.id)] },
      headers: keyed().headers,
    });
    await hit('checkinAsset', 'POST', `/v1/assets/${asset.id}/checkin`, 409, {
      body: {},
      headers: keyed().headers,
    });
    await hit('checkinAsset', 'POST', `/v1/assets/${asset.id}/checkin`, 422, {
      body: { status_id: 'x' },
      headers: keyed().headers,
    });
    await hit('checkinAsset', 'POST', `/v1/assets/${uuid()}/checkin`, 404, {
      body: {},
      headers: keyed().headers,
    });
    await hit('checkinAsset', 'POST', `/v1/assets/${asset.id}/checkin`, 400, { body: {} });

    // ---- clean up what the walk made (archive rules)
    await hit('archiveLocation', 'DELETE', `/v1/locations/${room3.body.id}`, 409, {
      headers: ifMatch('*').headers,
    }); // the asset sits there
    await hit('archiveLocation', 'DELETE', `/v1/locations/${room.body.id}`, 409, {
      headers: { 'if-match': '*' },
    }); // the person lives there
    const free = await hit('createLocation', 'POST', '/v1/locations', 201, {
      body: { name: unique('Free') },
    });
    await hit('archiveLocation', 'DELETE', `/v1/locations/${free.body.id}`, 204, {
      headers: { 'if-match': etag(free) },
    });
    await hit('archiveLocation', 'DELETE', `/v1/locations/${uuid()}`, 404, {
      headers: { 'if-match': '*' },
    });
    await hit('archiveLocation', 'DELETE', `/v1/locations/${free.body.id}`, 428);
    const spare = await newPerson(t.admin);
    await hit('archivePerson', 'DELETE', `/v1/people/${spare.id}`, 204, {
      headers: { 'if-match': '*' },
    });
    await hit('archivePerson', 'DELETE', `/v1/people/${uuid()}`, 404, {
      headers: { 'if-match': '*' },
    });
    // the person of a login account cannot be archived
    const login = (await t.admin.get(`/v1/people?q=${t.adminEmail}&has_login=true`)).body.data[0];
    await hit('archivePerson', 'DELETE', `/v1/people/${login.id}`, 409, {
      headers: { 'if-match': '*' },
    });
    expect(etag(person2)).toBeTruthy();
  });

  it('the walk covered every operation of the wave-1 tags', () => {
    const required = operations.filter((o) => WAVE1_TAGS.has(o.tag)).map((o) => o.operationId);
    expect(required.length).toBeGreaterThanOrEqual(15);
    expect(required.filter((id) => !walked.has(id))).toEqual([]);
  });
});
