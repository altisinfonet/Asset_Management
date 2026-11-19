import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EICAR } from '../../src/ports/fakes.js';
import { dbEnabled } from '../auth/support.js';
import {
  type FilesHarness,
  clamdEnv,
  drainJobs,
  fetchUrl,
  s3Env,
  startFilesApp,
  uploadFile,
} from '../files/support.js';
import { mode } from '../support/db.js';
import { png } from '../support/file-fixtures.js';
import {
  type Basics,
  type TenantFixture,
  auditRows,
  basics,
  createTenant,
  historyOf,
  keyed,
  newAsset,
  newPerson,
  newPhoto,
  newTenancy,
  unique,
} from './support.js';

/**
 * M2 wave 1 integration of custody and files: check-in / check-out / transfer photos are validated
 * and re-pointed at the assignment inside the custody transaction, the check-in condition, the
 * chosen check-out status, and the serial scan. Real storage and the real scanner are used when
 * S3_ENDPOINT / CLAMD_HOST are set (the files suite's convention).
 */
const driver = s3Env ? ('s3' as const) : ('local' as const);
const scanner = clamdEnv ? ('clamd' as const) : ('fake' as const);

describe.skipIf(!dbEnabled)(`custody + files (${mode}, ${driver}, ${scanner})`, () => {
  const tenancy = newTenancy();
  let h: FilesHarness;
  let A: TenantFixture;
  let B: TenantFixture;
  let b: Basics;
  const a = () => A.admin;

  beforeAll(async () => {
    h = await startFilesApp({ driver, scanner });
    A = await createTenant(h.app, tenancy, 'custfa');
    B = await createTenant(h.app, tenancy, 'custfb');
    b = await basics(A);
  });
  afterAll(async () => {
    await h.close();
    await tenancy.onModuleDestroy();
  });

  /** Uploads a real PNG against the asset and runs the scan: the attachment ends up `clean`. */
  async function cleanPhoto(assetId: string): Promise<string> {
    const body = await png(40, 30);
    const { id } = await uploadFile(
      h,
      a(),
      A.tenantId,
      { entity_type: 'asset', entity_id: assetId },
      { filename: 'return.png', content_type: 'image/png', body, kind: 'photo' },
    );
    await drainJobs(h);
    return id;
  }

  describe('photos at check-in (upload, check in, listed on the assignment)', () => {
    it('a clean photo and the condition are stored on the closed assignment; the photo moves to it', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      const out = await a().post(
        `/v1/assets/${asset.id}/checkout`,
        { person_id: person.id },
        keyed(),
      );
      expect(out.status, out.raw).toBe(201);
      const photo = await cleanPhoto(asset.id);
      expect((await a().get(`/v1/attachments/${photo}`)).body.scan_status).toBe('clean');

      const res = await a().post(
        `/v1/assets/${asset.id}/checkin`,
        { note: 'scratch on the lid', condition: 'fair', attachment_ids: [photo] },
        keyed(),
      );
      expect(res.status, res.raw).toBe(200);
      expect(res.body.assignment).toMatchObject({
        id: out.body.assignment.id,
        checkin_condition: 'fair',
        checkin_attachment_ids: [photo],
      });

      // listed on the assignment, with both URLs right in the list (no per-item GET)
      const onAssignment = await a().get(
        `/v1/attachments?entity_type=assignment&entity_id=${out.body.assignment.id}`,
      );
      expect(onAssignment.status).toBe(200);
      expect(onAssignment.body.data.map((x: { id: string }) => x.id)).toEqual([photo]);
      const item = onAssignment.body.data[0];
      expect(item).toMatchObject({ entity_type: 'assignment', scan_status: 'clean' });
      expect(item.download_url).toBeTruthy();
      expect(item.thumbnail_url).toBeTruthy();
      const bytes = await fetchUrl(h, item.download_url);
      expect(bytes.status).toBe(200);
      expect(bytes.body.subarray(0, 4).toString('hex')).toBe('89504e47');
      // and no longer on the asset
      const onAsset = await a().get(`/v1/attachments?entity_type=asset&entity_id=${asset.id}`);
      expect(onAsset.body.data).toEqual([]);

      // the assignment list, the history and the audit trail carry the condition / the link
      const list = await a().get(`/v1/assets/${asset.id}/assignments`);
      expect(list.body.data[0]).toMatchObject({ checkin_condition: 'fair' });
      const checkedIn = (await historyOf(a(), asset.id)).find(
        (e) => e.event_type === 'checked_in',
      )!;
      expect(checkedIn.payload).toMatchObject({
        condition: 'fair',
        note: 'scratch on the lid',
        attachment_ids: [photo],
      });
      expect(
        (await auditRows(A.tenantId, `entity_id = '${photo}'`)).map((r) => r.action),
      ).toContain('attachment.linked');
    });

    it('a pending photo is accepted at check-out and listed on the assignment', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      const photo = await newPhoto(a(), asset.id);
      const res = await a().post(
        `/v1/assets/${asset.id}/checkout`,
        { person_id: person.id, attachment_ids: [photo] },
        keyed(),
      );
      expect(res.status, res.raw).toBe(201);
      expect(res.body.assignment.attachment_ids).toEqual([photo]);
      const listed = await a().get(
        `/v1/attachments?entity_type=assignment&entity_id=${res.body.assignment.id}`,
      );
      expect(listed.body.data).toHaveLength(1);
      expect(listed.body.data[0]).toMatchObject({ id: photo, scan_status: 'pending' });
      expect(listed.body.data[0].download_url).toBeNull(); // not before the scan is clean
    });

    it('photos of a transfer are linked to the new assignment', async () => {
      const first = await newPerson(a());
      const second = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: first.id }, keyed());
      const photo = await newPhoto(a(), asset.id);
      const res = await a().post(
        `/v1/assets/${asset.id}/transfer`,
        { person_id: second.id, attachment_ids: [photo] },
        keyed(),
      );
      expect(res.status, res.raw).toBe(201);
      const listed = await a().get(
        `/v1/attachments?entity_type=assignment&entity_id=${res.body.assignment.id}`,
      );
      expect(listed.body.data.map((x: { id: string }) => x.id)).toEqual([photo]);
    });
  });

  describe('bad photo ids are 422 with a pointer, and nothing changes', () => {
    async function checkedOut() {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      const out = await a().post(
        `/v1/assets/${asset.id}/checkout`,
        { person_id: person.id },
        keyed(),
      );
      return { asset, person, assignmentId: out.body.assignment.id as string };
    }

    const refused = async (assetId: string, ids: string[], path = 'checkin') => {
      const res = await a().post(
        `/v1/assets/${assetId}/${path}`,
        path === 'checkout'
          ? { person_id: (await newPerson(a())).id, attachment_ids: ids }
          : { attachment_ids: ids },
        keyed(),
      );
      expect(res.status, res.raw).toBe(422);
      return res.body.errors as Array<{ pointer: string; code?: string }>;
    };

    it('an unknown id', async () => {
      const { asset, assignmentId } = await checkedOut();
      const errors = await refused(asset.id, [randomUUID()]);
      expect(errors).toEqual([expect.objectContaining({ pointer: '/attachment_ids/0' })]);
      // still checked out, nothing linked
      const got = await a().get(`/v1/assets/${asset.id}`);
      expect(got.body.current_assignment).toMatchObject({ assignment_id: assignmentId });
    });

    it("another organisation's attachment is as good as unknown", async () => {
      const { asset } = await checkedOut();
      const foreignAsset = await newAsset(B.admin, (await basics(B)).categoryId);
      const foreignPhoto = await newPhoto(B.admin, foreignAsset.id);
      const errors = await refused(asset.id, [foreignPhoto]);
      expect(errors[0]).toMatchObject({ pointer: '/attachment_ids/0', code: 'not-found' });
      // B's photo is still B's
      const stillB = await B.admin.get(`/v1/attachments/${foreignPhoto}`);
      expect(stillB.body).toMatchObject({ entity_type: 'asset', entity_id: foreignAsset.id });
    });

    it('a photo of another asset of the same organisation', async () => {
      const { asset } = await checkedOut();
      const elsewhere = await newAsset(a(), b.categoryId);
      const photo = await newPhoto(a(), elsewhere.id);
      const errors = await refused(asset.id, [photo]);
      expect(errors[0]).toMatchObject({ pointer: '/attachment_ids/0', code: 'wrong-owner' });
    });

    it('an infected file, with the pointer of the offending item among good ones', async () => {
      const { asset, assignmentId } = await checkedOut();
      const good = await newPhoto(a(), asset.id);
      const infected = await uploadFile(
        h,
        a(),
        A.tenantId,
        { entity_type: 'asset', entity_id: asset.id },
        {
          filename: 'dropper.csv',
          content_type: 'text/csv',
          body: Buffer.from(EICAR),
          kind: 'document',
        },
      );
      await drainJobs(h);
      expect((await a().get(`/v1/attachments/${infected.id}`)).body.scan_status).toBe('infected');
      const errors = await refused(asset.id, [good, infected.id]);
      expect(errors).toEqual([
        expect.objectContaining({ pointer: '/attachment_ids/1', code: 'rejected' }),
      ]);
      // atomic: the good photo was not linked and the custody period is still open
      expect((await a().get(`/v1/attachments/${good}`)).body.entity_type).toBe('asset');
      expect((await a().get(`/v1/assets/${asset.id}`)).body.current_assignment).toMatchObject({
        assignment_id: assignmentId,
      });
    });

    it('also at check-out and transfer', async () => {
      const asset = await newAsset(a(), b.categoryId);
      expect((await refused(asset.id, [randomUUID()], 'checkout'))[0]?.pointer).toBe(
        '/attachment_ids/0',
      );
      const person = await newPerson(a());
      await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed());
      const res = await a().post(
        `/v1/assets/${asset.id}/transfer`,
        { person_id: (await newPerson(a())).id, attachment_ids: [randomUUID()] },
        keyed(),
      );
      expect(res.status).toBe(422);
      expect(res.body.errors[0].pointer).toBe('/attachment_ids/0');
    });
  });

  describe('check-in condition and check-out status', () => {
    it('condition is validated', async () => {
      const person = await newPerson(a());
      const asset = await newAsset(a(), b.categoryId);
      await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed());
      const bad = await a().post(
        `/v1/assets/${asset.id}/checkin`,
        { condition: 'pristine' },
        keyed(),
      );
      expect(bad.status).toBe(422);
      const ok = await a().post(`/v1/assets/${asset.id}/checkin`, {}, keyed());
      expect(ok.body.assignment.checkin_condition).toBeNull();
    });

    it('status_label_id: a deployed label is used, anything else is a 422 on /status_label_id', async () => {
      const person = await newPerson(a());
      const custom = await a().post('/v1/status-labels', {
        name: unique('On loan'),
        state_type: 'deployed',
        color: '#336699',
      });
      expect(custom.status, custom.raw).toBe(201);
      const asset = await newAsset(a(), b.categoryId);
      const res = await a().post(
        `/v1/assets/${asset.id}/checkout`,
        { person_id: person.id, status_label_id: custom.body.id },
        keyed(),
      );
      expect(res.status, res.raw).toBe(201);
      expect(res.body.asset.status).toMatchObject({ id: custom.body.id, state_type: 'deployed' });
      const checkedOut = (await historyOf(a(), asset.id)).find(
        (e) => e.event_type === 'checked_out',
      )!;
      expect(checkedOut.payload.status).toMatchObject({ to: custom.body.name });

      for (const statusId of [b.status['Ready to deploy'], randomUUID()]) {
        const other = await newAsset(a(), b.categoryId);
        const refused = await a().post(
          `/v1/assets/${other.id}/checkout`,
          { person_id: person.id, status_label_id: statusId },
          keyed(),
        );
        expect(refused.status, refused.raw).toBe(422);
        expect(refused.body.errors[0].pointer).toBe('/status_label_id');
        expect((await a().get(`/v1/assets/${other.id}`)).body.current_assignment).toBeNull();
      }
    });
  });

  describe('scan by serial number', () => {
    it('resolves an exact serial (case-insensitive) after the label code and the tag', async () => {
      const serial = unique('SN').toUpperCase();
      const asset = await newAsset(a(), b.categoryId, { serial });
      const res = await a().get(
        `/v1/scan/resolve?code=${encodeURIComponent(serial.toLowerCase())}`,
      );
      expect(res.status, res.raw).toBe(200);
      expect(res.body).toMatchObject({
        match_type: 'serial',
        entity_type: 'asset',
        asset: { id: asset.id },
      });
      expect(res.body.allowed_actions).toContain('checkout');
      // the tag still wins as `asset_tag`
      const byTag = await a().get(
        `/v1/scan/resolve?code=${encodeURIComponent(asset.body.asset_tag)}`,
      );
      expect(byTag.body.match_type).toBe('asset_tag');
    });

    it('a serial shared by several assets is a 409, never a guess; a foreign serial is a 404', async () => {
      const serial = unique('DUP');
      await newAsset(a(), b.categoryId, { serial });
      await newAsset(a(), b.categoryId, { serial });
      const res = await a().get(`/v1/scan/resolve?code=${encodeURIComponent(serial)}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('conflict');

      const bSerial = unique('BSN');
      await newAsset(B.admin, (await basics(B)).categoryId, { serial: bSerial });
      expect((await a().get(`/v1/scan/resolve?code=${encodeURIComponent(bSerial)}`)).status).toBe(
        404,
      );
    });
  });
});
