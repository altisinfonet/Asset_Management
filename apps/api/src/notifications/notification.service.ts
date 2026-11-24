import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { uuidv7 } from '../ids/uuidv7.js';
import {
  MAIL_SENDER,
  type EmailNotificationRequest,
  type MailSender,
  type NotificationRequest,
  type Notifier,
  type NotifyResult,
} from '../ports/index.js';
import type { Tx } from '../tenancy/index.js';
import { renderNotification } from './templates.js';
import { type EmailMode, isNotificationType, typeDef } from './types.js';

/**
 * More than this many IMMEDIATE emails to one user within an hour are folded into the daily digest
 * instead ("one digest of 50 items, not 50 emails", M2-NOT-01).
 */
export const IMMEDIATE_EMAILS_PER_HOUR = 10;
/** The digest lists at most this many items; the rest is "and N more". */
export const DIGEST_MAX_ITEMS = 50;

const emailAddress = z.email().max(254);

type Delivery = {
  notification_id: string | null;
  user_id: string;
  type: string;
  channel: 'in_app' | 'email';
  status: 'delivered' | 'queued' | 'deferred' | 'skipped' | 'failed';
  reason: string | null;
};

/** The tenant of the transaction (set by `withTenantTx`), for rows inserted without a Prisma tenant field. */
export async function tenantOf(tx: Tx): Promise<string> {
  const [row] = await tx.$queryRaw<Array<{ id: string | null }>>`
    select nullif(current_setting('app.tenant_id', true), '')::uuid as id`;
  if (!row?.id)
    throw new Error('notifications need a tenant transaction (app.tenant_id is not set)');
  return row.id;
}

/**
 * The NOTIFIER port (M2-NOT-01, ADR 0009). For each recipient: apply the tenant rule (a type switched
 * off notifies nobody) and the user's preference, create the in-app row (unique per recipient and
 * `dedupeKey`, so a redelivered outbox event is a no-op), then email it: immediately through the
 * MAIL_SENDER port (rate-limited per user, the overflow joins the digest), into the daily digest
 * (`email_state = pending_digest`, flushed by the `notification.digest` job), or not at all. Every
 * decision is written to `notification_delivery`, the log administrators read.
 *
 * Runs in the CALLER's tenant transaction (the outbox relay's, a job's or a request's): the rows and
 * the queued mail commit or roll back together with the change that caused them.
 */
@Injectable()
export class NotificationService implements Notifier {
  constructor(
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async notify(tx: Tx, request: NotificationRequest): Promise<NotifyResult> {
    const def = typeDef(request.type);
    if (!def || !isNotificationType(request.type)) {
      throw new Error(`unknown notification type "${request.type}" (src/notifications/types.ts)`);
    }
    const recipients = [...new Set(request.recipients.map((id) => id.toLowerCase()))];
    if (recipients.length === 0) return { created: 0, skipped: 0 };

    const rule = await tx.notification_rule.findFirst({ where: { type: request.type } });
    if (rule && !rule.enabled) return { created: 0, skipped: recipients.length };

    const users = await tx.user_account.findMany({
      where: { id: { in: recipients }, status: 'active', archived_at: null },
      select: { id: true, email: true, locale: true },
    });
    const prefs = new Map(
      (
        await tx.notification_preference.findMany({
          where: { user_id: { in: recipients }, type: request.type },
        })
      ).map((p) => [p.user_id, p]),
    );
    const tenantId = await tenantOf(tx);
    const deliveries: Delivery[] = [];
    let created = 0;
    let skipped = recipients.length - users.length;

    for (const user of users) {
      const pref = prefs.get(user.id);
      const inApp = pref ? pref.in_app : def.defaults.inApp;
      let email: EmailMode = pref ? (pref.email as EmailMode) : def.defaults.email;
      if (!inApp && email === 'off') {
        skipped += 1;
        deliveries.push(log(null, user.id, request.type, 'in_app', 'skipped', 'preference-off'));
        continue;
      }
      const { title, body } = renderNotification(request.type, user.locale, request.vars);
      const [row] = await tx.$queryRaw<Array<{ id: string }>>`
        insert into app.notification
          (id, tenant_id, user_id, type, title, body, link, entity_type, entity_id, dedupe_key, in_app)
        values (${uuidv7()}::uuid, ${tenantId}::uuid, ${user.id}::uuid, ${request.type}::text,
                ${title}::text, ${body || null}::text, ${request.link ?? null}::text,
                ${request.entity?.type ?? null}::text, ${request.entity?.id ?? null}::uuid,
                ${request.dedupeKey.slice(0, 200)}::text, ${inApp}::boolean)
        on conflict (tenant_id, user_id, dedupe_key) do nothing
        returning id`;
      if (!row) {
        skipped += 1; // the same event reached this recipient before
        continue;
      }
      created += 1;
      deliveries.push(
        inApp
          ? log(row.id, user.id, request.type, 'in_app', 'delivered', null)
          : log(row.id, user.id, request.type, 'in_app', 'skipped', 'preference-off'),
      );

      let reason: string | null = null;
      if (
        email === 'immediate' &&
        (await this.recentImmediate(tx, user.id)) >= IMMEDIATE_EMAILS_PER_HOUR
      ) {
        email = 'digest';
        reason = 'throttled';
      }
      if (email === 'off') {
        deliveries.push(log(row.id, user.id, request.type, 'email', 'skipped', 'preference-off'));
      } else if (!emailAddress.safeParse(user.email).success) {
        deliveries.push(log(row.id, user.id, request.type, 'email', 'skipped', 'no-email'));
      } else if (email === 'digest') {
        await tx.notification.updateMany({
          where: { id: row.id },
          data: { email_state: 'pending_digest' },
        });
        deliveries.push(
          log(row.id, user.id, request.type, 'email', 'deferred', reason ?? 'digest'),
        );
      } else {
        await this.mail.send({
          to: user.email,
          template: 'notification.message',
          ...(user.locale ? { locale: user.locale } : {}),
          data: {
            title,
            ...(body ? { body } : {}),
            ...(request.link ? { url: this.absolute(request.link) } : {}),
          },
        });
        await tx.notification.updateMany({
          where: { id: row.id },
          data: { email_state: 'queued' },
        });
        deliveries.push(log(row.id, user.id, request.type, 'email', 'queued', null));
      }
    }
    await this.writeDeliveries(tx, tenantId, deliveries);
    return { created, skipped };
  }

  /**
   * Mail to addresses that belong to no login account (ED-24: a borrower without a login). There is
   * no in-app row and no per-user preference; the tenant rule of the type (switched off = nothing
   * sent) still applies. The caller guarantees "once" (the loan alert ledger); the mail carries no
   * link because the recipient cannot sign in.
   */
  async notifyEmail(tx: Tx, request: EmailNotificationRequest): Promise<NotifyResult> {
    const def = typeDef(request.type);
    if (!def || !isNotificationType(request.type)) {
      throw new Error(`unknown notification type "${request.type}" (src/notifications/types.ts)`);
    }
    const seen = new Set<string>();
    const targets = request.recipients.filter((r) => {
      const key = r.email.trim().toLowerCase();
      if (seen.has(key) || !emailAddress.safeParse(r.email.trim()).success) return false;
      seen.add(key);
      return true;
    });
    const skipped = request.recipients.length - targets.length;
    if (targets.length === 0) return { created: 0, skipped };
    const rule = await tx.notification_rule.findFirst({ where: { type: request.type } });
    if (rule && !rule.enabled) return { created: 0, skipped: request.recipients.length };
    for (const target of targets) {
      const { title, body } = renderNotification(request.type, target.locale, request.vars);
      await this.mail.send({
        to: target.email.trim(),
        template: 'notification.message',
        ...(target.locale ? { locale: target.locale } : {}),
        data: { title, ...(body ? { body } : {}) },
      });
    }
    return { created: targets.length, skipped };
  }

  /** Immediate emails queued for the user during the last hour (the throttle). */
  private async recentImmediate(tx: Tx, userId: string): Promise<number> {
    const [row] = await tx.$queryRaw<Array<{ n: bigint }>>`
      select count(*) as n from app.notification_delivery
       where user_id = ${userId}::uuid and channel = 'email' and status = 'queued' and reason is null
         and created_at > now() - interval '1 hour'`;
    return Number(row?.n ?? 0n);
  }

  /** An in-app path as an absolute link into the web app (mail needs a full URL). */
  absolute(path: string): string {
    return `${this.config.WEB_BASE_URL.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async writeDeliveries(tx: Tx, tenantId: string, rows: readonly Delivery[]): Promise<void> {
    if (rows.length === 0) return;
    await tx.notification_delivery.createMany({
      data: rows.map((r) => ({ id: uuidv7(), tenant_id: tenantId, ...r })),
    });
  }
}

export function log(
  notificationId: string | null,
  userId: string,
  type: string,
  channel: Delivery['channel'],
  status: Delivery['status'],
  reason: string | null,
): Delivery {
  return { notification_id: notificationId, user_id: userId, type, channel, status, reason };
}
