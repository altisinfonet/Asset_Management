import { describe, expect, it, vi } from 'vitest';
import type { OutboxDelivery } from '../outbox/index.js';
import { FakeNotifier } from '../ports/fakes.js';
import type { Tx } from '../tenancy/index.js';
import { payloadUser } from './recipients.js';
import { NotificationSubscribers } from './subscribers.js';
import { NOTIFICATION_SUBSCRIPTIONS, type Subscription } from './subscriptions.js';
import { CATALOGUES, en, renderMore, renderNotification } from './templates.js';
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_KEYS, isNotificationType } from './types.js';

const EVENT_TYPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const USER = '0192a000-0000-7000-8000-000000000001';

const delivery = (over: Partial<OutboxDelivery> = {}): OutboxDelivery => ({
  id: '0192a000-0000-7000-8000-0000000000e1',
  tenantId: '0192a000-0000-7000-8000-0000000000aa',
  type: 'attachment.infected',
  aggregateType: 'attachment',
  aggregateId: '0192a000-0000-7000-8000-0000000000a1',
  payload: { uploaded_by: USER },
  version: 1,
  createdAt: new Date(),
  attempts: 0,
  ...over,
});

describe('notification types and texts (M2-NOT-01)', () => {
  it('every type is a dotted lower-case key with a title and a body in English', () => {
    for (const type of NOTIFICATION_TYPE_KEYS) {
      expect(type, type).toMatch(EVENT_TYPE);
      expect(en[`notification.${type}.title`], `${type} title`).toBeTruthy();
      expect(en[`notification.${type}.body`], `${type} body`).toBeTruthy();
      const def = NOTIFICATION_TYPES[type];
      expect(def.label.length).toBeGreaterThan(3);
      expect(['immediate', 'digest', 'off']).toContain(def.defaults.email);
    }
  });

  it('has a template for the types other M2 stories emit (low stock, label batch, loans, import)', () => {
    for (const type of [
      'consumable.low_stock',
      'accessory.low_stock',
      'label.batch.ready',
      'label.batch.failed',
      'loan.overdue',
      'loan.due_soon',
      'import.completed',
    ]) {
      expect(isNotificationType(type), type).toBe(true);
      const text = renderNotification(type as never, 'en', {
        name: 'Toner',
        detail: '3 left.',
        asset: 'LAP-1',
        due_date: '2026-12-01',
        days_overdue: 2,
        borrower: 'Ada',
        escalation: 'Please return it.',
        filename: 'a.csv',
        created: 1,
        updated: 2,
        failed: 0,
      });
      expect(text.title, type).not.toMatch(/[{}]|notification\./);
      expect(text.body, type).not.toMatch(/[{}]|notification\./);
    }
  });

  it('fills placeholders, renders a missing variable as empty and falls back to English', () => {
    const t = renderNotification('attachment.infected', 'fr-CA', {
      filename: 'invoice.pdf',
      signature: 'Eicar',
    });
    expect(t.title).toBe('A file you uploaded was blocked');
    expect(t.body).toContain('"invoice.pdf"');
    expect(t.body).toContain('Eicar');
    const blank = renderNotification('asset.checked_out', 'en', { asset: 'LAP-1' });
    expect(blank.body).toBe('LAP-1 is now assigned to you.');
    expect(Object.keys(CATALOGUES)).toEqual(['en']);
    expect(renderMore('en', 12)).toContain('12 more');
  });

  it('keeps the title and body within the column limits', () => {
    const t = renderNotification('attachment.infected', 'en', {
      filename: 'x'.repeat(5000),
      signature: 'y',
    });
    expect(t.body.length).toBeLessThanOrEqual(2000);
    expect(t.title.length).toBeLessThanOrEqual(300);
  });
});

describe('the subscriber mapping table', () => {
  it('maps real outbox event types to registered notification types, once each', () => {
    const seen = new Set<string>();
    for (const sub of NOTIFICATION_SUBSCRIPTIONS) {
      expect(sub.event, sub.event).toMatch(EVENT_TYPE);
      expect(isNotificationType(sub.type), sub.type).toBe(true);
      expect(seen.has(sub.event), `duplicate entry for ${sub.event}`).toBe(false);
      seen.add(sub.event);
    }
    // what main emits today, plus the two events the parallel M2 stories emit
    for (const event of [
      'attachment.infected',
      'asset.checked_out',
      'export.completed',
      'consumable.low_stock',
      'accessory.low_stock',
      'label.batch.ready',
      'label.batch.failed',
      'loan.overdue',
      'loan.due_soon',
    ]) {
      expect(seen.has(event), event).toBe(true);
    }
  });
});

describe('NotificationSubscribers.handle', () => {
  const notifier = () => new FakeNotifier();
  const subscribers = (n: FakeNotifier) => new NotificationSubscribers({} as never, n);
  const sub = (over: Partial<Subscription> = {}): Subscription => ({
    event: 'attachment.infected',
    type: 'attachment.infected',
    recipients: payloadUser('uploaded_by'),
    describe: () => Promise.resolve({ vars: { filename: 'a.pdf', signature: 'x' } }),
    ...over,
  });
  const SITE = '0192a000-0000-7000-8000-0000000000c1';
  const OTHER_SITE = '0192a000-0000-7000-8000-0000000000c2';
  /** A fake transaction: the rule, an asset at SITE and the role assignments of the recipients. */
  const txWith = (
    rule: unknown,
    assignments: Array<{
      user_id: string;
      scope_type: string;
      scope_location_id: string | null;
    }> = [],
  ): Tx =>
    ({
      notification_rule: { findFirst: vi.fn().mockResolvedValue(rule) },
      person: { findUnique: vi.fn().mockResolvedValue(null) },
      asset: { findUnique: vi.fn().mockResolvedValue({ location_id: SITE }) },
      location: { findUnique: vi.fn().mockResolvedValue({ ancestor_ids: [SITE] }) },
      role_assignment: {
        findMany: vi.fn().mockResolvedValue(
          assignments.map((a, i) => ({
            id: `ra-${i}`,
            role_id: 'role',
            scope_company_id: null,
            role: { key: 'technician', permissions: ['asset:read'] },
            ...a,
          })),
        ),
      },
    }) as unknown as Tx;

  it('asks the notifier for the recipient the event names, deduplicated by event id', async () => {
    const n = notifier();
    await subscribers(n).handle(sub(), delivery(), txWith(null));
    expect(n.requests).toHaveLength(1);
    expect(n.requests[0]).toMatchObject({
      type: 'attachment.infected',
      recipients: [USER],
      dedupeKey: '0192a000-0000-7000-8000-0000000000e1',
    });
  });

  it('does nothing when the organisation switched the type off', async () => {
    const n = notifier();
    await subscribers(n).handle(sub(), delivery(), txWith({ enabled: false, recipient_roles: [] }));
    expect(n.requests).toEqual([]);
  });

  it('does nothing when there is nobody to tell or nothing to say', async () => {
    const n = notifier();
    await subscribers(n).handle(sub(), delivery({ payload: {} }), txWith(null));
    await subscribers(n).handle(
      sub({ describe: () => Promise.resolve(null) }),
      delivery(),
      txWith(null),
    );
    expect(n.requests).toEqual([]);
  });

  it("uses the entry's own dedupe key, and links and entities when described", async () => {
    const n = notifier();
    await subscribers(n).handle(
      sub({
        dedupe: (e) => `k:${e.aggregateId}`,
        describe: () =>
          Promise.resolve({
            vars: {},
            link: '/assets/view?id=1',
            entity: { type: 'asset', id: USER },
          }),
      }),
      delivery(),
      txWith(null),
    );
    expect(n.requests[0]).toMatchObject({
      dedupeKey: 'k:0192a000-0000-7000-8000-0000000000a1',
      link: '/assets/view?id=1',
      entity: { type: 'asset', id: USER },
    });
  });

  // M2-LOC-03 (ED-26)
  it('does not tell a location-scoped user about an asset outside their scope', async () => {
    const aboutAsset = sub({
      describe: () => Promise.resolve({ vars: {}, entity: { type: 'asset', id: USER } }),
    });
    const outside = notifier();
    await subscribers(outside).handle(
      aboutAsset,
      delivery(),
      txWith(null, [{ user_id: USER, scope_type: 'location', scope_location_id: OTHER_SITE }]),
    );
    expect(outside.requests).toEqual([]);

    const inside = notifier();
    await subscribers(inside).handle(
      aboutAsset,
      delivery(),
      txWith(null, [{ user_id: USER, scope_type: 'location', scope_location_id: SITE }]),
    );
    expect(inside.requests[0]).toMatchObject({ recipients: [USER] });

    const orgWide = notifier();
    await subscribers(orgWide).handle(
      aboutAsset,
      delivery(),
      txWith(null, [
        { user_id: USER, scope_type: 'location', scope_location_id: OTHER_SITE },
        { user_id: USER, scope_type: 'tenant', scope_location_id: null },
      ]),
    );
    expect(orgWide.requests[0]).toMatchObject({ recipients: [USER] });
  });
});
