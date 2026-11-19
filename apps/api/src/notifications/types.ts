/**
 * The notification type registry (M2-NOT-01): every kind of notification the product can send, with
 * what it means, who gets it by default and how it is delivered until the user decides otherwise.
 * Modules register their types HERE (one entry each); the texts live in `templates.ts`; the outbox
 * events that produce them are mapped in `subscriptions.ts`. `GET /v1/notification-preferences` and
 * `GET /v1/notification-rules` are generated from this table, and a type that is not in it cannot be
 * stored in `notification_rule` / `notification_preference` or notified.
 */
export type EmailMode = 'immediate' | 'digest' | 'off';
export const EMAIL_MODES: readonly EmailMode[] = ['immediate', 'digest', 'off'];

export interface NotificationTypeDef {
  /** Short name shown in the preferences screen. */
  label: string;
  /** One sentence: when this notification is sent. */
  description: string;
  /** Who gets it by default, in words (admin rules screen). */
  recipients: string;
  /**
   * The recipients are "users that hold a permission", so an administrator may address the type to
   * other roles (`notification_rule.recipient_roles`). Types addressed to one specific user (the
   * uploader, the borrower) are not configurable.
   */
  roleConfigurable: boolean;
  /** What a user gets until they choose. */
  defaults: { inApp: boolean; email: EmailMode };
}

export const NOTIFICATION_TYPES = {
  // ---- events that exist on main today
  'attachment.infected': {
    label: 'File blocked by the virus scan',
    description: 'A file you uploaded was found to contain malware and was removed.',
    recipients: 'The user who uploaded the file.',
    roleConfigurable: false,
    defaults: { inApp: true, email: 'immediate' },
  },
  'asset.checked_out': {
    label: 'Asset assigned to you',
    description: 'An asset was checked out to you.',
    recipients: 'The person the asset was checked out to, when they have a login.',
    roleConfigurable: false,
    defaults: { inApp: true, email: 'off' },
  },
  'export.completed': {
    label: 'Export ready',
    description: 'A CSV export you requested is ready to download.',
    recipients: 'The user who requested the export.',
    roleConfigurable: false,
    defaults: { inApp: true, email: 'off' },
  },
  // ---- events other M2 stories emit (their subscriptions are listed in subscriptions.ts)
  'consumable.low_stock': {
    label: 'Low stock',
    description: 'A consumable fell to or below its reorder level.',
    recipients: 'Users who manage consumables.',
    roleConfigurable: true,
    defaults: { inApp: true, email: 'digest' },
  },
  'label.batch.ready': {
    label: 'Labels ready',
    description: 'A batch of labels you asked for is ready to print.',
    recipients: 'The user who requested the batch.',
    roleConfigurable: false,
    defaults: { inApp: true, email: 'off' },
  },
  'loan.overdue': {
    label: 'Loan overdue',
    description: 'A loaned asset was not returned by its due date.',
    recipients: 'The borrower (when they have a login) and users who manage loaner pools.',
    roleConfigurable: true,
    defaults: { inApp: true, email: 'immediate' },
  },
  'loan.due_soon': {
    label: 'Loan due soon',
    description: 'A loaned asset is due back shortly.',
    recipients: 'The borrower, when they have a login.',
    roleConfigurable: false,
    defaults: { inApp: true, email: 'immediate' },
  },
  'import.completed': {
    label: 'Import finished',
    description: 'An import you started has finished.',
    recipients: 'The user who ran the import.',
    roleConfigurable: false,
    defaults: { inApp: true, email: 'immediate' },
  },
} as const satisfies Record<string, NotificationTypeDef>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

export function isNotificationType(value: string): value is NotificationType {
  return Object.hasOwn(NOTIFICATION_TYPES, value);
}

export const typeDef = (type: string): NotificationTypeDef | undefined =>
  isNotificationType(type) ? NOTIFICATION_TYPES[type] : undefined;
