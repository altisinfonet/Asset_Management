-- 0021_mail_outbox [M1-PLAT-09]: transactional mail queue.
-- MailSender.send() runs inside the caller's tenant transaction: it inserts one row here and
-- enqueues a `mail.send` job (ids only: tenantId + mailId) in the same transaction, so a mail is
-- queued if and only if the business change commits. The worker resolves the row under the tenant
-- context, decrypts the message, renders the template and sends it over SMTP. Delivery failures are
-- retried by the job queue (exponential backoff) and end in the dead-letter queue; they are not
-- tracked on this row (a failed attempt runs in a transaction that rolls back).
--
-- `message_enc` holds the recipient address and template data (PII, invitation and reset links) as a
-- SecretBox envelope bound to `<tenant_id>:mail:<id>`. It is cleared when the mail is sent, so a
-- reset or invitation token does not outlive its delivery.

select app.create_tenant_table(
  'mail_outbox',
  $body$
    template     text not null check (length(template) between 1 and 100),
    locale       text,
    status       text not null default 'queued' check (status in ('queued', 'sent')),
    message_enc  bytea,
    sent_at      timestamptz
  $body$,
  'select, insert, update'
);
create index mail_outbox_queued_idx on app.mail_outbox (tenant_id, created_at) where status = 'queued';
