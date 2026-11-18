import { z } from 'zod';
import { uuidv7 } from '../ids/uuidv7.js';
import type { JobQueue, MailMessage, MailSender, SecretBox } from '../ports/index.js';
import {
  asBytes,
  currentTenantContext,
  currentTenantTx,
  NoTenantTransactionError,
} from '../tenancy/index.js';
import { parseTemplateData } from './templates.js';

export const MAIL_JOB = 'mail.send';
const recipient = z.email().max(254);

/** The AAD every mail envelope is bound to: only this tenant's worker, for this mail row, can open it. */
export const mailContext = (tenantId: string, mailId: string): string =>
  `${tenantId}:mail:${mailId}`;

/** What is encrypted into `app.mail_outbox.message_enc`. */
export interface StoredMail {
  to: string;
  data: Record<string, unknown>;
}

/**
 * `MailSender` port implementation (M1-PLAT-09, ADR 0004: mail is sent by a JOB, never inline).
 *
 * `send` MUST be called inside the caller's tenant transaction (the same one that writes the
 * invitation, the reset token, the MFA row...). In that transaction it
 *   1. validates the template id and its data and the recipient (a bad call fails in ITS request);
 *   2. stores the recipient and data, ENCRYPTED with the SecretBox bound to `<tenant>:mail:<id>`, in
 *      `app.mail_outbox` (the address and links are PII/secrets, and `pgboss.*` has no RLS);
 *   3. enqueues `mail.send` with `{ tenantId, mailId }` ONLY (ids-only rule).
 * So the mail exists iff the business change commits, and nothing sensitive lands in the queue. The
 * worker (`mail-job.ts`) decrypts, renders, sends over SMTP and clears the stored message.
 *
 * Outside a tenant transaction it throws: there is no tenant to bind the message to, and sending
 * "fire and forget" before the change commits is exactly the bug this design removes.
 */
export class QueuedMailSender implements MailSender {
  constructor(
    private readonly secrets: SecretBox,
    private readonly jobs: JobQueue,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const ctx = currentTenantContext();
    if (!ctx) {
      throw new NoTenantTransactionError();
    }
    const tx = currentTenantTx();
    const to = recipient.parse(message.to);
    const data = parseTemplateData(message.template, message.data);
    const mailId = uuidv7();

    const plaintext = new TextEncoder().encode(JSON.stringify({ to, data } satisfies StoredMail));
    const envelope = await this.secrets.encrypt(plaintext, mailContext(ctx.tenantId, mailId));

    await tx.$executeRaw`
      insert into app.mail_outbox (id, tenant_id, template, locale, status, message_enc, created_by)
      values (${mailId}::uuid,
              (select nullif(current_setting('app.tenant_id', true), '')::uuid),
              ${message.template}::text,
              ${message.locale ?? null}::text,
              'queued',
              ${asBytes(envelope)},
              nullif(current_setting('app.actor_id', true), '')::uuid)`;
    await this.jobs.enqueue(MAIL_JOB, { tenantId: ctx.tenantId, mailId }, { tx });
  }
}
