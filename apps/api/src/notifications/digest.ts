import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { TenantJobContext } from '../jobs/index.js';
import { MAIL_SENDER, type MailSender } from '../ports/index.js';
import {
  DIGEST_MAX_ITEMS,
  NotificationService,
  log,
  tenantOf,
} from './notification.service.js';
import { renderMore, renderNotification } from './templates.js';

/** Queue name (src/jobs/catalogue.ts). */
export const DIGEST_JOB = 'notification.digest';

const emailAddress = z.email().max(254);
/** Notifications of one user flushed per round; a backlog is drained over a few rounds. */
const ROUND = 1000;
const MAX_ROUNDS = 5;

/**
 * `notification.digest` { tenantId } (daily, per tenant, from the scheduler; M2-NOT-01): for every user
 * with notifications waiting in `email_state = pending_digest`, ONE email that lists up to 50 of them
 * ("and N more" after that), then the notifications are marked `digested`. Runs inside the worker's
 * tenant transaction like every tenant job: the mail is queued (MailSender), the rows are updated and
 * the delivery log is written atomically, so a failure retries the whole digest and never mails twice.
 */
@Injectable()
export class NotificationDigest {
  constructor(
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    private readonly notifications: NotificationService,
  ) {}

  async run(_payload: { tenantId: string }, ctx: TenantJobContext): Promise<void> {
    const { tx } = ctx;
    const tenantId = await tenantOf(tx);
    const waiting = await tx.$queryRaw<Array<{ user_id: string }>>`
      select distinct user_id from app.notification where email_state = 'pending_digest'`;
    let mails = 0;
    for (const { user_id: userId } of waiting) {
      const user = await tx.user_account.findUnique({
        where: { id: userId },
        select: { id: true, email: true, locale: true, status: true },
      });
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const items = await tx.notification.findMany({
          where: { user_id: userId, email_state: 'pending_digest' },
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          take: ROUND,
          select: { id: true, title: true },
        });
        if (items.length === 0) break;
        const ids = items.map((i) => i.id);
        if (!user || user.status !== 'active' || !emailAddress.safeParse(user.email).success) {
          await tx.notification.updateMany({ where: { id: { in: ids } }, data: { email_state: 'digested' } });
          await this.notifications.writeDeliveries(tx, tenantId, [
            log(null, userId, 'notification.digest', 'email', 'skipped', 'no-email'),
          ]);
          continue;
        }
        const listed = items.slice(0, DIGEST_MAX_ITEMS).map((i) => i.title);
        const more = items.length - listed.length;
        const { title, body } = renderNotification('digest', user.locale, { count: items.length });
        await this.mail.send({
          to: user.email,
          template: 'notification.message',
          ...(user.locale ? { locale: user.locale } : {}),
          data: {
            title,
            body,
            items: listed,
            ...(more > 0 ? { moreText: renderMore(user.locale, more) } : {}),
            url: this.notifications.absolute('/'),
          },
        });
        await tx.notification.updateMany({ where: { id: { in: ids } }, data: { email_state: 'digested' } });
        await this.notifications.writeDeliveries(tx, tenantId, [
          log(null, userId, 'notification.digest', 'email', 'queued', 'digest'),
        ]);
        mails += 1;
      }
    }
    ctx.logger.info({ users: waiting.length, mails }, 'notification digest flushed');
  }
}
