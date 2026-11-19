// Public facade of the notifications module (M2-NOT). Other modules inject the NOTIFIER port
// (src/ports) and add their events to `NOTIFICATION_SUBSCRIPTIONS` / `NOTIFICATION_TYPES`.
export { DIGEST_JOB } from './digest.js';
export { NotificationsModule } from './notifications.module.js';
export {
  DIGEST_MAX_ITEMS,
  IMMEDIATE_EMAILS_PER_HOUR,
  NotificationService,
} from './notification.service.js';
export { NotificationSubscribers } from './subscribers.js';
export {
  NOTIFICATION_SUBSCRIPTIONS,
  type Described,
  type Subscription,
} from './subscriptions.js';
export { renderNotification } from './templates.js';
export {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_KEYS,
  isNotificationType,
  type EmailMode,
  type NotificationType,
  type NotificationTypeDef,
} from './types.js';
