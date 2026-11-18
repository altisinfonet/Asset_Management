import type { JobHandlerRegistry } from '../jobs/index.js';
import type { SecretBox } from '../ports/index.js';
import { MAIL_JOB, type StoredMail, mailContext } from './mail-sender.js';
import { renderTemplate } from './templates.js';
import type { MailTransport } from './transport.js';

interface MailRow {
  template: string;
  locale: string | null;
  status: string;
  message_enc: Uint8Array | null;
}

/**
 * The worker side of `MailSender.send` (queue `mail.send`, payload `{ tenantId, mailId }`).
 * Runs inside the job wrapper's tenant transaction:
 *
 *   lock the row (FOR UPDATE) -> already sent? done (idempotent redelivery)
 *   -> decrypt (context `<tenant>:mail:<id>`) -> render (locale, plain text + HTML) -> SMTP
 *   -> mark sent and DROP the stored message (no reset/invite token outlives its delivery).
 *
 * An SMTP or decrypt failure throws: the transaction rolls back, the job is retried with backoff
 * (catalogue: 6 retries) and finally dead-lettered. Delivery is at-least-once: a crash between the
 * SMTP acknowledgement and the commit sends the mail again on retry.
 */
export function registerMailJob(
  registry: JobHandlerRegistry,
  deps: { secrets: SecretBox; transport: MailTransport; from: string },
): void {
  registry.registerTenant(MAIL_JOB, async (payload, ctx) => {
    const mailId = String(payload.mailId ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(mailId)) throw new Error('mail.send payload has no valid mailId');

    const rows = await ctx.tx.$queryRaw<MailRow[]>`
      select template, locale, status, message_enc
        from app.mail_outbox
       where id = ${mailId}::uuid
         for update`;
    const row = rows[0];
    if (!row) throw new Error(`mail ${mailId} not found for tenant ${ctx.tenantId}`);
    if (row.status === 'sent' || !row.message_enc) {
      ctx.logger.info({ mail_id: mailId }, 'mail already sent, skipping');
      return;
    }

    const plaintext = await deps.secrets.decrypt(
      row.message_enc,
      mailContext(ctx.tenantId, mailId),
    );
    const stored = JSON.parse(new TextDecoder().decode(plaintext)) as StoredMail;
    const email = renderTemplate(row.template, row.locale ?? undefined, stored.data);

    const { messageId } = await deps.transport.deliver({
      from: deps.from,
      to: stored.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      reference: mailId,
    });
    await ctx.tx.$executeRaw`
      update app.mail_outbox
         set status = 'sent', sent_at = now(), message_enc = null
       where id = ${mailId}::uuid`;
    // The address is deliberately not logged (PII).
    ctx.logger.info(
      { mail_id: mailId, template: row.template, message_id: messageId },
      'mail sent',
    );
  });
}
