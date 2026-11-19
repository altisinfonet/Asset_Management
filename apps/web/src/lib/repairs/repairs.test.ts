import { describe, expect, it } from 'vitest';
import { badgeCount, eventLabelKey, notificationHref } from '@/lib/notifications/api';
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
    expect(notificationHref({ entity_type: 'asset', entity_id: id })).toBe(`/assets/view?id=${id}`);
    expect(notificationHref({ entity_type: 'consumable', entity_id: id })).toBe(
      `/stock/view?kind=consumable&id=${id}`,
    );
    expect(notificationHref({ entity_type: 'accessory', entity_id: id })).toBe(
      `/stock/view?kind=accessory&id=${id}`,
    );
    expect(notificationHref({ entity_type: 'maintenance_record', entity_id: id })).toBe(
      `/repairs?id=${id}`,
    );
    expect(notificationHref({ entity_type: 'import_job', entity_id: id })).toBeNull();
    expect(notificationHref({ entity_type: null, entity_id: null })).toBeNull();
  });

  it('caps the badge and names the events it knows', () => {
    expect(badgeCount(7)).toBe('7');
    expect(badgeCount(99)).toBe('99');
    expect(badgeCount(100)).toBe('99+');
    expect(eventLabelKey('stock.low')).toBe('notifications.events.stock_low');
    expect(eventLabelKey('something.new')).toBeNull();
  });
});
