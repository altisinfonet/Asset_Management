import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type App,
  type Basics,
  type TenantFixture,
  auditRows,
  basics,
  contractViolations,
  createTenant,
  createUser,
  historyOf,
  ifMatch,
  keyed,
  newAsset,
  newPerson,
  newPhoto,
  newTenancy,
  outboxRows,
  startRegistryApp,
  unique,
} from '../lifecycle/support.js';

/**
 * M2-MNT-01: the repair and maintenance log. One tenant for the whole file; every test makes its own
 * assets so the cases do not couple.
 */
describe.skipIf(!dbEnabled)(`repairs (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  let b: Basics;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'repair');
    other = await createTenant(app, tenancy, 'repair2');
    b = await basics(t);
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const status = async (assetId: string) =>
    (await a().get(`/v1/assets/${assetId}`)).body.status.name as string;
  const open = async (assetId: string, extra: Record<string, unknown> = {}) => {
    const res = await a().post('/v1/repairs', {
      asset_id: assetId,
      title: unique('Screen'),
      ...extra,
    });
    if (res.status !== 201) throw new Error(`open repair: ${res.status} ${res.raw}`);
    return { id: res.body.id as string, etag: String(res.headers.etag), body: res.body };
  };

  describe('open and complete', () => {
    it('moves the asset to the in-repair status, blocks check-out, and restores the status on completion', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const person = await newPerson(a());
      const vendor = (await a().post('/v1/vendors', { name: unique('Fixit') })).body;
      const res = await a().post('/v1/repairs', {
        asset_id: asset.id,
        title: 'Cracked screen',
        description: 'Dropped on the stairs',
        kind: 'repair',
        vendor_id: vendor.id,
        performed_by_person_id: person.id,
        ticket_ref: 'TCK-42',
        cost: { amount_minor: 12050, currency: 'EUR' },
        set_status_id: b.status['In repair'],
      });
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`/v1/repairs/${res.body.id}`);
      expect(res.headers.etag).toBeTruthy();
      expect(res.body).toMatchObject({
        asset_id: asset.id,
        asset_tag: asset.body.asset_tag,
        vendor_name: vendor.name,
        status: 'open',
        kind: 'repair',
        cost: { amount_minor: 12050, currency: 'EUR' },
        set_status_id: b.status['In repair'],
        restore_status_id: b.status['Ready to deploy'],
        completed_at: null,
      });
      expect(await status(asset.id)).toBe('In repair');
      // blocked from check-out while it is repaired
      const blocked = await a().post(
        `/v1/assets/${asset.id}/checkout`,
        { person_id: person.id },
        keyed(),
      );
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('asset-not-deployable');

      const done = await a().post(
        `/v1/repairs/${res.body.id}/complete`,
        {
          resolution_notes: 'New panel fitted',
          cost: { amount_minor: 15000, currency: 'EUR' },
        },
        ifMatch(res.headers.etag),
      );
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({
        status: 'completed',
        resolution_notes: 'New panel fitted',
        cost: { amount_minor: 15000, currency: 'EUR' },
      });
      expect(done.body.completed_at).toBeTruthy();
      expect(await status(asset.id)).toBe('Ready to deploy');
      // deployable again
      expect(
        (await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed()))
          .status,
      ).toBe(201);

      // history, audit and outbox of both steps
      const history = await historyOf(a(), asset.id);
      const opened = history.find((h) => h.event_type === 'repair_opened');
      const completed = history.find((h) => h.event_type === 'repair_completed');
      expect(opened).toMatchObject({
        summary: 'Repair opened: Cracked screen',
        payload: {
          repair_id: res.body.id,
          status: { from_name: 'Ready to deploy', to_name: 'In repair' },
        },
      });
      expect(completed).toMatchObject({
        summary: 'Repair completed: Cracked screen',
        payload: { repair_id: res.body.id, outcome: 'completed' },
      });
      expect(
        (await auditRows(t.tenantId, `entity_id = '${res.body.id}'`)).map((r) => r.action),
      ).toEqual(['repair.opened', 'repair.completed']);
      const events = await outboxRows(t.tenantId, `aggregate_id = '${res.body.id}'`);
      expect(events.map((e) => e.event_type)).toEqual(['repair.opened', 'repair.completed']);
      expect(events[0]!.payload).toMatchObject({ assetId: asset.id });
    });

    it('a repair without set_status_id leaves the asset alone; maintenance records need no status change', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const rec = await open(asset.id, { kind: 'inspection', title: 'Annual check' });
      expect(rec.body).toMatchObject({ set_status_id: null, restore_status_id: null });
      expect(await status(asset.id)).toBe('Ready to deploy');
      const done = await a().post(`/v1/repairs/${rec.id}/complete`, {}, ifMatch(rec.etag));
      expect(done.status).toBe(200);
      expect(await status(asset.id)).toBe('Ready to deploy');
    });

    it('does not override a status somebody chose meanwhile, unless the completion names one', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const rec = await open(asset.id, { set_status_id: b.status['In repair'] });
      const fresh = await a().get(`/v1/assets/${asset.id}`);
      expect(
        (
          await a().patch(
            `/v1/assets/${asset.id}`,
            { status_id: b.status['Broken'] },
            ifMatch(fresh.headers.etag),
          )
        ).status,
      ).toBe(200);
      const done = await a().post(`/v1/repairs/${rec.id}/complete`, {}, ifMatch(rec.etag));
      expect(done.status).toBe(200);
      expect(await status(asset.id)).toBe('Broken');

      const asset2 = await newAsset(a(), b.categoryId);
      const rec2 = await open(asset2.id, { set_status_id: b.status['In repair'] });
      const done2 = await a().post(
        `/v1/repairs/${rec2.id}/complete`,
        { restore_status_id: b.status['Pending'] },
        ifMatch(rec2.etag),
      );
      expect(done2.status).toBe(200);
      expect(await status(asset2.id)).toBe('Pending');
    });

    it('only one open record at a time moves the status of an asset', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const first = await open(asset.id, { set_status_id: b.status['In repair'] });
      const second = await a().post('/v1/repairs', {
        asset_id: asset.id,
        title: 'Second',
        set_status_id: b.status['Broken'],
      });
      expect(second.status).toBe(409);
      // a note-only record is fine
      expect((await a().post('/v1/repairs', { asset_id: asset.id, title: 'Note' })).status).toBe(
        201,
      );
      // after the first closes, a new one may move the status again
      await a().post(`/v1/repairs/${first.id}/complete`, {}, ifMatch(first.etag));
      expect(
        (
          await a().post('/v1/repairs', {
            asset_id: asset.id,
            title: 'Third',
            set_status_id: b.status['In repair'],
          })
        ).status,
      ).toBe(201);
    });

    it('cancelling restores the status like a completion and records a cancelled outcome', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const rec = await open(asset.id, { set_status_id: b.status['In repair'] });
      const started = await a().patch(
        `/v1/repairs/${rec.id}`,
        { status: 'in_progress' },
        ifMatch(rec.etag),
      );
      expect(started.status).toBe(200);
      expect(started.body.status).toBe('in_progress');
      expect(started.body.started_at).toBeTruthy();
      const cancelled = await a().patch(
        `/v1/repairs/${rec.id}`,
        { status: 'cancelled' },
        ifMatch(started.headers.etag),
      );
      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toMatchObject({ status: 'cancelled', completed_at: null });
      expect(await status(asset.id)).toBe('Ready to deploy');
      const history = await historyOf(a(), asset.id);
      expect(history.find((h) => h.event_type === 'repair_completed')?.payload).toMatchObject({
        outcome: 'cancelled',
      });
      // a closed record keeps its status
      const reopen = await a().patch(
        `/v1/repairs/${rec.id}`,
        { status: 'open' },
        ifMatch(cancelled.headers.etag),
      );
      expect(reopen.status).toBe(409);
      expect(
        (await a().post(`/v1/repairs/${rec.id}/complete`, {}, ifMatch(cancelled.headers.etag)))
          .status,
      ).toBe(409);
    });
  });

  describe('state rules', () => {
    it('a checked-out asset is refused, forced only with a note, the in-repair status and asset:checkin', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const person = await newPerson(a());
      await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed());

      const refused = await a().post('/v1/repairs', { asset_id: asset.id, title: 'x' });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('asset-already-checked-out');
      const noNote = await a().post('/v1/repairs', {
        asset_id: asset.id,
        title: 'x',
        force_checkin: true,
        set_status_id: b.status['In repair'],
      });
      expect(noNote.status).toBe(422);
      expect(noNote.body.errors.map((e: { pointer: string }) => e.pointer)).toContain(
        '/force_note',
      );
      const noStatus = await a().post('/v1/repairs', {
        asset_id: asset.id,
        title: 'x',
        force_checkin: true,
        force_note: 'Smoke came out',
      });
      expect(noStatus.status).toBe(422);
      expect(noStatus.body.errors.map((e: { pointer: string }) => e.pointer)).toContain(
        '/set_status_id',
      );

      // an API key with repair:manage but not asset:checkin may not force it
      const key = await a().post('/v1/api-keys', {
        name: 'repair-only',
        scopes: ['repair:manage', 'repair:read', 'asset:read'],
      });
      const bearer = {
        headers: { authorization: `Bearer ${key.body.secret}` },
        cookie: false,
      } as const;
      const denied = await a().clone().post(
        '/v1/repairs',
        {
          asset_id: asset.id,
          title: 'x',
          force_checkin: true,
          force_note: 'Smoke came out',
          set_status_id: b.status['In repair'],
        },
        bearer,
      );
      expect(denied.status).toBe(403);
      expect((await a().get(`/v1/assets/${asset.id}`)).body.current_assignment).not.toBeNull();

      const tech = await createUser(app, t, 'technician');
      const forced = await tech.client.post('/v1/repairs', {
        asset_id: asset.id,
        title: 'Smoking battery',
        force_checkin: true,
        force_note: 'Smoke came out',
        set_status_id: b.status['In repair'],
      });
      expect(forced.status).toBe(201);
      expect(forced.body.restore_status_id).toBe(b.status['Ready to deploy']);
      const now = await a().get(`/v1/assets/${asset.id}`);
      expect(now.body.current_assignment).toBeNull();
      expect(now.body.status.name).toBe('In repair');
      const assignments = (await a().get(`/v1/assets/${asset.id}/assignments`)).body.data;
      expect(assignments[0].checked_in_at).toBeTruthy();
      expect(assignments[0].checkin_note).toBe('Smoke came out');
      const history = await historyOf(a(), asset.id);
      expect(history.map((h) => h.event_type)).toEqual(
        expect.arrayContaining(['checked_out', 'checked_in', 'repair_opened']),
      );
      expect(history.find((h) => h.event_type === 'repair_opened')?.payload).toMatchObject({
        forced_checkin: true,
        note: 'Smoke came out',
      });

      // completing returns it to stock
      const done = await a().post(
        `/v1/repairs/${forced.body.id}/complete`,
        {},
        ifMatch(forced.headers.etag),
      );
      expect(done.status).toBe(200);
      expect((await a().get(`/v1/assets/${asset.id}`)).body.status.name).toBe('Ready to deploy');
    });

    it('a lost, retired or archived asset cannot be repaired; a broken one can', async () => {
      const lost = await newAsset(a(), b.categoryId);
      await a().post(`/v1/assets/${lost.id}/mark-lost`, {}, ifMatch(lost.etag));
      expect((await a().post('/v1/repairs', { asset_id: lost.id, title: 'x' })).status).toBe(409);

      const gone = await newAsset(a(), b.categoryId);
      await a().del(`/v1/assets/${gone.id}`, undefined, ifMatch(gone.etag));
      expect((await a().post('/v1/repairs', { asset_id: gone.id, title: 'x' })).status).toBe(409);

      const broken = await newAsset(a(), b.categoryId, { status_id: b.status['Broken'] });
      const rec = await a().post('/v1/repairs', {
        asset_id: broken.id,
        title: 'Fix it',
        set_status_id: b.status['In repair'],
      });
      expect(rec.status).toBe(201);
      // it goes back to "Broken" if the repair is cancelled
      expect(rec.body.restore_status_id).toBe(b.status['Broken']);
    });

    it('an asset with an open repair cannot be archived or disposed of', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const rec = await open(asset.id);
      const fresh = await a().get(`/v1/assets/${asset.id}`);
      const archive = await a().del(
        `/v1/assets/${asset.id}`,
        undefined,
        ifMatch(fresh.headers.etag),
      );
      expect(archive.status).toBe(409);
      expect(archive.body.detail).toMatch(/open repair/);
      const dispose = await a().post(
        `/v1/assets/${asset.id}/dispose`,
        { reason: 'scrapped' },
        ifMatch(fresh.headers.etag),
      );
      expect(dispose.status).toBe(409);
      await a().post(`/v1/repairs/${rec.id}/complete`, {}, ifMatch(rec.etag));
      const after = await a().get(`/v1/assets/${asset.id}`);
      expect(
        (await a().del(`/v1/assets/${asset.id}`, undefined, ifMatch(after.headers.etag))).status,
      ).toBe(204);
    });

    it('validates references and statuses with pointers', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const bad = await a().post('/v1/repairs', {
        asset_id: asset.id,
        title: 'x',
        vendor_id: randomUUID(),
        performed_by_person_id: randomUUID(),
        set_status_id: b.status['Deployed'],
        restore_status_id: b.status['Pending'],
      });
      expect(bad.status).toBe(422);
      const pointers = bad.body.errors.map((e: { pointer: string }) => e.pointer);
      expect(pointers).toEqual(
        expect.arrayContaining(['/vendor_id', '/performed_by_person_id', '/set_status_id']),
      );
      expect((await a().post('/v1/repairs', { asset_id: randomUUID(), title: 'x' })).status).toBe(
        422,
      );
      // restore_status_id without a status move
      const orphan = await a().post('/v1/repairs', {
        asset_id: asset.id,
        title: 'x',
        restore_status_id: b.status['Pending'],
      });
      expect(orphan.status).toBe(422);
      expect(orphan.body.errors[0].pointer).toBe('/restore_status_id');
      // a repair is not created cancelled or completed; unknown fields are refused
      expect(
        (await a().post('/v1/repairs', { asset_id: asset.id, title: 'x', status: 'completed' }))
          .status,
      ).toBe(422);
      expect(
        (await a().post('/v1/repairs', { asset_id: asset.id, title: 'x', bogus: 1 })).status,
      ).toBe(422);
      // completion before the start
      const started = await open(asset.id, { started_at: '2026-01-10T10:00:00Z' });
      const early = await a().post(
        `/v1/repairs/${started.id}/complete`,
        { completed_at: '2026-01-09T10:00:00Z' },
        ifMatch(started.etag),
      );
      expect(early.status).toBe(422);
      expect(early.body.errors[0].pointer).toBe('/completed_at');
    });
  });

  describe('reads, updates and totals', () => {
    it('lists with filters, sorts and pages; totals per asset and currency', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const vendor = (await a().post('/v1/vendors', { name: unique('V') })).body;
      const one = await open(asset.id, {
        vendor_id: vendor.id,
        cost: { amount_minor: 1000, currency: 'EUR' },
      });
      const two = await open(asset.id, {
        title: 'Second',
        cost: { amount_minor: 250, currency: 'EUR' },
        kind: 'maintenance',
      });
      const three = await open(asset.id, {
        title: 'Third',
        cost: { amount_minor: 99, currency: 'USD' },
      });
      const four = await open(asset.id, {
        title: 'Cancelled',
        cost: { amount_minor: 5000, currency: 'EUR' },
      });
      await a().patch(`/v1/repairs/${four.id}`, { status: 'cancelled' }, ifMatch(four.etag));
      await a().post(`/v1/repairs/${three.id}/complete`, {}, ifMatch(three.etag));

      const all = await a().get(`/v1/repairs?asset_id=${asset.id}&limit=2`);
      expect(all.status).toBe(200);
      expect(all.body.data).toHaveLength(2);
      expect(all.body.page.has_more).toBe(true);
      const next = await a().get(
        `/v1/repairs?asset_id=${asset.id}&limit=2&cursor=${all.body.page.next_cursor}`,
      );
      expect(next.body.data).toHaveLength(2);
      expect(next.body.page.has_more).toBe(false);
      const ids = [...all.body.data, ...next.body.data].map((r: { id: string }) => r.id);
      expect(new Set(ids).size).toBe(4);

      const openOnes = await a().get(`/v1/repairs?asset_id=${asset.id}&status=open,in_progress`);
      expect(openOnes.body.data.map((r: { id: string }) => r.id).sort()).toEqual(
        [one.id, two.id].sort(),
      );
      expect(
        (await a().get(`/v1/repairs?asset_id=${asset.id}&kind=maintenance`)).body.data,
      ).toHaveLength(1);
      expect((await a().get(`/v1/repairs?vendor_id=${vendor.id}`)).body.data).toHaveLength(1);
      expect(
        (await a().get(`/v1/repairs?asset_id=${asset.id}&reported_from=2999-01-01T00:00:00Z`)).body
          .data,
      ).toHaveLength(0);
      expect((await a().get('/v1/repairs?sort=completed_at')).status).toBe(400);
      expect((await a().get('/v1/repairs?status=bogus')).status).toBe(400);

      const summary = await a().get(`/v1/assets/${asset.id}/repair-summary`);
      expect(summary.status).toBe(200);
      // cancelled excluded; one total per currency
      expect(summary.body).toEqual({
        asset_id: asset.id,
        open_count: 2,
        total_count: 3,
        total_cost: [
          { amount_minor: 1250, currency: 'EUR' },
          { amount_minor: 99, currency: 'USD' },
        ],
      });
      expect((await a().get(`/v1/assets/${randomUUID()}/repair-summary`)).status).toBe(404);
    });

    it('updates with merge semantics and If-Match; clears the cost with null; keeps closed records editable', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const rec = await open(asset.id, {
        cost: { amount_minor: 100, currency: 'USD' },
        description: 'first',
      });
      expect((await a().patch(`/v1/repairs/${rec.id}`, { title: 'x' })).status).toBe(428);
      const stale = await a().patch(`/v1/repairs/${rec.id}`, { title: 'x' }, ifMatch('W/"99"'));
      expect(stale.status).toBe(412);
      const up = await a().patch(
        `/v1/repairs/${rec.id}`,
        { title: 'Renamed', cost: null, ticket_ref: 'T-1' },
        ifMatch(rec.etag),
      );
      expect(up.status).toBe(200);
      expect(up.body).toMatchObject({
        title: 'Renamed',
        cost: null,
        ticket_ref: 'T-1',
        description: 'first',
      });
      expect(
        (
          await a().patch(
            `/v1/repairs/${rec.id}`,
            { asset_id: randomUUID() },
            ifMatch(up.headers.etag),
          )
        ).status,
      ).toBe(422);
      const done = await a().post(`/v1/repairs/${rec.id}/complete`, {}, ifMatch(up.headers.etag));
      const edit = await a().patch(
        `/v1/repairs/${rec.id}`,
        { description: 'edited after closing' },
        ifMatch(done.headers.etag),
      );
      expect(edit.status).toBe(200);
      expect(edit.body.description).toBe('edited after closing');
      const audit = await auditRows(t.tenantId, `entity_id = '${rec.id}'`);
      expect(audit.map((r) => r.action)).toEqual([
        'repair.opened',
        'repair.updated',
        'repair.completed',
        'repair.updated',
      ]);
    });

    it('archives only closed records, soft; an archived record is hidden unless asked for', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const rec = await open(asset.id);
      expect((await a().del(`/v1/repairs/${rec.id}`, undefined, ifMatch(rec.etag))).status).toBe(
        409,
      );
      const done = await a().post(`/v1/repairs/${rec.id}/complete`, {}, ifMatch(rec.etag));
      expect(
        (await a().del(`/v1/repairs/${rec.id}`, undefined, ifMatch(done.headers.etag))).status,
      ).toBe(204);
      expect((await a().get(`/v1/repairs/${rec.id}`)).status).toBe(200);
      expect((await a().get(`/v1/repairs?asset_id=${asset.id}`)).body.data).toHaveLength(0);
      expect(
        (await a().get(`/v1/repairs?asset_id=${asset.id}&archived=include`)).body.data,
      ).toHaveLength(1);
      expect((await a().get(`/v1/assets/${asset.id}/repair-summary`)).body.total_count).toBe(0);
    });
  });

  describe('attachments', () => {
    it('photos uploaded against the asset are linked at open and at completion; repairs are attachment owners', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const before = await newPhoto(a(), asset.id);
      const rec = await open(asset.id, { attachment_ids: [before] });
      const linked = await a().get(
        `/v1/attachments?entity_type=maintenance_record&entity_id=${rec.id}`,
      );
      expect(linked.body.data.map((x: { id: string }) => x.id)).toEqual([before]);
      // the invoice is uploaded straight against the repair
      const invoice = await a().post('/v1/attachments', {
        entity_type: 'maintenance_record',
        entity_id: rec.id,
        kind: 'document',
        filename: 'invoice.pdf',
        content_type: 'application/pdf',
        size_bytes: 50,
      });
      expect(invoice.status).toBe(201);
      // a photo of another record cannot be hijacked
      const stranger = await newAsset(a(), b.categoryId);
      const foreign = await newPhoto(a(), stranger.id);
      const bad = await a().post(
        `/v1/repairs/${rec.id}/complete`,
        { attachment_ids: [foreign] },
        ifMatch(rec.etag),
      );
      expect(bad.status).toBe(422);
      expect(bad.body.errors[0].pointer).toBe('/attachment_ids/0');
      const after = await newPhoto(a(), asset.id);
      const done = await a().post(
        `/v1/repairs/${rec.id}/complete`,
        { attachment_ids: [after] },
        ifMatch(rec.etag),
      );
      expect(done.status).toBe(200);
      const all = await a().get(
        `/v1/attachments?entity_type=maintenance_record&entity_id=${rec.id}`,
      );
      expect(all.body.data).toHaveLength(3);
    });
  });

  describe('permissions and tenants', () => {
    it('viewers read, technicians manage, nobody else sees the records', async () => {
      const asset = await newAsset(a(), b.categoryId);
      const viewer = await createUser(app, t, 'viewer');
      const tech = await createUser(app, t, 'technician');
      const rec = await open(asset.id);
      expect((await viewer.client.get(`/v1/repairs/${rec.id}`)).status).toBe(200);
      expect((await viewer.client.get('/v1/repairs')).status).toBe(200);
      expect((await viewer.client.get(`/v1/assets/${asset.id}/repair-summary`)).status).toBe(200);
      expect(
        (await viewer.client.post('/v1/repairs', { asset_id: asset.id, title: 'x' })).status,
      ).toBe(403);
      expect(
        (await viewer.client.post(`/v1/repairs/${rec.id}/complete`, {}, ifMatch(rec.etag))).status,
      ).toBe(403);
      expect(
        (await tech.client.post('/v1/repairs', { asset_id: asset.id, title: 'tech' })).status,
      ).toBe(201);

      expect((await other.admin.get(`/v1/repairs/${rec.id}`)).status).toBe(404);
      expect((await other.admin.get('/v1/repairs')).body.data).toHaveLength(0);
      expect(
        (await other.admin.post('/v1/repairs', { asset_id: asset.id, title: 'x' })).status,
      ).toBe(422);
      expect(
        (await other.admin.post(`/v1/repairs/${rec.id}/complete`, {}, ifMatch('*'))).status,
      ).toBe(404);
      expect((await other.admin.get(`/v1/assets/${asset.id}/repair-summary`)).status).toBe(404);
    });
  });
});
