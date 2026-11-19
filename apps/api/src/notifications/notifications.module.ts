import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry } from '../jobs/index.js';
import { NOTIFIER } from '../ports/index.js';
import { DIGEST_JOB, NotificationDigest } from './digest.js';
import { NotificationService } from './notification.service.js';
import { NotificationsApiService } from './notifications-api.service.js';
import {
  NotificationAdminController,
  NotificationsController,
} from './notifications.controller.js';
import { NotificationSubscribers } from './subscribers.js';

/**
 * Notifications (M2-NOT-01, ADR 0009): the NOTIFIER port and its implementation, the outbox
 * subscriptions that turn domain events into notifications (`subscriptions.ts`), the inbox, preference,
 * rule and delivery-log endpoints, and the daily digest job. Global because the NOTIFIER port is what
 * every other module injects; the module itself depends only on kernel ports (MAIL_SENDER,
 * OutboxSubscribers, the job registry) and the registry facade's shared plumbing.
 */
@Global()
@Module({
  controllers: [NotificationsController, NotificationAdminController],
  providers: [
    NotificationService,
    { provide: NOTIFIER, useExisting: NotificationService },
    NotificationsApiService,
    NotificationSubscribers,
    NotificationDigest,
  ],
  exports: [NOTIFIER],
})
export class NotificationsModule implements OnModuleInit {
  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly digest: NotificationDigest,
  ) {}

  onModuleInit(): void {
    this.registry.registerTenant(DIGEST_JOB, (payload, ctx) => this.digest.run(payload, ctx));
  }
}
