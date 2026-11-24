import type { components } from '@assettracker/api-client';
import {
  Boxes,
  FileDown,
  LogOut,
  Package,
  Printer,
  ShieldAlert,
  Timer,
  Upload,
  Wrench,
  Bell,
  type LucideIcon,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n';
import { getApi } from '@/lib/api';
import type { Page } from '@/lib/registry/types';
import { routes } from '@/lib/routes';

/**
 * In-app notifications and delivery preferences of the signed-in user (M2-NOT-02), and the
 * organisation's notification rules (M2-NOT-01, `notification:manage`). Notifications and
 * preferences are self-service: a browser session, not an API key.
 */
type S = components['schemas'];
export type AppNotification = S['Notification'];
export type NotificationList = S['NotificationList'];
export type NotificationPreference = S['NotificationPreference'];
export type EmailMode = NotificationPreference['email'];
export type NotificationRule = S['NotificationRule'];

export const EMAIL_MODES: readonly EmailMode[] = ['immediate', 'digest', 'off'];

/** Permission to change which notification types are enabled and who receives them. */
export const MANAGE_NOTIFICATIONS = 'notification:manage';

const http = () => getApi().http;

export const notificationsApi = {
  async list(
    query: { unread?: boolean; cursor?: string; limit?: number } = {},
  ): Promise<NotificationList> {
    const { data } = await http().GET('/v1/notifications', { params: { query } });
    return data as NotificationList;
  },
  /** The badge of the bell (`GET /v1/notifications/unread-count`). */
  async unreadCount(): Promise<number> {
    const { data } = await http().GET('/v1/notifications/unread-count');
    return (data as S['NotificationUnreadCount']).count;
  },
  async markRead(id: string): Promise<AppNotification> {
    const { data } = await http().POST('/v1/notifications/{id}/read', {
      params: { path: { id } },
    });
    return data as AppNotification;
  },
  async markAllRead(): Promise<number> {
    const { data } = await http().POST('/v1/notifications/read-all');
    return (data as S['NotificationReadAllResult']).updated;
  },
  async preferences(): Promise<NotificationPreference[]> {
    const { data } = await http().GET('/v1/notification-preferences');
    return (data as S['NotificationPreferenceList']).data;
  },
  /** Choose in-app and email delivery of one type; omitted fields keep their value. */
  async savePreference(
    type: string,
    body: { in_app?: boolean; email?: EmailMode },
  ): Promise<NotificationPreference> {
    const { data } = await http().PUT('/v1/notification-preferences/{type}', {
      params: { path: { type } },
      body,
    });
    return data as NotificationPreference;
  },
  async rules(): Promise<NotificationRule[]> {
    const { data } = await http().GET('/v1/notification-rules');
    return (data as S['NotificationRuleList']).data;
  },
  async saveRule(
    type: string,
    body: { enabled?: boolean; recipient_roles?: string[] | null },
  ): Promise<NotificationRule> {
    const { data } = await http().PUT('/v1/notification-rules/{type}', {
      params: { path: { type } },
      body,
    });
    return data as NotificationRule;
  },
};

export type { Page };

/** "99+" for a long list: the badge never grows wider than three characters. */
export function badgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

// ---- what a notification looks like and where it leads -----------------------------------------

interface TypeInfo {
  icon: LucideIcon;
  /** Catalogue key of the type's short name. */
  label: TranslationKey;
}

/**
 * The types the API sends today (`apps/api/src/notifications/types.ts`) and the events the other
 * M2 modules emit. A type this version does not know still shows with the server's own title and
 * a plain bell.
 */
const TYPES: Record<string, TypeInfo> = {
  'consumable.low_stock': { icon: Boxes, label: 'notifications.types.consumable_low_stock' },
  'accessory.low_stock': { icon: Package, label: 'notifications.types.accessory_low_stock' },
  'label.batch.ready': { icon: Printer, label: 'notifications.types.label_batch_ready' },
  'label.batch.failed': { icon: Printer, label: 'notifications.types.label_batch_failed' },
  'export.completed': { icon: FileDown, label: 'notifications.types.export_completed' },
  'attachment.infected': { icon: ShieldAlert, label: 'notifications.types.attachment_infected' },
  'asset.checked_out': { icon: LogOut, label: 'notifications.types.asset_checked_out' },
  'loan.overdue': { icon: Timer, label: 'notifications.types.loan_overdue' },
  'loan.due_soon': { icon: Timer, label: 'notifications.types.loan_due_soon' },
  'import.completed': { icon: Upload, label: 'notifications.types.import_completed' },
  'repair.opened': { icon: Wrench, label: 'notifications.types.repair_opened' },
  'repair.completed': { icon: Wrench, label: 'notifications.types.repair_completed' },
};

export function notificationIcon(type: string): LucideIcon {
  return TYPES[type]?.icon ?? Bell;
}

/** Catalogue key of a type's name, or null for a type this version does not know (show the raw type). */
export function typeLabelKey(type: string): TranslationKey | null {
  return TYPES[type]?.label ?? null;
}

/** A path of this web app (`/assets/view?id=...`), never another site. */
function isAppPath(link: string): boolean {
  return /^\/(?!\/)[^\s\\]*$/.test(link);
}

/**
 * Where a notification leads. The subject decides first, because the web app has a page for it
 * (a consumable, an accessory, a repair, a label batch, an export); a type with no page of its own
 * uses the `link` the API sent when it is a path of this app.
 */
export function notificationHref(
  notification: Pick<AppNotification, 'type' | 'link' | 'entity_type' | 'entity_id'>,
): string | null {
  const { entity_type: entity, entity_id: id } = notification;
  if (entity && id) {
    switch (entity) {
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
      case 'label_batch':
        return routes.labelBatch(id);
      case 'export':
        return routes.exportJob(id);
      case 'import_job':
      case 'import':
        return routes.importJob(id);
      case 'loaner_pool':
        return routes.loanerPool(id);
      default:
        break;
    }
  }
  return notification.link && isAppPath(notification.link) ? notification.link : null;
}
