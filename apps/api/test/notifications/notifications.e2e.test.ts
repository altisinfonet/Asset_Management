import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import { NotificationDigest } from '../../src/notifications/digest.js';
import {
  IMMEDIATE_EMAILS_PER_HOUR,
  NOTIFICATION_TYPE_KEYS,
} from '../../src/notifications/index.js';
import { OutboxRelay, OutboxSubscribers } from '../../src/outbox/index.js';
import {
  NOTIFIER,
  OUTBOX_PUBLISHER,
  type Notifier,
  type OutboxPublisher,
} from '../../src/ports/index.js';
import { TenancyService } from '../../src/tenancy/index.js';
import {
  type App,
  type Basics,
  type TenantFixture,
  basics,
  contractViolations,
  createTenant,
  createUser,
  keyed,
  newAsset,
  newTenancy,
  ownerTenantSql,
  startRegistryApp,
  testPorts,
  unique,
} from '../lifecycle/support.js';
import { newAccessory, newConsumable } from '../stock/support.js';

/**
 * M2-NOT-01: notifications. The real outbox relay runs the real subscriptions against the real
 * database (mail goes to the capturing fake); the API is exercised as the web app uses it.
 */
describe.skipIf(!dbEnabled)(`notifications (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let other: TenantFixture;
  let b: Basics;
  let notifier: Notifier;
  let outbox: OutboxPublisher;
  let runtime: TenancyService;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'notif');
    other = await createTenant(app, tenancy, 'notif2');
    b = await basics(t);
    notifier = app.get<Notifier>(NOTIFIER, { strict: false });
    outbox = app.get<OutboxPublisher>(OUTBOX_PUBLISHER, { strict: false });
    runtime = app.get(TenancyService, { strict: false });
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  /** Delivers every pending outbox event of the tenant to the subscribers, like the worker role does. */
  async function relay(tenantId = t.tenantId) {
    const r = new OutboxRelay({
      tenancy: runtime,
      tenants: async () => [{ tenantId }],
      subscribers: app.get(OutboxSubscribers, { strict: false }),
      logger: pino({ level: 'silent' }),
    });
    return r.runOnce();
  }

  async function digest(tenantId = t.tenantId) {
    const job = app.get(NotificationDigest, { strict: false });
    await runtime.withTenantTx({ tenantId }, (tx) =>
      job.run(
        { tenantId },
        {
          tenantId,
          tx,
          jobId: 'test',
          queue: 'notification.digest',
          retryCount: 0,
          logger: pino({ level: 'silent' }),
        },
      ),
    );
  }

  /** A person with a login (made by the invitation) and the user's client. */
  async function member(roleKey = 'technician') {
    const user = await createUser(app, t, roleKey);
    const people = await a().get(`/v1/people?q=${encodeURIComponent(user.email)}`);
    return { ...user, personId: people.body.data[0].id as string };
  }

  const checkout = async (personId: string) => {
    const asset = await newAsset(a(), b.categoryId);
    const res = await a().post(`/v1/assets/${asset.id}/checkout`, { person_id: personId }, keyed());
    expect(res.status).toBe(201);
    return asset;
  };
  const notificationMails = (to: string) =>
    testPorts.mail.sent.filter((m) => m.to === to && m.template === 'notification.message');
  const deliveries = async (userId: string, query = '') =>
    (await a().get(`/v1/notification-deliveries?user_id=${userId}&limit=200${query}`)).body
      .data as Array<{ channel: string; status: string; reason: string | null; type: string }>;

  describe('the API', () => {
    it('lists the preferences of every type with the defaults, and stores a choice per user', async () => {
      const u = await member();
      const list = await u.client.get('/v1/notification-preferences');
      expect(list.status).toBe(200);
      expect(list.body.data.map((p: { type: string }) => p.type)).toEqual(NOTIFICATION_TYPE_KEYS);
      const infected = list.body.data.find(
        (p: { type: string }) => p.type === 'attachment.infected',
      );
      expect(infected).toMatchObject({ in_app: true, email: 'immediate', is_default: true });

      const set = await u.client.put('/v1/notification-preferences/attachment.infected', {
        email: 'digest',
      });
      expect(set.status).toBe(200);
      expect(set.body).toMatchObject({ in_app: true, email: 'digest', is_default: false });
      const again = await u.client.put('/v1/notification-preferences/attachment.infected', {
        in_app: false,
      });
      expect(again.body).toMatchObject({ in_app: false, email: 'digest' });
      // another user's list is unaffected
      const v = await member('viewer');
      expect(
        (await v.client.get('/v1/notification-preferences')).body.data.find(
          (p: { type: string }) => p.type === 'attachment.infected',
        ),
      ).toMatchObject({ in_app: true, email: 'immediate', is_default: true });

      expect(
        (await u.client.put('/v1/notification-preferences/no.such_type', { email: 'off' })).status,
      ).toBe(404);
      expect(
        (await u.client.put('/v1/notification-preferences/attachment.infected', {})).status,
      ).toBe(422);
      expect(
        (await u.client.put('/v1/notification-preferences/attachment.infected', { email: 'sms' }))
          .status,
      ).toBe(422);
      expect(
        (await u.client.put('/v1/notification-preferences/NOT_A_TYPE', { email: 'off' })).status,
      ).toBe(400);
    });

    it('rules are for administrators; types are enabled by default and can be re-addressed to roles', async () => {
      const viewer = await member('viewer');
      expect((await viewer.client.get('/v1/notification-rules')).status).toBe(403);
      expect((await viewer.client.get('/v1/notification-deliveries')).status).toBe(403);
      expect(
        (await viewer.client.put('/v1/notification-rules/consumable.low_stock', { enabled: false }))
          .status,
      ).toBe(403);

      const rules = await a().get('/v1/notification-rules');
      expect(rules.status).toBe(200);
      expect(rules.body.data).toHaveLength(NOTIFICATION_TYPE_KEYS.length);
      expect(rules.body.data.every((r: { enabled: boolean }) => r.enabled)).toBe(true);

      const low = await a().put('/v1/notification-rules/consumable.low_stock', {
        recipient_roles: ['asset_manager'],
      });
      expect(low.status).toBe(200);
      expect(low.body).toMatchObject({
        enabled: true,
        role_configurable: true,
        recipient_roles: ['asset_manager'],
      });
      // null goes back to the default
      const reset = await a().put('/v1/notification-rules/consumable.low_stock', {
        recipient_roles: null,
      });
      expect(reset.body.recipient_roles).toBeNull();

      const fixed = await a().put('/v1/notification-rules/attachment.infected', {
        recipient_roles: ['viewer'],
      });
      expect(fixed.status).toBe(422);
      const unknown = await a().put('/v1/notification-rules/consumable.low_stock', {
        recipient_roles: ['nobody'],
      });
      expect(unknown.status).toBe(422);
      expect(unknown.body.errors[0].pointer).toBe('/recipient_roles/0');
      expect(
        (await a().put('/v1/notification-rules/no.such_type', { enabled: false })).status,
      ).toBe(404);
      expect((await a().put('/v1/notification-rules/consumable.low_stock', {})).status).toBe(422);
    });

    it('the inbox pages, counts and marks read; another user cannot touch it', async () => {
      const u = await member();
      const spy = await member('viewer');
      for (let i = 0; i < 3; i++) {
        await runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
          notifier.notify(tx, {
            type: 'export.completed',
            recipients: [u.id],
            vars: { filename: `f${i}.csv`, rows: i },
            dedupeKey: `inbox-${u.id}-${i}`,
          }),
        );
      }
      expect((await u.client.get('/v1/notifications/unread-count')).body).toEqual({ count: 3 });
      const page1 = await u.client.get('/v1/notifications?limit=2');
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.page.has_more).toBe(true);
      const page2 = await u.client.get(
        `/v1/notifications?limit=2&cursor=${page1.body.page.next_cursor}`,
      );
      expect(page2.body.data).toHaveLength(1);
      expect(page1.body.data[0]).toMatchObject({
        type: 'export.completed',
        title: 'Your export is ready',
        read_at: null,
      });

      const first = page1.body.data[0].id as string;
      expect((await spy.client.post(`/v1/notifications/${first}/read`, {})).status).toBe(404);
      const read = await u.client.post(`/v1/notifications/${first}/read`, {});
      expect(read.status).toBe(200);
      expect(read.body.read_at).toBeTruthy();
      const readAt = read.body.read_at;
      expect((await u.client.post(`/v1/notifications/${first}/read`, {})).body.read_at).toBe(
        readAt,
      );
      expect((await u.client.get('/v1/notifications/unread-count')).body.count).toBe(2);
      expect((await u.client.get('/v1/notifications?unread=true')).body.data).toHaveLength(2);
      expect((await u.client.post('/v1/notifications/read-all', {})).body).toEqual({ updated: 2 });
      expect((await u.client.get('/v1/notifications/unread-count')).body.count).toBe(0);
      expect((await spy.client.get('/v1/notifications')).body.data).toHaveLength(0);
      expect((await u.client.post(`/v1/notifications/${randomUUID()}/read`, {})).status).toBe(404);
      // an API key is not a browser session
      const key = await a().post('/v1/api-keys', { name: 'k', scopes: ['asset:read'] });
      expect(
        (
          await a()
            .clone()
            .get('/v1/notifications', {
              headers: { authorization: `Bearer ${key.body.secret}` },
              cookie: false,
            })
        ).status,
      ).toBe(403);
    });
  });

  describe('events become notifications', () => {
    it('a check-out notifies the assignee who has a login (in the bell, by default not by mail)', async () => {
      const u = await member();
      const asset = await checkout(u.personId);
      await relay();
      const list = await u.client.get('/v1/notifications');
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({
        type: 'asset.checked_out',
        entity_type: 'asset',
        entity_id: asset.id,
        link: `/assets/view?id=${asset.id}`,
        read_at: null,
      });
      expect(list.body.data[0].title).toContain(asset.body.asset_tag);
      expect(notificationMails(u.email)).toHaveLength(0);
      expect(await deliveries(u.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ channel: 'in_app', status: 'delivered' }),
          expect.objectContaining({
            channel: 'email',
            status: 'skipped',
            reason: 'preference-off',
          }),
        ]),
      );
      // nothing for somebody else, and the relay does not notify twice for the same event
      expect((await a().get('/v1/notifications')).body.data).toHaveLength(0);
      await relay();
      expect((await u.client.get('/v1/notifications')).body.data).toHaveLength(1);
    });

    it('an assignee without a login is nobody to notify', async () => {
      const person = (await a().post('/v1/people', { display_name: unique('Walkin') })).body;
      await checkout(person.id);
      const before = (await a().get('/v1/notification-deliveries?limit=200')).body.data.length;
      await relay();
      expect((await a().get('/v1/notification-deliveries?limit=200')).body.data.length).toBe(
        before,
      );
    });

    it('sends the email immediately when the user wants it, with an absolute link', async () => {
      const u = await member();
      await u.client.put('/v1/notification-preferences/asset.checked_out', { email: 'immediate' });
      const asset = await checkout(u.personId);
      await relay();
      const mails = notificationMails(u.email);
      expect(mails).toHaveLength(1);
      expect(mails[0]!.data).toMatchObject({
        url: `http://web.test/assets/view?id=${asset.id}`,
      });
      expect(String(mails[0]!.data.title)).toContain(asset.body.asset_tag);
      expect(await deliveries(u.id, '&channel=email')).toEqual([
        expect.objectContaining({ status: 'queued', reason: null }),
      ]);
    });

    it('honours "bell off, email off" and a type the organisation switched off', async () => {
      const off = await member();
      await off.client.put('/v1/notification-preferences/asset.checked_out', {
        in_app: false,
        email: 'off',
      });
      await checkout(off.personId);
      await relay();
      expect((await off.client.get('/v1/notifications')).body.data).toHaveLength(0);
      expect(await deliveries(off.id)).toEqual([
        expect.objectContaining({ channel: 'in_app', status: 'skipped', reason: 'preference-off' }),
      ]);

      const u = await member();
      expect(
        (await a().put('/v1/notification-rules/asset.checked_out', { enabled: false })).status,
      ).toBe(200);
      await checkout(u.personId);
      await relay();
      expect((await u.client.get('/v1/notifications')).body.data).toHaveLength(0);
      expect(await deliveries(u.id)).toEqual([]);
      await a().put('/v1/notification-rules/asset.checked_out', { enabled: true });
    });

    it('turns an infected-file event into a notification for the uploader, with the file name', async () => {
      const u = await member();
      const asset = await newAsset(a(), b.categoryId);
      const created = await u.client.post('/v1/attachments', {
        entity_type: 'asset',
        entity_id: asset.id,
        kind: 'document',
        filename: 'invoice.pdf',
        content_type: 'application/pdf',
        size_bytes: 50,
      });
      expect(created.status).toBe(201);
      const attachmentId = created.body.attachment.id as string;
      await ownerTenantSql(
        t.tenantId,
        `update app.attachment set scan_status = 'infected', scan_detail = 'Win.Test.EICAR_HDB-1' where id = $1`,
        [attachmentId],
      );
      // what the scan job publishes (src/files/pipeline.ts)
      await runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
        outbox.publish(tx, {
          type: 'attachment.infected',
          aggregateType: 'attachment',
          aggregateId: attachmentId,
          payload: { version: 3, entity_type: 'asset', entity_id: asset.id, uploaded_by: u.id },
        }),
      );
      await relay();
      const list = await u.client.get('/v1/notifications');
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({
        type: 'attachment.infected',
        title: 'A file you uploaded was blocked',
        link: `/assets/view?id=${asset.id}`,
      });
      expect(list.body.data[0].body).toContain('"invoice.pdf"');
      expect(list.body.data[0].body).toContain('Win.Test.EICAR_HDB-1');
      // infected is an immediate email by default
      const mail = notificationMails(u.email);
      expect(mail).toHaveLength(1);
      expect(mail[0]!.data.title).toBe('A file you uploaded was blocked');
    });

    it('low stock (a real issue below the minimum) goes to the users who manage consumables, or to the roles the administrator picks', async () => {
      const manager = await member('asset_manager');
      const viewer = await member('viewer');
      const tech = await member('technician');
      const lowFor = async (c: typeof manager.client, name: string) =>
        (
          (await c.get('/v1/notifications')).body.data as Array<{
            type: string;
            title: string;
            body: string;
            link: string | null;
            entity_type: string | null;
          }>
        ).filter((n) => n.type === 'consumable.low_stock' && n.title.includes(name));
      const crossing = async () => {
        const item = await newConsumable(a(), { min_qty: 5, initial_qty: 8 });
        const issue = await a().post(
          `/v1/consumables/${item.id}/movements`,
          { qty_delta: -3, reason: 'issue' },
          keyed(),
        );
        expect(issue.status, issue.raw).toBe(201);
        await relay();
        return { id: item.id as string, name: item.body.name as string };
      };

      const first = await crossing();
      const mine = await lowFor(manager.client, first.name);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.body).toContain('5 left (minimum 5)');
      expect(mine[0]).toMatchObject({
        entity_type: 'consumable',
        link: `/stock/view?kind=consumable&id=${first.id}`,
      });
      expect(await lowFor(a(), first.name)).toHaveLength(1); // the administrator holds *
      expect(await lowFor(viewer.client, first.name)).toHaveLength(0);
      expect(await lowFor(tech.client, first.name)).toHaveLength(0);

      await a().put('/v1/notification-rules/consumable.low_stock', { recipient_roles: ['viewer'] });
      const second = await crossing();
      expect(await lowFor(viewer.client, second.name)).toHaveLength(1);
      expect(await lowFor(manager.client, second.name)).toHaveLength(0); // re-addressed
      await a().put('/v1/notification-rules/consumable.low_stock', { recipient_roles: null });
    });

    it('accessories falling to the minimum notify the accessory managers once per crossing', async () => {
      const manager = await member('asset_manager');
      const tech = await member('technician');
      const acc = await newAccessory(a(), { qty_total: 5, min_qty: 2 });
      const person = await a().get('/v1/people?limit=1');
      const out = await a().post(
        `/v1/accessories/${acc.id}/checkout`,
        { person_id: person.body.data[0].id, quantity: 3 },
        keyed(),
      );
      expect(out.status, out.raw).toBe(201);
      await relay();
      await relay(); // a second relay pass delivers nothing new
      const lowFor = async (c: typeof manager.client) =>
        (
          (await c.get('/v1/notifications')).body.data as Array<{
            type: string;
            body: string;
            link: string | null;
          }>
        ).filter((n) => n.type === 'accessory.low_stock' && n.link?.includes(acc.id));
      const got = await lowFor(manager.client);
      expect(got).toHaveLength(1);
      expect(got[0]!.body).toContain('2 available (minimum 2)');
      expect(got[0]!.link).toBe(`/stock/view?kind=accessory&id=${acc.id}`);
      expect(await lowFor(tech.client)).toHaveLength(0); // technicians check out, they do not manage
    });

    it('a label batch tells whoever asked for it when it is ready, and when it failed', async () => {
      const u = await member('asset_manager');
      const asset = await newAsset(a(), b.categoryId);
      const asked = await u.client.post(
        '/v1/labels/batches',
        { template_key: 'letter-30up-qr', asset_ids: [asset.id] },
        keyed(),
      );
      expect(asked.status, asked.raw).toBe(202);
      const batchId = asked.body.id as string;
      const publish = (type: string, payload: Record<string, unknown>) =>
        runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
          outbox.publish(tx, { type, aggregateType: 'label_batch', aggregateId: batchId, payload }),
        );
      await publish('label.batch.ready', { batch_id: batchId, requested_by: u.id, version: 2 });
      await publish('label.batch.failed', { batch_id: batchId, requested_by: u.id, code: 'logo-invalid' });
      await relay();
      const list = (await u.client.get('/v1/notifications')).body.data as Array<{
        type: string;
        title: string;
        body: string;
        link: string | null;
        entity_id: string | null;
      }>;
      const ready = list.find((n) => n.type === 'label.batch.ready');
      expect(ready).toMatchObject({
        title: 'Your labels are ready',
        entity_id: batchId,
        link: `/assets?label_batch=${batchId}`,
      });
      expect(ready!.body).toContain('1 label(s)');
      const failed = list.find((n) => n.type === 'label.batch.failed');
      expect(failed!.body).toContain('logo-invalid');
      // nobody else is told
      const other = await member('asset_manager');
      const theirs = (await other.client.get('/v1/notifications')).body.data as Array<{ type: string }>;
      expect(theirs.map((n) => n.type)).not.toContain('label.batch.ready');
    });
  });

  describe('delivery: dedupe, throttle, digest', () => {
    it('one notification per recipient and dedupe key, however often it is requested', async () => {
      const u = await member();
      const send = () =>
        runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
          notifier.notify(tx, {
            type: 'loan.overdue',
            recipients: [u.id, u.id.toUpperCase()],
            vars: { asset: 'LAP-1', due_date: '2026-11-01', days_overdue: 3, borrower: 'Ada' },
            dedupeKey: `loan.overdue:LAP-1:2026-11-19:${u.id}`,
          }),
        );
      expect(await send()).toEqual({ created: 1, skipped: 0 });
      expect(await send()).toEqual({ created: 0, skipped: 1 });
      expect((await u.client.get('/v1/notifications')).body.data).toHaveLength(1);
      // the next day is a new notification
      await runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
        notifier.notify(tx, {
          type: 'loan.overdue',
          recipients: [u.id],
          vars: { asset: 'LAP-1', due_date: '2026-11-01', days_overdue: 4, borrower: 'Ada' },
          dedupeKey: `loan.overdue:LAP-1:2026-11-20:${u.id}`,
        }),
      );
      expect((await u.client.get('/v1/notifications')).body.data).toHaveLength(2);
      // an unknown type is a programming error, not a silent no-op
      await expect(
        runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
          notifier.notify(tx, { type: 'no.such', recipients: [u.id], vars: {}, dedupeKey: 'x' }),
        ),
      ).rejects.toThrow(/unknown notification type/);
    });

    it('does not notify disabled or unknown users, and never crosses tenants', async () => {
      const u = await member('viewer');
      await a().del(`/v1/users/${u.id}`, undefined, { headers: { 'if-match': '*' } });
      const foreign = await createUser(app, other, 'viewer');
      const result = await runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
        notifier.notify(tx, {
          type: 'export.completed',
          recipients: [u.id, foreign.id, randomUUID()],
          vars: { filename: 'x.csv', rows: 1 },
          dedupeKey: `x-${u.id}`,
        }),
      );
      expect(result.created).toBe(0);
      expect((await foreign.client.get('/v1/notifications')).body.data).toHaveLength(0);
    });

    it('folds the overflow of immediate emails into the digest, then one digest mail lists up to 50 items', async () => {
      const u = await member();
      await u.client.put('/v1/notification-preferences/loan.due_soon', { email: 'immediate' });
      const total = IMMEDIATE_EMAILS_PER_HOUR + 5;
      for (let i = 0; i < total; i++) {
        await runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
          notifier.notify(tx, {
            type: 'loan.due_soon',
            recipients: [u.id],
            vars: { asset: `AST-${i}`, due_date: '2026-12-01' },
            dedupeKey: `due-${u.id}-${i}`,
          }),
        );
      }
      expect(notificationMails(u.email)).toHaveLength(IMMEDIATE_EMAILS_PER_HOUR);
      const log = await deliveries(u.id, '&channel=email');
      expect(log.filter((d) => d.status === 'queued')).toHaveLength(IMMEDIATE_EMAILS_PER_HOUR);
      expect(log.filter((d) => d.status === 'deferred' && d.reason === 'throttled')).toHaveLength(
        5,
      );

      await digest();
      const mails = notificationMails(u.email);
      expect(mails).toHaveLength(IMMEDIATE_EMAILS_PER_HOUR + 1);
      const summary = mails.at(-1)!;
      expect(summary.data.title).toBe('Your daily digest: 5 notification(s)');
      expect(summary.data.items).toHaveLength(5);
      expect(summary.data.moreText).toBeUndefined();
      // a second run has nothing left
      await digest();
      expect(notificationMails(u.email)).toHaveLength(IMMEDIATE_EMAILS_PER_HOUR + 1);
    });

    it('lists 50 items and "and N more" in one digest, never 50 emails', async () => {
      const u = await member();
      await u.client.put('/v1/notification-preferences/loan.due_soon', { email: 'digest' });
      for (let i = 0; i < 60; i++) {
        await runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
          notifier.notify(tx, {
            type: 'loan.due_soon',
            recipients: [u.id],
            vars: { asset: `BIG-${i}`, due_date: '2026-12-01' },
            dedupeKey: `big-${u.id}-${i}`,
          }),
        );
      }
      expect(notificationMails(u.email)).toHaveLength(0);
      await digest();
      const mails = notificationMails(u.email);
      expect(mails).toHaveLength(1);
      expect(mails[0]!.data.items).toHaveLength(50);
      expect(String(mails[0]!.data.moreText)).toContain('10 more');
      expect(mails[0]!.data.title).toBe('Your daily digest: 60 notification(s)');
      // the bell still has all of them
      expect((await u.client.get('/v1/notifications/unread-count')).body.count).toBe(60);
    });

    it('the delivery log is paged and filterable by recipient, channel and status', async () => {
      const u = await member();
      await u.client.put('/v1/notification-preferences/export.completed', { email: 'digest' });
      for (let i = 0; i < 3; i++) {
        await runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
          notifier.notify(tx, {
            type: 'export.completed',
            recipients: [u.id],
            vars: { filename: `d${i}.csv`, rows: 1 },
            dedupeKey: `log-${u.id}-${i}`,
          }),
        );
      }
      const page = await a().get(`/v1/notification-deliveries?user_id=${u.id}&limit=4`);
      expect(page.body.data).toHaveLength(4);
      expect(page.body.page.has_more).toBe(true);
      const rest = await a().get(
        `/v1/notification-deliveries?user_id=${u.id}&limit=4&cursor=${page.body.page.next_cursor}`,
      );
      expect(rest.body.data).toHaveLength(2);
      expect(
        (await a().get(`/v1/notification-deliveries?user_id=${u.id}&status=deferred`)).body.data,
      ).toHaveLength(3);
      expect(
        (
          await a().get(
            `/v1/notification-deliveries?user_id=${u.id}&channel=in_app&type=export.completed`,
          )
        ).body.data,
      ).toHaveLength(3);
      expect((await a().get('/v1/notification-deliveries?status=bogus')).status).toBe(400);
      // another tenant's log is empty
      expect(
        (await other.admin.get(`/v1/notification-deliveries?user_id=${u.id}`)).body.data,
      ).toEqual([]);
    });
  });
});
