import { describe, expect, it } from 'vitest';
import {
  badgeCount,
  notificationHref,
  notificationIcon,
  typeLabelKey,
} from '@/lib/notifications/api';
import { dayToInstant, instantToDay, isClosed, totalCost } from './helpers';

describe('repair helpers', () => {
  it('keeps a typed calendar day on that day everywhere (noon UTC)', () => {
    expect(dayToInstant('2026-11-19')).toBe('2026-11-19T12:00:00.000Z');
    expect(instantToDay('2026-11-19T12:00:00.000Z')).toBe('2026-11-19');
    expect(instantToDay(null)).toBe('');
  });

  it('adds the cost per currency and ignores repairs without one', () => {
    expect(
      totalCost([
        { cost: { amount_minor: 6400, currency: 'USD' } },
        { cost: null },
        { cost: { amount_minor: 2200, currency: 'USD' } },
        { cost: { amount_minor: 100, currency: 'EUR' } },
      ]),
    ).toEqual([
      { amount_minor: 8600, currency: 'USD' },
      { amount_minor: 100, currency: 'EUR' },
    ]);
  });

  it('knows which statuses end a repair', () => {
    expect(isClosed({ status: 'completed' })).toBe(true);
    expect(isClosed({ status: 'cancelled' })).toBe(true);
    expect(isClosed({ status: 'open' })).toBe(false);
    expect(isClosed({ status: 'in_progress' })).toBe(false);
  });
});

describe('notification helpers', () => {
  it('links a notification to the page of what it is about', () => {
    const id = '0190a6b2-0008-7000-8000-000000000031';
    const of = (
      type: string,
      entity_type: string | null,
      entity_id: string | null,
      link = null,
    ) => ({
      type,
      link: link as string | null,
      entity_type,
      entity_id,
    });
    expect(notificationHref(of('asset.checked_out', 'asset', id))).toBe(`/assets/view?id=${id}`);
    // the API's link of a low-stock alert is the consumables list, which has no page here
    expect(
      notificationHref(of('consumable.low_stock', 'consumable', id, '/consumables' as never)),
    ).toBe(`/stock/view?kind=consumable&id=${id}`);
    expect(notificationHref(of('accessory.low_stock', 'accessory', id))).toBe(
      `/stock/view?kind=accessory&id=${id}`,
    );
    expect(notificationHref(of('repair.opened', 'maintenance_record', id))).toBe(
      `/repairs?id=${id}`,
    );
    expect(notificationHref(of('label.batch.ready', 'label_batch', id))).toBe(
      `/assets?label_batch=${id}`,
    );
    expect(notificationHref(of('export.completed', 'export', id))).toBe(`/assets?export=${id}`);
  });

  it('falls back to the link of the API when it is a path of this app, and to nothing otherwise', () => {
    const id = '0190a6b2-0008-7000-8000-000000000031';
    expect(
      notificationHref({
        type: 'x.y',
        link: '/people/view?id=1',
        entity_type: 'attachment',
        entity_id: id,
      }),
    ).toBe('/people/view?id=1');
    expect(
      notificationHref({
        type: 'x.y',
        link: 'https://evil.test/',
        entity_type: null,
        entity_id: null,
      }),
    ).toBeNull();
    expect(
      notificationHref({ type: 'x.y', link: '//evil.test/', entity_type: null, entity_id: null }),
    ).toBeNull();
    expect(
      notificationHref({
        type: 'import.completed',
        link: null,
        entity_type: null,
        entity_id: null,
      }),
    ).toBeNull();
  });

  it('caps the badge and names the types it knows', () => {
    expect(badgeCount(7)).toBe('7');
    expect(badgeCount(99)).toBe('99');
    expect(badgeCount(100)).toBe('99+');
    expect(typeLabelKey('consumable.low_stock')).toBe('notifications.types.consumable_low_stock');
    expect(typeLabelKey('something.new')).toBeNull();
    // a type from a newer API still gets an icon
    expect(notificationIcon('something.new')).toBeTruthy();
  });
});
