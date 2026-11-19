import type { components } from '@assettracker/api-client';
import type { TranslationKey } from '@/i18n';
import { getApi } from '@/lib/api';
import type { Page } from '@/lib/registry/types';
import { routes } from '@/lib/routes';

/** In-app notifications and delivery preferences of the signed-in user (M2-NOT-02). */
type S = components['schemas'];
export type AppNotification = S['Notification'];
export type NotificationList = S['NotificationList'];
export type NotificationPreference = S['NotificationPreference'];
export type Delivery = NotificationPreference['delivery'];

export const DELIVERIES: readonly Delivery[] = ['immediate', 'daily_digest', 'off'];

const http = () => getApi().http;

export const notificationsApi = {
  async list(
    query: { unread?: boolean; cursor?: string; limit?: number } = {},
  ): Promise<NotificationList> {
    const { data } = await http().GET('/v1/notifications', { params: { query } });
    return data as NotificationList;
  },
  async markRead(id: string): Promise<AppNotification> {
    const { data } = await http().POST('/v1/notifications/{id}/read', { params: { path: { id } } });
    return data as AppNotification;
  },
  async markAllRead(): Promise<number> {
    const { data } = await http().POST('/v1/notifications/read-all');
    return (data as S['NotificationsReadAllResult']).updated;
  },
  async preferences(): Promise<NotificationPreference[]> {
    const { data } = await http().GET('/v1/notifications/preferences');
    return (data as S['NotificationPreferences']).data;
  },
  async savePreferences(changes: NotificationPreference[]): Promise<NotificationPreference[]> {
    const { data } = await http().PUT('/v1/notifications/preferences', {
      body: { data: changes },
    });
    return (data as S['NotificationPreferences']).data;
  },
};

export type { Page };

/** Where a notification leads, when it is about a record the app has a page for. */
export function notificationHref(
  notification: Pick<AppNotification, 'entity_type' | 'entity_id'>,
): string | null {
  const { entity_type: type, entity_id: id } = notification;
  if (!type || !id) return null;
  switch (type) {
    case 'asset':
      return routes.assetView(id);
    case 'accessory':
      return routes.stockView('accessory', id);
    case 'consumable':
      return routes.stockView('consumable', id);
    case 'person':
      return routes.personView(id);
    case 'location':
      return routes.locations(id);
    case 'maintenance_record':
    case 'repair':
      return routes.repairs(id);
    default:
      return null;
  }
}

/** "99+" for a long list: the badge never grows wider than three characters. */
export function badgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

const EVENT_KEYS: Record<string, TranslationKey> = {
  'stock.low': 'notifications.events.stock_low',
  'loan.overdue': 'notifications.events.loan_overdue',
  'import.completed': 'notifications.events.import_completed',
  'attachment.infected': 'notifications.events.attachment_infected',
  'label.batch.ready': 'notifications.events.label_batch_ready',
  'export.ready': 'notifications.events.export_ready',
  'repair.opened': 'notifications.events.repair_opened',
  'repair.completed': 'notifications.events.repair_completed',
};

/** Catalogue key of an event type's name, or null for a type this version does not know (show the raw type). */
export function eventLabelKey(eventType: string): TranslationKey | null {
  return EVENT_KEYS[eventType] ?? null;
}
