import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type App,
  type Basics,
  type Json,
  type Resp,
  type TenantFixture,
  auditRows,
  basics,
  contractViolations,
  createTenant,
  createUser,
  historyOf,
  inDays,
  key,
  newAsset,
  newLocation,
  newPerson,
  newTenancy,
  outboxRows,
  ownerTenantSql,
  startRegistryApp,
} from './support.js';

/**
 * M2-UX-02 (ED-23): `POST /v1/assets/{id}/undo-custody`. The undo is the inverse action in one
 * transaction (never a delete): the original event, assignment and audit row stay and a
 * `custody_undone` event, an audit row and a new asset version are added. Guarded by `If-Match`
 * (the ETag the action answered with), the newest history event, a five minute window and the
 * permission of the reversed action.
 */
describe.skipIf(!dbEnabled)(`undo of a custody action (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  let b: Basics;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'undo');
    other = await createTenant(app, tenancy, 'undo2');
    b = await basics(t);
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const etagOf = (res: Resp) => String(res.headers.etag);
  const undo = (
    assetId: string,
    assignmentId: string,
    etag: string,
    idem = randomUUID(),
    as = a(),
  ) =>
    as.post(
      `/v1/assets/${assetId}/undo-custody`,
      { assignment_id: assignmentId },
      { headers: { 'idempotency-key': idem, 'if-match': etag } },
    );
  const assetNow = async (id: string) => (await a().get(`/v1/assets/${id}`)).body as Json;
  const statusName = async (id: string) => (await assetNow(id)).status.name as string;

  async function checkedOut(extra: Record<string, unknown> = {}) {
    const asset = await newAsset(a(), b.categoryId);
    const person = await newPerson(a());
    const res = await a().post(
      `/v1/assets/${asset.id}/checkout`,
      { person_id: person.id, expected_return: inDays(7), ...extra },
      key(),
    );
    expect(res.status, res.raw).toBe(201);
    return { asset, person, res, assignmentId: res.body.assignment.id as string };
  }

  it('undoes a check-out: the asset is back in stock with its status, the period is closed, both events stay', async () => {
    const before = await newAsset(a(), b.categoryId);
    const beforeStatus = await statusName(before.id);
    const person = await newPerson(a());
    const out = await a().post(`/v1/assets/${before.id}/checkout`, { person_id: person.id }, key());
    expect(await statusName(before.id)).toBe('Deployed');

    const res = await undo(before.id, out.body.assignment.id, etagOf(out));
    expect(res.status, res.raw).toBe(200);
    expect(res.body.undone).toBe('checkout');
    expect(res.body.asset).toMatchObject({
      id: before.id,
      current_assignment: null,
      status: { name: beforeStatus },
    });
    expect(res.body.assignment).toMatchObject({
      id: out.body.assignment.id,
      checkin_note: 'Undo of check-out',
    });
    expect(res.body.assignment.checked_in_at).toBeTruthy();
    expect(etagOf(res)).not.toBe(etagOf(out));
    expect(await statusName(before.id)).toBe(beforeStatus);

    // history: the check-out is still there, the undo is its own event, linked to the assignment
    const events = await historyOf(a(), before.id);
    expect(events.map((e) => e.event_type).slice(-2)).toEqual(['checked_out', 'custody_undone']);
    const last = events.at(-1)!;
    expect(last).toMatchObject({
      assignment_id: out.body.assignment.id,
      payload: { undone: 'checkout', undone_assignment_id: out.body.assignment.id },
    });
    expect(last.payload.status).toMatchObject({ from: 'Deployed', to: beforeStatus });
    // audit and outbox, in the same transaction; the person page shows both events too
    const audit = await auditRows(
      t.tenantId,
      `action = 'asset.custody_undone' and entity_id = '${before.id}'`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.diff?.meta).toMatchObject({ undone: 'checkout' });
    expect(
      await outboxRows(
        t.tenantId,
        `event_type = 'asset.custody_undone' and aggregate_id = '${before.id}'`,
      ),
    ).toHaveLength(1);
    const personHistory = await a().get(`/v1/people/${person.id}/history`);
    expect(personHistory.body.data.map((e: Json) => e.event_type).slice(0, 2)).toEqual([
      'custody_undone',
      'checked_out',
    ]);
  });

  it('undoes a check-in: the same holder has the asset again (a new assignment), status and location are restored', async () => {
    const here = await newLocation(a());
    const there = await newLocation(a());
    const asset = await newAsset(a(), b.categoryId, { location_id: here.id });
    const person = await newPerson(a());
    const due = inDays(10);
    const out = await a().post(
      `/v1/assets/${asset.id}/checkout`,
      { person_id: person.id, expected_return: due, note: 'Exam week' },
      key(),
    );
    const back = await a().post(
      `/v1/assets/${asset.id}/checkin`,
      { checkin_location_id: there.id, condition: 'fair' },
      key(),
    );
    expect(back.status, back.raw).toBe(200);
    expect((await assetNow(asset.id)).location_id).toBe(there.id);

    const res = await undo(asset.id, back.body.assignment.id, etagOf(back));
    expect(res.status, res.raw).toBe(200);
    expect(res.body.undone).toBe('checkin');
    // the holder again, a NEW period with the same due date and note; location and status as before
    expect(res.body.assignment.id).not.toBe(out.body.assignment.id);
    expect(res.body.assignment).toMatchObject({
      person_id: person.id,
      expected_return: due,
      note: 'Exam week',
      checked_in_at: null,
    });
    expect(res.body.asset).toMatchObject({
      location_id: here.id,
      status: { name: 'Deployed' },
      current_assignment: { target_id: person.id, assignment_id: res.body.assignment.id },
    });
    // the closed period of the check-in stays closed (a closed period is never re-opened)
    const periods = await a().get(`/v1/assets/${asset.id}/assignments`);
    expect(periods.body.data).toHaveLength(2);
    const old = periods.body.data.find((p: Json) => p.id === out.body.assignment.id);
    expect(old.checked_in_at).toBeTruthy();
    const events = (await historyOf(a(), asset.id)).map((e) => e.event_type);
    expect(events.slice(-3)).toEqual(['checked_out', 'checked_in', 'custody_undone']);
  });

  it('undoes a transfer between holders: the previous holder has it back, the other period is closed', async () => {
    const { asset, person, assignmentId } = await checkedOut();
    const heir = await newPerson(a());
    const moved = await a().post(`/v1/assets/${asset.id}/transfer`, { person_id: heir.id }, key());
    expect(moved.status).toBe(201);

    const res = await undo(asset.id, moved.body.assignment.id, etagOf(moved));
    expect(res.status, res.raw).toBe(200);
    expect(res.body.undone).toBe('transfer');
    expect(res.body.assignment).toMatchObject({ person_id: person.id, checked_in_at: null });
    expect(res.body.assignment.id).not.toBe(assignmentId);
    expect(res.body.asset.current_assignment).toMatchObject({ target_id: person.id });
    // the transfer to the heir is closed and a reversing transfer record exists
    const closed = (await a().get(`/v1/assets/${asset.id}/assignments`)).body.data.find(
      (p: Json) => p.id === moved.body.assignment.id,
    );
    expect(closed.checked_in_at).toBeTruthy();
    const rows = await ownerTenantSql(
      t.tenantId,
      'select from_assignment_id, to_assignment_id, reason from app.transfer where asset_id = $1 order by transferred_at',
      [asset.id],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[1]).toMatchObject({
      from_assignment_id: moved.body.assignment.id,
      to_assignment_id: res.body.assignment.id,
      reason: 'Undo of transfer',
    });
  });

  it('undoes a transfer out of stock like a check-out (status restored)', async () => {
    const asset = await newAsset(a(), b.categoryId);
    const before = await statusName(asset.id);
    const person = await newPerson(a());
    const moved = await a().post(
      `/v1/assets/${asset.id}/transfer`,
      { person_id: person.id },
      key(),
    );
    expect(moved.status).toBe(201);
    const res = await undo(asset.id, moved.body.assignment.id, etagOf(moved));
    expect(res.status, res.raw).toBe(200);
    expect(res.body.asset).toMatchObject({ current_assignment: null, status: { name: before } });
  });

  it('refuses when the asset changed after the action: 412 for a stale ETag, 409 when another event came first', async () => {
    const { asset, res: out, assignmentId } = await checkedOut();
    // an edit after the check-out bumps the version: the ETag the action answered with is stale
    const edited = await a().patch(
      `/v1/assets/${asset.id}`,
      { notes: 'edited' },
      { headers: { 'if-match': etagOf(out) } },
    );
    expect(edited.status, edited.raw).toBe(200);
    const stale = await undo(asset.id, assignmentId, etagOf(out));
    expect(stale.status).toBe(412);
    // even with the current ETag the newest event is not the check-out any more
    const current = await undo(asset.id, assignmentId, etagOf(edited));
    expect(current.status).toBe(409);
    expect(current.body.code).toBe('undo-asset-changed');
    // nothing changed
    expect((await assetNow(asset.id)).current_assignment).toMatchObject({
      assignment_id: assignmentId,
    });
  });

  it('refuses a transfer that moved on: undoing the first action of two is a 409/412, only the last one can be undone', async () => {
    const { asset, res: out, assignmentId } = await checkedOut();
    const heir = await newPerson(a());
    const moved = await a().post(`/v1/assets/${asset.id}/transfer`, { person_id: heir.id }, key());
    const first = await undo(asset.id, assignmentId, etagOf(out));
    expect(first.status).toBe(412);
    const firstFresh = await undo(asset.id, assignmentId, etagOf(moved));
    expect(firstFresh.status).toBe(409);
    expect(firstFresh.body.code).toBe('undo-asset-changed');
  });

  it('answers a repeated request from the idempotency store, and a second undo with a new key is 409 undo-not-possible', async () => {
    const { asset, res: out, assignmentId } = await checkedOut();
    const idem = randomUUID();
    const first = await undo(asset.id, assignmentId, etagOf(out), idem);
    expect(first.status).toBe(200);
    const replay = await undo(asset.id, assignmentId, etagOf(out), idem);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.asset.id).toBe(first.body.asset.id);
    // exactly one undo happened
    expect(
      await auditRows(t.tenantId, `action = 'asset.custody_undone' and entity_id = '${asset.id}'`),
    ).toHaveLength(1);
    const again = await undo(asset.id, assignmentId, etagOf(first));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('undo-not-possible');
  });

  it('needs If-Match (428, also for *), an Idempotency-Key and a valid body', async () => {
    const { asset, assignmentId } = await checkedOut();
    const noMatch = await a().post(
      `/v1/assets/${asset.id}/undo-custody`,
      { assignment_id: assignmentId },
      { headers: { 'idempotency-key': randomUUID() } },
    );
    expect(noMatch.status).toBe(428);
    const star = await a().post(
      `/v1/assets/${asset.id}/undo-custody`,
      { assignment_id: assignmentId },
      { headers: { 'idempotency-key': randomUUID(), 'if-match': '*' } },
    );
    expect(star.status).toBe(428);
    const noKey = await a().post(
      `/v1/assets/${asset.id}/undo-custody`,
      { assignment_id: assignmentId },
      { headers: { 'if-match': 'W/"1"' } },
    );
    expect(noKey.status).toBe(400);
    const current = etagOf(await a().get(`/v1/assets/${asset.id}`));
    for (const body of [{}, { assignment_id: 'x' }, { assignment_id: assignmentId, extra: 1 }]) {
      const bad = await a().post(`/v1/assets/${asset.id}/undo-custody`, body, {
        headers: { 'idempotency-key': randomUUID(), 'if-match': current },
      });
      expect(bad.status, JSON.stringify(body)).toBe(422);
    }
    // an assignment of another asset is "not what happened last here"
    const other1 = await checkedOut();
    const wrong = await undo(asset.id, other1.assignmentId, current);
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe('undo-asset-changed');
    expect((await undo('0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d97', assignmentId, current)).status).toBe(
      404,
    );
  });

  it('expires after five minutes (409 undo-expired)', async () => {
    const { asset, res: out, assignmentId } = await checkedOut();
    await ownerTenantSql(
      t.tenantId,
      `update app.asset_history set at = at - interval '6 minutes' where asset_id = $1`,
      [asset.id],
    );
    const res = await undo(asset.id, assignmentId, etagOf(out));
    expect(res.status, res.raw).toBe(409);
    expect(res.body.code).toBe('undo-expired');
    expect((await assetNow(asset.id)).current_assignment).toBeTruthy();
  });

  it('cannot restore a holder who is no longer available (undo-not-possible), and changes nothing', async () => {
    const { asset, person, res: out } = await checkedOut();
    const back = await a().post(`/v1/assets/${asset.id}/checkin`, {}, key());
    expect(back.status).toBe(200);
    // the person is deactivated between the check-in and the undo
    await ownerTenantSql(t.tenantId, `update app.person set status = 'inactive' where id = $1`, [
      person.id,
    ]);
    const res = await undo(asset.id, back.body.assignment.id, etagOf(back));
    expect(res.status, res.raw).toBe(409);
    expect(res.body.code).toBe('undo-not-possible');
    const now = await assetNow(asset.id);
    expect(now.current_assignment).toBeNull();
    expect(etagOf(await a().get(`/v1/assets/${asset.id}`))).toBe(etagOf(back));
    expect(out.status).toBe(201);
  });

  it('needs the permission of the reversed action (an API key scoped to check-out cannot undo a check-in)', async () => {
    const { asset } = await checkedOut();
    const back = await a().post(`/v1/assets/${asset.id}/checkin`, {}, key());
    const created = await a().post('/v1/api-keys', {
      name: 'undo',
      scopes: ['asset:checkout', 'asset:read'],
    });
    expect(created.status, created.raw).toBe(201);
    const bearer = { authorization: `Bearer ${created.body.secret}` };
    const keyClient = new Client(app);
    const res = await keyClient.post(
      `/v1/assets/${asset.id}/undo-custody`,
      { assignment_id: back.body.assignment.id },
      {
        headers: { ...bearer, 'idempotency-key': randomUUID(), 'if-match': etagOf(back) },
        cookie: false,
        csrf: false,
      },
    );
    expect(res.status, res.raw).toBe(403);
    expect((await a().get(`/v1/assets/${asset.id}`)).body.current_assignment).toBeNull();
  });

  it('is for custody roles only and tenant-scoped', async () => {
    const { asset, res: out, assignmentId } = await checkedOut();
    for (const roleKey of ['auditor', 'viewer']) {
      const who = await createUser(app, t, roleKey);
      const res = await undo(asset.id, assignmentId, etagOf(out), randomUUID(), who.client);
      expect(res.status, roleKey).toBe(403);
    }
    const foreign = await undo(asset.id, assignmentId, etagOf(out), randomUUID(), other.admin);
    expect(foreign.status).toBe(404);
    // a technician (check-out, check-in, transfer) can
    const tech = await createUser(app, t, 'technician');
    const ok = await undo(asset.id, assignmentId, etagOf(out), randomUUID(), tech.client);
    expect(ok.status, ok.raw).toBe(200);
  });
});
