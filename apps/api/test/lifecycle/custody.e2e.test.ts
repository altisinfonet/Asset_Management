import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled, env, withClient } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type App,
  type Basics,
  type Resp,
  type TenantFixture,
  auditRows,
  contractViolations,
  basics,
  createTenant,
  createUser,
  faults,
  historyOf,
  ifMatch,
  inDays,
  key,
  keyed,
  newAsset,
  newLocation,
  newPerson,
  newTenancy,
  outboxRows,
  ownerTenantSql,
  startRegistryApp,
  unique,
} from './support.js';

/**
 * M2-LIFE-01..06: custody (check-out, check-in, transfer), lost / found / disposal, overdue, and the
 * chain-of-custody history. One tenant for the whole file; every test makes its own assets.
 */
describe.skipIf(!dbEnabled)(`custody (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  let b: Basics;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'cust');
    other = await createTenant(app, tenancy, 'cust2');
    b = await basics(t);
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const stateType = async (assetId: string) =>
    (await a().get(`/v1/assets/${assetId}`)).body.status.state_type as string;

  describe('check-out (M2-LIFE-02)', () => {
    it('checks out to a person: 201 {asset, assignment}, the asset ETag, deployed status, current_assignment', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      const due = inDays(14);
      const res = await a().post(
        `/v1/assets/${asset.id}/checkout`,
        {
          person_id: person.id,
          expected_return: due,
          note: 'Exam week',
          attachment_ids: [randomUUID()],
        },
        keyed(asset.etag),
      );
      expect(res.status, res.raw).toBe(201);
      expect(res.body.asset).toMatchObject({
        id: asset.id,
        status: { name: 'Deployed', state_type: 'deployed' },
        current_assignment: {
          target_type: 'person',
          target_id: person.id,
          target_name: person.body.display_name,
          expected_return: due,
          overdue: false,
        },
      });
      expect(res.body.assignment).toMatchObject({
        asset_id: asset.id,
        person_id: person.id,
        location_id: null,
        target_asset_id: null,
        accessory_id: null,
        quantity: 1,
        quantity_returned: 0,
        checked_in_at: null,
        expected_return: due,
        acceptance_state: 'not_required',
        note: 'Exam week',
        overdue: false,
      });
      expect(res.body.assignment.attachment_ids).toHaveLength(1);
      expect(res.body.assignment.checked_out_by).toBeTruthy();
      // the ETag header is the asset's new version, and GET agrees
      const got = await a().get(`/v1/assets/${asset.id}`);
      expect(res.headers.etag).toBe(got.headers.etag);
      expect(res.headers.etag).not.toBe(asset.etag);
      expect(got.body.current_assignment.assignment_id).toBe(res.body.assignment.id);
      // lists show it, and the filters find it
      const ids = async (q: string) =>
        ((await a().get(`/v1/assets?${q}`)).body.data as Array<{ id: string }>).map((x) => x.id);
      expect(await ids(`assigned=true&assigned_person_id=${person.id}`)).toEqual([asset.id]);
      expect(await ids(`assigned=false&assigned_person_id=${person.id}`)).toEqual([]);
      expect(await ids(`q=${asset.body.asset_tag}&assigned=false`)).toEqual([]);
      expect(
        (await a().get(`/v1/assets?q=${asset.body.asset_tag}`)).body.data[0].current_assignment,
      ).toMatchObject({ target_id: person.id });
      expect((await a().get(`/v1/assets/${asset.id}/assignments`)).body.data).toHaveLength(1);
    });

    it('checks out to a location and to another asset', async () => {
      const room = await newLocation(a());
      const asset = await newAsset(a(), b.categoryId);
      const toRoom = await a().post(
        `/v1/assets/${asset.id}/checkout`,
        { location_id: room.id },
        keyed(),
      );
      expect(toRoom.status, toRoom.raw).toBe(201);
      expect(toRoom.body.assignment).toMatchObject({ location_id: room.id, person_id: null });
      expect(toRoom.body.asset.current_assignment).toMatchObject({
        target_type: 'location',
        target_name: room.body.name,
      });

      const cart = await newAsset(a(), b.categoryId, { name: 'Charging cart' });
      const laptop = await newAsset(a(), b.categoryId);
      const toAsset = await a().post(
        `/v1/assets/${laptop.id}/checkout`,
        { target_asset_id: cart.id },
        keyed(),
      );
      expect(toAsset.status, toAsset.raw).toBe(201);
      expect(toAsset.body.assignment).toMatchObject({ target_asset_id: cart.id });
      expect(toAsset.body.asset.current_assignment.target_name).toContain('Charging cart');
      // the cart cannot be checked out to the laptop it holds (cycle) nor to itself
      const cycle = await a().post(
        `/v1/assets/${cart.id}/checkout`,
        { target_asset_id: laptop.id },
        keyed(),
      );
      expect(cycle.status).toBe(422);
      expect(cycle.body.errors[0]).toMatchObject({ pointer: '/target_asset_id', code: 'cycle' });
      const self = await a().post(
        `/v1/assets/${cart.id}/checkout`,
        { target_asset_id: cart.id },
        keyed(),
      );
      expect(self.status).toBe(422);
    });

    it('validates the request: one target, existing people, locations, assets, dates, attachment ids', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const url = `/v1/assets/${asset.id}/checkout`;
      const post = (body: unknown) => a().post(url, body, keyed());
      expect((await post({})).status).toBe(422);
      expect((await post({ person_id: randomUUID(), location_id: randomUUID() })).status).toBe(422);
      const unknown = await post({ person_id: randomUUID() });
      expect(unknown.status).toBe(422);
      expect(unknown.body.errors[0]).toMatchObject({ pointer: '/person_id', code: 'not-found' });
      expect((await post({ location_id: randomUUID() })).status).toBe(422);
      expect((await post({ target_asset_id: randomUUID() })).status).toBe(422);
      expect((await post({ person_id: 'nope' })).status).toBe(422);
      const person = await newPerson(a());
      expect(
        (await post({ person_id: person.id, expected_return: '2020-01-01' })).body.errors[0],
      ).toMatchObject({ pointer: '/expected_return', code: 'in-the-past' });
      expect((await post({ person_id: person.id, expected_return: '2026-13-45' })).status).toBe(
        422,
      );
      expect((await post({ person_id: person.id, attachment_ids: ['not-a-uuid'] })).status).toBe(
        422,
      );
      expect(
        (
          await post({
            person_id: person.id,
            attachment_ids: Array.from({ length: 11 }, () => randomUUID()),
          })
        ).status,
      ).toBe(422);
      expect((await post({ person_id: person.id, surprise: 1 })).status).toBe(422);
      // other tenants' people / locations / assets are as good as missing
      const foreignPerson = await newPerson(other.admin);
      expect((await post({ person_id: foreignPerson.id })).status).toBe(422);
      const foreignAsset = await newAsset(other.admin, (await basics(other)).categoryId);
      expect((await post({ target_asset_id: foreignAsset.id })).status).toBe(422);
      expect(
        (
          await a().post(
            `/v1/assets/${foreignAsset.id}/checkout`,
            { person_id: person.id },
            keyed(),
          )
        ).status,
      ).toBe(404);
      expect(
        (await a().post(`/v1/assets/${randomUUID()}/checkout`, { person_id: person.id }, keyed()))
          .status,
      ).toBe(404);
      // nothing above wrote a thing
      expect((await a().get(`/v1/assets/${asset.id}/assignments`)).body.data).toEqual([]);
      expect((await a().get(`/v1/assets/${asset.id}`)).headers.etag).toBe(asset.etag);
      // acceptance_required creates a pending acceptance
      const pending = await post({ person_id: person.id, acceptance_required: true });
      expect(pending.body.assignment.acceptance_state).toBe('pending');
    });

    it('requires an Idempotency-Key; the same key replays the original answer and creates no second assignment', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      const url = `/v1/assets/${asset.id}/checkout`;
      const missing = await a().post(url, { person_id: person.id });
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('idempotency-key-required');
      const k = randomUUID();
      const first = await a().post(url, { person_id: person.id, note: 'once' }, key(k));
      expect(first.status).toBe(201);
      const replay = await a().post(url, { person_id: person.id, note: 'once' }, key(k));
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(replay.headers.etag).toBe(first.headers.etag);
      expect((await a().get(`/v1/assets/${asset.id}/assignments`)).body.data).toHaveLength(1);
      const reuse = await a().post(url, { person_id: person.id, note: 'different' }, key(k));
      expect(reuse.status).toBe(422);
      expect(reuse.body.code).toBe('idempotency-key-reuse');
      expect(
        await outboxRows(
          t.tenantId,
          `event_type = 'asset.checked_out' and aggregate_id = '${asset.id}'`,
        ),
      ).toHaveLength(1);
    });

    it('is optimistic: a stale If-Match is 412 and changes nothing, the current one passes', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      const url = `/v1/assets/${asset.id}/checkout`;
      const patched = await a().patch(
        `/v1/assets/${asset.id}`,
        { notes: 'edited' },
        ifMatch(asset.etag),
      );
      const stale = await a().post(url, { person_id: person.id }, keyed(asset.etag));
      expect(stale.status).toBe(412);
      expect(stale.body.code).toBe('precondition-failed');
      expect((await a().get(`/v1/assets/${asset.id}/assignments`)).body.data).toEqual([]);
      const fresh = await a().post(
        url,
        { person_id: person.id },
        keyed(String(patched.headers.etag)),
      );
      expect(fresh.status, fresh.raw).toBe(201);
      expect((await a().post(url, { person_id: person.id }, keyed('garbage'))).status).toBe(400);
    });

    it('only a deployable asset can be checked out: in repair, pending, lost and archived-type are 409 asset-not-deployable', async () => {
      const person = await newPerson(a());
      for (const [label, expected] of [
        ['In repair', 'asset-not-deployable'],
        ['Broken', 'asset-not-deployable'],
        ['Pending', 'asset-not-deployable'],
        ['Lost or stolen', 'asset-not-deployable'],
        ['Retired', 'asset-not-deployable'],
        ['Deployed', 'asset-not-deployable'], // "deployed" status but nobody holds it: still not deployable
      ] as const) {
        const asset = await newAsset(a(), b.categoryId, { status_id: b.status[label] });
        const res = await a().post(
          `/v1/assets/${asset.id}/checkout`,
          { person_id: person.id },
          keyed(),
        );
        expect(res.status, label).toBe(409);
        expect(res.body.code, label).toBe(expected);
      }
      // archived: 409 conflict
      const archived = await newAsset(a(), b.categoryId);
      await a().del(`/v1/assets/${archived.id}`, undefined, ifMatch(archived.etag));
      const res = await a().post(
        `/v1/assets/${archived.id}/checkout`,
        { person_id: person.id },
        keyed(),
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('conflict');
    });

    it('50 concurrent check-outs of one asset: exactly one 201, 49 clean 409 asset-already-checked-out, one assignment', async () => {
      const people = await Promise.all(Array.from({ length: 50 }, () => newPerson(a())));
      const asset = await newAsset(a(), b.categoryId);
      const results = await Promise.all(
        people.map((p) =>
          a().post(`/v1/assets/${asset.id}/checkout`, { person_id: p.id }, keyed()),
        ),
      );
      const statuses = results.map((r) => r.status);
      expect(
        statuses.filter((s) => s === 201),
        JSON.stringify(statuses),
      ).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(49);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.code).toBe('asset-already-checked-out');
      }
      const winner = results.find((r) => r.status === 201)!;
      const list = await a().get(`/v1/assets/${asset.id}/assignments`);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(winner.body.assignment.id);
      expect(
        (await historyOf(a(), asset.id)).filter((h) => h.event_type === 'checked_out'),
      ).toHaveLength(1);
      expect(
        await outboxRows(
          t.tenantId,
          `event_type = 'asset.checked_out' and aggregate_id = '${asset.id}'`,
        ),
      ).toHaveLength(1);
    });

    it('the database allows one open assignment per asset even without the application guard', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed());
      await expect(
        ownerTenantSql(
          t.tenantId,
          `insert into app.assignment (id, tenant_id, asset_id, person_id) values (gen_random_uuid(), $1, $2, $3)`,
          [t.tenantId, asset.id, person.id],
        ),
      ).rejects.toMatchObject({ code: '23505', constraint: 'assignment_one_open_per_asset_uq' });
    });

    it('writes the audit row, the outbox event and the history entry in the same transaction (a failing outbox rolls everything back)', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      const out = await a().post(
        `/v1/assets/${asset.id}/checkout`,
        { person_id: person.id, note: 'n' },
        keyed(),
      );
      const audit = await auditRows(
        t.tenantId,
        `action = 'asset.checked_out' and entity_id = '${asset.id}'`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.diff).toMatchObject({
        after: { holder: `person:${person.id}` },
        meta: { assignment_id: out.body.assignment.id, target_type: 'person', note: 'n' },
      });
      const event = (
        await outboxRows(
          t.tenantId,
          `event_type = 'asset.checked_out' and aggregate_id = '${asset.id}'`,
        )
      )[0]!;
      expect(event.payload).toMatchObject({
        assignmentId: out.body.assignment.id,
        personId: person.id,
      });
      expect(event.payload).not.toHaveProperty('note'); // ids only: no free text in the outbox

      // an outbox failure rolls back the custody, the audit row and the history entry with it
      const second = await newAsset(a(), b.categoryId);
      faults.outboxFailsFor = 'asset.checked_out';
      try {
        const failed = await a().post(
          `/v1/assets/${second.id}/checkout`,
          { person_id: person.id },
          keyed(),
        );
        expect(failed.status).toBe(500);
      } finally {
        faults.outboxFailsFor = null;
      }
      expect((await a().get(`/v1/assets/${second.id}`)).headers.etag).toBe(second.etag);
      expect((await a().get(`/v1/assets/${second.id}/assignments`)).body.data).toEqual([]);
      expect((await historyOf(a(), second.id)).map((h) => h.event_type)).toEqual(['created']);
      expect(
        await auditRows(t.tenantId, `action = 'asset.checked_out' and entity_id = '${second.id}'`),
      ).toEqual([]);
      // the same request, retried after the fault, works
      expect(
        (await a().post(`/v1/assets/${second.id}/checkout`, { person_id: person.id }, keyed()))
          .status,
      ).toBe(201);
    });
  });

  describe('check-in (M2-LIFE-03)', () => {
    it('closes the custody period: status back to ready, ETag, history, audit; replay is idempotent', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      const out = await a().post(
        `/v1/assets/${asset.id}/checkout`,
        { person_id: person.id },
        keyed(),
      );
      const k = randomUUID();
      const photo = randomUUID();
      const res = await a().post(
        `/v1/assets/${asset.id}/checkin`,
        { note: 'Returned with a scratch', attachment_ids: [photo] },
        keyed(String(out.headers.etag), k),
      );
      expect(res.status, res.raw).toBe(200);
      expect(res.body.asset).toMatchObject({
        status: { name: 'Ready to deploy', state_type: 'deployable' },
        current_assignment: null,
      });
      expect(res.body.assignment).toMatchObject({
        id: out.body.assignment.id,
        quantity_returned: 1,
        checkin_note: 'Returned with a scratch',
        checkin_attachment_ids: [photo],
        attachment_ids: [],
        overdue: false,
      });
      expect(res.body.assignment.checked_in_at).toBeTruthy();
      expect(res.body.assignment.checked_in_by).toBeTruthy();
      expect(res.headers.etag).toBe((await a().get(`/v1/assets/${asset.id}`)).headers.etag);
      // replay: same answer, no second close
      const replay = await a().post(
        `/v1/assets/${asset.id}/checkin`,
        { note: 'Returned with a scratch', attachment_ids: [photo] },
        key(k),
      );
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(res.body);
      // and the asset can be checked out again
      expect(
        (await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed()))
          .status,
      ).toBe(201);
      const list = await a().get(`/v1/assets/${asset.id}/assignments`);
      expect(list.body.data).toHaveLength(2);
      expect(list.body.data[0].checked_in_at).toBeNull(); // newest first
      const hist = await historyOf(a(), asset.id);
      const checkedIn = hist.find((h) => h.event_type === 'checked_in')!;
      expect(checkedIn.payload).toMatchObject({
        note: 'Returned with a scratch',
        attachment_ids: [photo],
        status: { from: 'Deployed', to: 'Ready to deploy' },
      });
    });

    it('a check-in without a check-out is a clear 409 asset-not-checked-out (also on replay)', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const k = randomUUID();
      const res = await a().post(`/v1/assets/${asset.id}/checkin`, {}, key(k));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'asset-not-checked-out' });
      expect(res.body.detail).toMatch(/not checked out/i);
      expect((await a().post(`/v1/assets/${asset.id}/checkin`, {}, key(k))).status).toBe(409);
      expect((await a().post(`/v1/assets/${asset.id}/checkin`, undefined, keyed())).status).toBe(
        409,
      ); // an empty body is fine too
      expect((await a().post(`/v1/assets/${randomUUID()}/checkin`, {}, keyed())).status).toBe(404);
      expect((await a().post(`/v1/assets/${asset.id}/checkin`, {})).body.code).toBe(
        'idempotency-key-required',
      );
    });

    it('can move the asset, choose the new status, and rejects invalid ones', async () => {
      const person = await newPerson(a());
      const room = await newLocation(a());
      const asset = await newAsset(a(), b.categoryId);
      await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed());
      expect(
        (
          await a().post(
            `/v1/assets/${asset.id}/checkin`,
            { status_id: b.status['Deployed'] },
            keyed(),
          )
        ).status,
      ).toBe(422);
      expect(
        (await a().post(`/v1/assets/${asset.id}/checkin`, { status_id: randomUUID() }, keyed()))
          .status,
      ).toBe(422);
      expect(
        (
          await a().post(
            `/v1/assets/${asset.id}/checkin`,
            { checkin_location_id: randomUUID() },
            keyed(),
          )
        ).status,
      ).toBe(422);
      expect(
        (await a().post(`/v1/assets/${asset.id}/checkin`, { attachment_ids: ['x'] }, keyed()))
          .status,
      ).toBe(422);
      const res = await a().post(
        `/v1/assets/${asset.id}/checkin`,
        { status_id: b.status['Broken'], checkin_location_id: room.id, note: 'dropped' },
        keyed(),
      );
      expect(res.status, res.raw).toBe(200);
      expect(res.body.asset).toMatchObject({
        location_id: room.id,
        status: { name: 'Broken', state_type: 'undeployable' },
      });
      expect(res.body.assignment).toMatchObject({ checkin_location_id: room.id });
      // a broken asset cannot go straight out again
      expect(
        (await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed())).body
          .code,
      ).toBe('asset-not-deployable');
    });

    it('overdue is derived from expected_return: computed on the assignment and the asset, filterable, cleared by check-in', async () => {
      const person = await newPerson(a());
      const late = await newAsset(a(), b.categoryId);
      const onTime = await newAsset(a(), b.categoryId);
      await a().post(
        `/v1/assets/${late.id}/checkout`,
        { person_id: person.id, expected_return: inDays(1) },
        keyed(),
      );
      await a().post(
        `/v1/assets/${onTime.id}/checkout`,
        { person_id: person.id, expected_return: inDays(30) },
        keyed(),
      );
      expect((await a().get(`/v1/assets/${late.id}`)).body.current_assignment.overdue).toBe(false);
      // the days pass (the API refuses a due date in the past, so age the row directly)
      await ownerTenantSql(
        t.tenantId,
        `update app.assignment set expected_return = current_date - 3 where asset_id = $1`,
        [late.id],
      );
      const got = await a().get(`/v1/assets/${late.id}`);
      expect(got.body.current_assignment.overdue).toBe(true);
      const ids = async (q: string) =>
        (
          (await a().get(`/v1/assets?assigned_person_id=${person.id}&${q}`)).body.data as Array<{
            id: string;
          }>
        ).map((x) => x.id);
      expect(await ids('overdue=true')).toEqual([late.id]);
      expect(await ids('overdue=false')).toEqual([onTime.id]);
      expect((await ids('')).sort()).toEqual([late.id, onTime.id].sort());
      const list = await a().get(`/v1/people/${person.id}/assignments`);
      expect(list.body.data.find((s: { asset_id: string }) => s.asset_id === late.id).overdue).toBe(
        true,
      );
      expect((await a().get(`/v1/assets/${late.id}/assignments`)).body.data[0].overdue).toBe(true);
      const back = await a().post(`/v1/assets/${late.id}/checkin`, {}, keyed());
      expect(back.body.assignment.overdue).toBe(false);
      expect(await ids('overdue=true')).toEqual([]);
    });
  });

  describe('transfer (M2-LIFE-04)', () => {
    it('hands over person to person, person to location and location to person in one transaction', async () => {
      const [ann, bob] = [await newPerson(a()), await newPerson(a())];
      const room = await newLocation(a());
      const asset = await newAsset(a(), b.categoryId);
      const out = await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: ann.id }, keyed());
      const first = await a().post(
        `/v1/assets/${asset.id}/transfer`,
        {
          person_id: bob.id,
          reason: 'Ann is leaving',
          note: 'with charger',
          expected_return: inDays(30),
        },
        keyed(String(out.headers.etag)),
      );
      expect(first.status, first.raw).toBe(201);
      expect(first.body.asset.current_assignment).toMatchObject({
        target_id: bob.id,
        assignment_id: first.body.assignment.id,
      });
      expect(first.body.assignment).toMatchObject({
        person_id: bob.id,
        checked_in_at: null,
        note: 'with charger',
      });
      expect(first.body.transfer).toMatchObject({
        asset_id: asset.id,
        from_assignment_id: out.body.assignment.id,
        to_assignment_id: first.body.assignment.id,
        reason: 'Ann is leaving',
      });
      expect(first.headers.etag).toBe((await a().get(`/v1/assets/${asset.id}`)).headers.etag);
      const closed = (await a().get(`/v1/assets/${asset.id}/assignments`)).body.data.find(
        (s: { id: string }) => s.id === out.body.assignment.id,
      );
      expect(closed).toMatchObject({ quantity_returned: 1, checkin_note: 'Ann is leaving' });
      expect(closed.checked_in_at).toBeTruthy();

      const toRoom = await a().post(
        `/v1/assets/${asset.id}/transfer`,
        { location_id: room.id, to_location_id: room.id },
        keyed(),
      );
      expect(toRoom.status, toRoom.raw).toBe(201);
      expect(toRoom.body.asset).toMatchObject({
        location_id: room.id,
        current_assignment: { target_type: 'location' },
      });
      expect(toRoom.body.transfer).toMatchObject({ to_location_id: room.id });
      const toPerson = await a().post(
        `/v1/assets/${asset.id}/transfer`,
        { person_id: ann.id },
        keyed(),
      );
      expect(toPerson.status).toBe(201);
      expect(toPerson.body.asset.current_assignment).toMatchObject({ target_id: ann.id });
      // never more than one open period, and the asset kept its deployed status throughout
      const open = (await a().get(`/v1/assets/${asset.id}/assignments`)).body.data.filter(
        (s: { checked_in_at: unknown }) => s.checked_in_at === null,
      );
      expect(open).toHaveLength(1);
      expect(await stateType(asset.id)).toBe('deployed');
    });

    it('writes ONE audit entry and ONE history event "transferred", plus the transfer row', async () => {
      const [ann, bob] = [await newPerson(a()), await newPerson(a())];
      const asset = await newAsset(a(), b.categoryId);
      await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: ann.id }, keyed());
      const res = await a().post(`/v1/assets/${asset.id}/transfer`, { person_id: bob.id }, keyed());
      const audit = await auditRows(
        t.tenantId,
        `entity_id = '${asset.id}' and action = 'asset.transferred'`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.diff).toMatchObject({
        meta: { transfer_id: res.body.transfer.id, to: { id: bob.id } },
      });
      const events = (await historyOf(a(), asset.id)).filter((h) => h.event_type === 'transferred');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        transfer_id: res.body.transfer.id,
        assignment_id: res.body.assignment.id,
      });
      expect(events[0]!.payload).toMatchObject({ from: { id: ann.id }, to: { id: bob.id } });
      expect(
        await outboxRows(
          t.tenantId,
          `event_type = 'asset.transferred' and aggregate_id = '${asset.id}'`,
        ),
      ).toHaveLength(1);
    });

    it('out of stock a transfer is a check-out (deployable only); same holder, bad targets and states are refused', async () => {
      const [ann, bob] = [await newPerson(a()), await newPerson(a())];
      const asset = await newAsset(a(), b.categoryId);
      const first = await a().post(
        `/v1/assets/${asset.id}/transfer`,
        { person_id: ann.id },
        keyed(),
      );
      expect(first.status, first.raw).toBe(201);
      expect(first.body.transfer.from_assignment_id).toBeNull();
      expect(first.body.asset.status.state_type).toBe('deployed');
      const same = await a().post(
        `/v1/assets/${asset.id}/transfer`,
        { person_id: ann.id },
        keyed(),
      );
      expect(same.status).toBe(422);
      expect(same.body.errors[0]).toMatchObject({ pointer: '/person_id', code: 'same-holder' });
      expect(
        (await a().post(`/v1/assets/${asset.id}/transfer`, { person_id: randomUUID() }, keyed()))
          .status,
      ).toBe(422);
      expect(
        (
          await a().post(
            `/v1/assets/${asset.id}/transfer`,
            { person_id: bob.id, to_location_id: randomUUID() },
            keyed(),
          )
        ).status,
      ).toBe(422);
      expect((await a().post(`/v1/assets/${asset.id}/transfer`, {}, keyed())).status).toBe(422);
      const broken = await newAsset(a(), b.categoryId, { status_id: b.status['Broken'] });
      expect(
        (await a().post(`/v1/assets/${broken.id}/transfer`, { person_id: ann.id }, keyed())).body
          .code,
      ).toBe('asset-not-deployable');
      expect(
        (await a().post(`/v1/assets/${randomUUID()}/transfer`, { person_id: ann.id }, keyed()))
          .status,
      ).toBe(404);
      expect(
        (await a().post(`/v1/assets/${asset.id}/transfer`, { person_id: bob.id }, ifMatch('W/"1"')))
          .body.code,
      ).toBe('idempotency-key-required');
      expect(
        (await a().post(`/v1/assets/${asset.id}/transfer`, { person_id: bob.id }, keyed('W/"1"')))
          .status,
      ).toBe(412);
    });

    it('a failure in either half rolls back both: the asset is never left unassigned', async () => {
      const [ann, bob] = [await newPerson(a()), await newPerson(a())];
      const asset = await newAsset(a(), b.categoryId);
      const out = await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: ann.id }, keyed());
      const before = (await a().get(`/v1/assets/${asset.id}`)).headers.etag;
      const boom = `boom-${randomUUID()}`;
      // a trigger that fails the NEW assignment's insert (the second half of the transfer)
      await withClient(env.migratorUrl!, async (c) => {
        await c.query(`create or replace function app.test_assignment_boom() returns trigger language plpgsql as $$
          begin if new.note like 'boom-%' then raise exception 'injected failure' using errcode = 'P0001'; end if; return new; end $$`);
        await c.query(`drop trigger if exists test_assignment_boom on app.assignment`);
        await c.query(
          `create trigger test_assignment_boom before insert on app.assignment for each row execute function app.test_assignment_boom()`,
        );
      });
      try {
        const res = await a().post(
          `/v1/assets/${asset.id}/transfer`,
          { person_id: bob.id, note: boom },
          keyed(),
        );
        expect(res.status).toBe(500);
      } finally {
        await withClient(env.migratorUrl!, async (c) => {
          await c.query(`drop trigger if exists test_assignment_boom on app.assignment`);
          await c.query(`drop function if exists app.test_assignment_boom()`);
        });
      }
      // the first half (closing Ann's period) did not stick, nothing else was written
      const after = await a().get(`/v1/assets/${asset.id}`);
      expect(after.headers.etag).toBe(before);
      expect(after.body.current_assignment).toMatchObject({
        assignment_id: out.body.assignment.id,
        target_id: ann.id,
      });
      const list = (await a().get(`/v1/assets/${asset.id}/assignments`)).body.data;
      expect(list).toHaveLength(1);
      expect(list[0].checked_in_at).toBeNull();
      expect((await historyOf(a(), asset.id)).map((h) => h.event_type)).toEqual([
        'created',
        'checked_out',
      ]);
      expect(
        await auditRows(t.tenantId, `entity_id = '${asset.id}' and action = 'asset.transferred'`),
      ).toEqual([]);
    });
  });

  describe('lost, found, disposal (M2-LIFE-05)', () => {
    it('mark lost closes the custody, lost assets cannot be checked out, found returns them to a ready status', async () => {
      const person = await newPerson(a());
      const room = await newLocation(a());
      const asset = await newAsset(a(), b.categoryId);
      const out = await a().post(
        `/v1/assets/${asset.id}/checkout`,
        { person_id: person.id },
        keyed(),
      );
      const lost = await a().post(
        `/v1/assets/${asset.id}/mark-lost`,
        { note: 'left on the bus' },
        ifMatch(String(out.headers.etag)),
      );
      expect(lost.status, lost.raw).toBe(200);
      expect(lost.body).toMatchObject({
        status: { name: 'Lost or stolen', state_type: 'lost' },
        current_assignment: null,
      });
      expect(lost.headers.etag).toBeTruthy();
      const closed = (await a().get(`/v1/assets/${asset.id}/assignments`)).body.data[0];
      expect(closed.checked_in_at).toBeTruthy();
      expect(closed.checkin_note).toBe('Marked lost: left on the bus');
      expect(
        (await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed())).body
          .code,
      ).toBe('asset-not-deployable');
      expect((await a().post(`/v1/assets/${asset.id}/mark-lost`, {})).status).toBe(409);
      expect((await a().post(`/v1/assets/${asset.id}/dispose`, { reason: 'stolen' })).status).toBe(
        200,
      ); // a lost asset can be written off
      // second asset: found
      const second = await newAsset(a(), b.categoryId);
      expect((await a().post(`/v1/assets/${second.id}/mark-found`, {})).status).toBe(409); // not lost
      await a().post(`/v1/assets/${second.id}/mark-lost`);
      const found = await a().post(`/v1/assets/${second.id}/mark-found`, {
        location_id: room.id,
        note: 'in the lost property box',
      });
      expect(found.status, found.raw).toBe(200);
      expect(found.body).toMatchObject({
        status: { state_type: 'deployable' },
        location_id: room.id,
      });
      expect((await a().post(`/v1/assets/${second.id}/mark-found`, {})).status).toBe(409);
      expect(
        (
          await a().post(
            `/v1/assets/${second.id}/mark-found`,
            { status_id: b.status['Broken'] },
            ifMatch('*'),
          )
        ).status,
      ).toBe(409);
      const hist = (await historyOf(a(), second.id)).map(
        (h) => `${h.event_type}:${h.payload.action ?? ''}`,
      );
      expect(hist).toEqual([
        'created:',
        'status_changed:lost',
        'status_changed:found',
        'location_changed:',
      ]);
      expect(
        await auditRows(
          t.tenantId,
          `entity_id = '${second.id}' and action in ('asset.marked_lost','asset.marked_found')`,
        ),
      ).toHaveLength(2);
      // validation of the optional status
      const third = await newAsset(a(), b.categoryId);
      expect(
        (await a().post(`/v1/assets/${third.id}/mark-lost`, { status_id: b.status['Retired'] }))
          .status,
      ).toBe(422);
      expect(
        (
          await a().post(`/v1/assets/${third.id}/mark-lost`, {
            status_id: b.status['Lost or stolen'],
          })
        ).status,
      ).toBe(200);
      expect(
        (await a().post(`/v1/assets/${third.id}/mark-found`, { status_id: b.status['Deployed'] }))
          .status,
      ).toBe(422);
    });

    it('disposal records reason, note and date, archives the asset and hides it from default lists; restore takes it back', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId, { name: 'Old laptop' });
      await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed());
      const blocked = await a().post(`/v1/assets/${asset.id}/dispose`, { reason: 'recycled' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('asset-already-checked-out');
      await a().post(`/v1/assets/${asset.id}/checkin`, {}, keyed());
      const bad = await a().post(`/v1/assets/${asset.id}/dispose`, { reason: 'lunch' });
      expect(bad.status).toBe(422);
      expect(
        (
          await a().post(`/v1/assets/${asset.id}/dispose`, {
            reason: 'sold',
            status_id: b.status['Deployed'],
          })
        ).status,
      ).toBe(422);
      const res = await a().post(`/v1/assets/${asset.id}/dispose`, {
        reason: 'recycled',
        note: 'certificate R-1',
        disposed_on: '2026-10-01',
      });
      expect(res.status, res.raw).toBe(200);
      expect(res.body).toMatchObject({
        status: { name: 'Retired', state_type: 'archived' },
        disposal: { disposed_on: '2026-10-01', reason: 'recycled', note: 'certificate R-1' },
      });
      expect(res.body.archived_at).toBeTruthy();
      const ids = async (q: string) =>
        (
          (await a().get(`/v1/assets?q=${asset.body.asset_tag}&${q}`)).body.data as Array<{
            id: string;
          }>
        ).map((x) => x.id);
      expect(await ids('')).toEqual([]); // hidden from the default list
      expect(await ids('archived=only')).toEqual([asset.id]);
      expect((await a().post(`/v1/assets/${asset.id}/dispose`, { reason: 'sold' })).status).toBe(
        409,
      ); // already archived
      expect((await a().post(`/v1/assets/${asset.id}/mark-lost`, {})).status).toBe(409);
      expect((await a().post(`/v1/assets/${asset.id}/move`, { location_id: null })).status).toBe(
        409,
      );
      const hist = await historyOf(a(), asset.id);
      expect(hist.at(-1)).toMatchObject({
        event_type: 'archived',
        summary: 'Disposed of (recycled)',
      });
      expect(
        await auditRows(t.tenantId, `entity_id = '${asset.id}' and action = 'asset.disposed'`),
      ).toHaveLength(1);
      // restoring a disposed asset clears the disposal and gives it a usable status again
      const etag = (await a().get(`/v1/assets/${asset.id}`)).headers.etag;
      const restored = await a().post(`/v1/assets/${asset.id}/restore`, undefined, ifMatch(etag));
      expect(restored.status, restored.raw).toBe(200);
      expect(restored.body).toMatchObject({
        disposal: null,
        archived_at: null,
        status: { state_type: 'deployable' },
      });
    });

    it('an asset in somebody custody cannot be archived; disposal needs asset:delete', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      const out = await a().post(
        `/v1/assets/${asset.id}/checkout`,
        { person_id: person.id },
        keyed(),
      );
      const archive = await a().del(
        `/v1/assets/${asset.id}`,
        undefined,
        ifMatch(String(out.headers.etag)),
      );
      expect(archive.status).toBe(409);
      expect(archive.body.detail).toMatch(/checked out/i);
      const bulk = await a().post('/v1/assets/bulk-archive', { ids: [asset.id] });
      expect(bulk.body.results[0].status).toBe(409);
      const tech = await createUser(app, t, 'technician');
      expect(
        (await tech.client.post(`/v1/assets/${asset.id}/dispose`, { reason: 'sold' })).status,
      ).toBe(403);
      expect((await tech.client.post(`/v1/assets/${asset.id}/mark-lost`, {})).status).toBe(200);
    });
  });

  describe('chain-of-custody history (M2-LIFE-06)', () => {
    it('returns the unified timeline newest first with the actor, pagination, filters and a date window', async () => {
      const [ann, bob] = [await newPerson(a()), await newPerson(a())];
      const room = await newLocation(a());
      const asset = await newAsset(a(), b.categoryId);
      await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: ann.id }, keyed());
      await a().post(`/v1/assets/${asset.id}/transfer`, { person_id: bob.id }, keyed());
      await a().post(`/v1/assets/${asset.id}/checkin`, { checkin_location_id: room.id }, keyed());
      const p = await a().get(`/v1/assets/${asset.id}`);
      await a().patch(
        `/v1/assets/${asset.id}`,
        { status_id: b.status['In repair'] },
        ifMatch(p.headers.etag),
      );
      await a().post(`/v1/assets/${asset.id}/move`, { location_id: null });

      const all = await a().get(`/v1/assets/${asset.id}/history`);
      expect(all.status).toBe(200);
      expect(all.body.data.map((h: { event_type: string }) => h.event_type)).toEqual([
        'location_changed',
        'status_changed',
        'checked_in',
        'transferred',
        'checked_out',
        'created',
      ]);
      expect(all.body.data[0].actor).toMatchObject({ display_name: 'Admin cust' });
      expect(all.body.data[0]).toMatchObject({ actor_type: 'user', asset_id: asset.id });
      expect(all.body.data[0].actor.id).toBe(all.body.data[0].actor_id);
      // keyset pages of 2 cover everything exactly once, in order
      const ids: string[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page: Resp = await a().get(
          `/v1/assets/${asset.id}/history?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        );
        ids.push(...page.body.data.map((h: { id: string }) => h.id));
        cursor = page.body.page.next_cursor;
        if (!cursor) break;
      }
      expect(ids).toEqual(all.body.data.map((h: { id: string }) => h.id));
      expect((await a().get(`/v1/assets/${asset.id}/history?limit=2&cursor=junk`)).body.code).toBe(
        'invalid-cursor',
      );
      // a cursor issued under one filter is refused under another
      const first = await a().get(`/v1/assets/${asset.id}/history?limit=1`);
      expect(
        (
          await a().get(
            `/v1/assets/${asset.id}/history?limit=1&event_type=created&cursor=${first.body.page.next_cursor}`,
          )
        ).body.code,
      ).toBe('invalid-cursor');
      const some = await a().get(
        `/v1/assets/${asset.id}/history?event_type=checked_out,checked_in`,
      );
      expect(some.body.data.map((h: { event_type: string }) => h.event_type)).toEqual([
        'checked_in',
        'checked_out',
      ]);
      expect((await a().get(`/v1/assets/${asset.id}/history?event_type=bogus`)).status).toBe(400);
      const oldest = all.body.data.at(-1).at as string;
      expect(
        (await a().get(`/v1/assets/${asset.id}/history?to=${encodeURIComponent(oldest)}`)).body
          .data,
      ).toEqual([]);
      expect(
        (await a().get(`/v1/assets/${asset.id}/history?from=${encodeURIComponent(oldest)}`)).body
          .data,
      ).toHaveLength(6);
      expect((await a().get(`/v1/assets/${asset.id}/history?from=yesterday`)).status).toBe(400);
      expect((await other.admin.get(`/v1/assets/${asset.id}/history`)).status).toBe(404);
    });

    it('timeline entries are reproducible from the audit rows (a test rebuilds it and compares)', async () => {
      const [ann, bob] = [await newPerson(a()), await newPerson(a())];
      const room = await newLocation(a());
      const asset = await newAsset(a(), b.categoryId, { location_id: room.id });
      const etagOf = async () => String((await a().get(`/v1/assets/${asset.id}`)).headers.etag);
      await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: ann.id }, keyed());
      await a().post(`/v1/assets/${asset.id}/transfer`, { person_id: bob.id }, keyed());
      await a().post(`/v1/assets/${asset.id}/checkin`, {}, keyed());
      await a().patch(
        `/v1/assets/${asset.id}`,
        { name: 'Renamed', location_id: null },
        ifMatch(await etagOf()),
      );
      await a().post(`/v1/assets/${asset.id}/mark-lost`, {});
      await a().post(`/v1/assets/${asset.id}/mark-found`, { location_id: room.id });
      await a().post(`/v1/assets/${asset.id}/move`, { location_id: null });
      await a().post(`/v1/assets/${asset.id}/dispose`, { reason: 'scrapped' });
      await a().post(`/v1/assets/${asset.id}/restore`, undefined, ifMatch(await etagOf()));

      const audit = await auditRows(
        t.tenantId,
        `entity_type = 'asset' and entity_id = '${asset.id}'`,
      );
      const rebuilt: string[] = [];
      for (const row of audit) {
        const verb = row.action.replace('asset.', '');
        const before = (row.diff?.before ?? {}) as Record<string, unknown>;
        const after = (row.diff?.after ?? {}) as Record<string, unknown>;
        const changed = new Set(Object.keys(after));
        if (verb === 'created') rebuilt.push('created');
        else if (verb === 'checked_out') rebuilt.push('checked_out');
        else if (verb === 'checked_in') rebuilt.push('checked_in');
        else if (verb === 'transferred') rebuilt.push('transferred');
        else if (verb === 'moved') rebuilt.push('location_changed');
        else if (verb === 'disposed') rebuilt.push('archived');
        else if (verb === 'archived') rebuilt.push('archived');
        else if (verb === 'restored') rebuilt.push('restored');
        else if (verb === 'marked_lost') rebuilt.push('status_changed');
        else if (verb === 'marked_found') {
          rebuilt.push('status_changed');
          if (before.location_id !== after.location_id) rebuilt.push('location_changed');
        } else if (verb === 'updated') {
          if (changed.has('status_id')) rebuilt.push('status_changed');
          if (changed.has('location_id')) rebuilt.push('location_changed');
          if ([...changed].some((k) => k !== 'status_id' && k !== 'location_id'))
            rebuilt.push('updated');
        } else throw new Error(`unmapped audit action ${row.action}`);
      }
      const history = (await historyOf(a(), asset.id)).map((h) => h.event_type);
      expect(history).toEqual(rebuilt);
      // and every history row carries the request id of the audit row of its change
      const requestIds = new Set(audit.map((r) => r.request_id));
      const rows = await ownerTenantSql(
        t.tenantId,
        `select request_id from app.asset_history where asset_id = $1`,
        [asset.id],
      );
      for (const r of rows.rows)
        expect(requestIds.has(r.request_id), String(r.request_id)).toBe(true);
    });

    it('the history of an API-key action names the key; read access follows asset:read', async () => {
      const key2 = await a().post('/v1/api-keys', {
        name: 'Robot',
        scopes: ['asset:update', 'asset:read'],
      });
      const asset = await newAsset(a(), b.categoryId);
      const bearer = {
        headers: { authorization: `Bearer ${key2.body.secret}` },
        cookie: false,
      } as const;
      const moved = await t.admin
        .clone()
        .post(`/v1/assets/${asset.id}/move`, { location_id: null }, bearer);
      expect(moved.status, moved.raw).toBe(200);
      const dummy = await newLocation(a());
      await t.admin.clone().post(`/v1/assets/${asset.id}/move`, { location_id: dummy.id }, bearer);
      const hist = await a().get(`/v1/assets/${asset.id}/history`);
      expect(hist.body.data[0]).toMatchObject({
        actor_type: 'api_key',
        actor: { display_name: 'Robot' },
      });
      const viewer = await createUser(app, t, 'viewer');
      expect((await viewer.client.get(`/v1/assets/${asset.id}/history`)).status).toBe(200);
      expect((await viewer.client.get(`/v1/assets/${asset.id}/assignments`)).status).toBe(200);
    });

    it('rows land in the monthly partition of their timestamp (and the default partition catches the rest)', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const rows = await ownerTenantSql(
        t.tenantId,
        `select tableoid::regclass::text as part, to_char(at at time zone 'UTC', 'YYYY_MM') as ym from app.asset_history where asset_id = $1`,
        [asset.id],
      );
      expect(rows.rows[0].part).toBe(`asset_history_${rows.rows[0].ym}`);
      // a row dated far in the past or future lands in the default partition
      await ownerTenantSql(
        t.tenantId,
        `insert into app.asset_history (id, tenant_id, asset_id, at, event_type, summary) values (gen_random_uuid(), $1, $2, '2000-01-15', 'imported', 'old')`,
        [t.tenantId, asset.id],
      );
      const old = await ownerTenantSql(
        t.tenantId,
        `select tableoid::regclass::text as part from app.asset_history where summary = 'old' and asset_id = $1`,
        [asset.id],
      );
      expect(old.rows[0].part).toBe('asset_history_default');
      // the timeline still lists it (oldest)
      expect((await historyOf(a(), asset.id))[0]).toMatchObject({ event_type: 'imported' });
    });
  });

  describe('permissions', () => {
    it('technicians check out, in and transfer; viewers and auditors cannot; API keys need the scope', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      const tech = await createUser(app, t, 'technician');
      const viewer = await createUser(app, t, 'viewer');
      const out = await tech.client.post(
        `/v1/assets/${asset.id}/checkout`,
        { person_id: person.id },
        keyed(),
      );
      expect(out.status, out.raw).toBe(201);
      expect((await viewer.client.post(`/v1/assets/${asset.id}/checkin`, {}, keyed())).status).toBe(
        403,
      );
      expect(
        (
          await viewer.client.post(
            `/v1/assets/${asset.id}/transfer`,
            { person_id: person.id },
            keyed(),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await viewer.client.post(
            `/v1/assets/${asset.id}/checkout`,
            { person_id: person.id },
            keyed(),
          )
        ).status,
      ).toBe(403);
      expect((await tech.client.post(`/v1/assets/${asset.id}/checkin`, {}, keyed())).status).toBe(
        200,
      );
      const scoped = await a().post('/v1/api-keys', { name: 'only-read', scopes: ['asset:read'] });
      const bearer = {
        headers: { authorization: `Bearer ${scoped.body.secret}`, 'idempotency-key': randomUUID() },
        cookie: false,
      } as const;
      expect(
        (
          await tech.client
            .clone()
            .post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, bearer)
        ).status,
      ).toBe(403);
      const ok = await a().post('/v1/api-keys', {
        name: 'checkout',
        scopes: ['asset:checkout', 'asset:read'],
      });
      const bearer2 = {
        headers: { authorization: `Bearer ${ok.body.secret}`, 'idempotency-key': randomUUID() },
        cookie: false,
      } as const;
      expect(
        (
          await tech.client
            .clone()
            .post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, bearer2)
        ).status,
      ).toBe(201);
    });

    it('scan resolve lists the actions valid right now for the caller', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      const tech = await createUser(app, t, 'technician');
      const viewer = await createUser(app, t, 'viewer');
      const actions = async (c: typeof tech.client) =>
        (await c.get(`/v1/scan/resolve?code=${asset.body.label_code}`)).body
          .allowed_actions as string[];
      expect(await actions(tech.client)).toEqual(['checkout', 'transfer', 'update']);
      await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed());
      expect(await actions(tech.client)).toEqual(['checkin', 'transfer', 'update']);
      expect(await actions(viewer.client)).toEqual([]);
      await a().post(`/v1/assets/${asset.id}/checkin`, { status_id: b.status['Broken'] }, keyed());
      expect(await actions(tech.client)).toEqual(['update']);
      expect(unique('x')).toBeTruthy();
    });
  });
});
