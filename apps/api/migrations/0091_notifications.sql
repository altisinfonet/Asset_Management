-- 0091_notifications [M2-NOT-01]: in-app notifications, per-user delivery preferences, tenant-level
-- rules and the delivery log. Outbox subscribers (src/notifications/subscriptions.ts) turn domain
-- events into rows here, in the relay's tenant transaction; email goes through MailSender in the same
-- transaction (ADR 0004), immediately or as one daily digest per user (ADR 0009).
--
-- Notification TYPES are code (src/notifications/types.ts), not rows: a type that is not in the
-- registry cannot be stored in `notification_rule` / `notification_preference` by the API, and the
-- CHECK below only guards the shape. Nothing here references an entity by foreign key: a notification
-- outlives the thing it talks about (an infected file is deleted, an asset is archived).

-- A user's inbox. One row per (recipient, source event): `dedupe_key` makes an outbox redelivery, or a
-- producer that emits the same condition twice, create exactly one notification per recipient.
select app.create_tenant_table(
  'notification',
  $body$
    user_id      uuid not null,
    type         text not null check (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(type) <= 64),
    title        text not null check (length(title) between 1 and 300),
    body         text check (body is null or length(body) <= 2000),
    link         text check (link is null or length(link) <= 500),
    entity_type  text check (entity_type is null or length(entity_type) <= 64),
    entity_id    uuid,
    dedupe_key   text not null check (length(dedupe_key) between 1 and 200),
    in_app       boolean not null default true,
    -- none: no email; queued: handed to the mail queue; pending_digest: waits for the daily digest;
    -- digested: included in a digest mail
    email_state  text not null default 'none'
                 check (email_state in ('none','queued','pending_digest','digested')),
    read_at      timestamptz,
    foreign key (tenant_id, user_id) references app.user_account (tenant_id, id)
  $body$,
  'select, insert, update'
);
create unique index notification_dedupe_uq on app.notification (tenant_id, user_id, dedupe_key);
create index notification_inbox_idx on app.notification (tenant_id, user_id, created_at desc, id desc)
  where in_app;
create index notification_unread_idx on app.notification (tenant_id, user_id)
  where in_app and read_at is null;
create index notification_digest_idx on app.notification (tenant_id, user_id, created_at, id)
  where email_state = 'pending_digest';

-- What one user wants per type: in the bell, and by email immediately / in the daily digest / not at all.
select app.create_tenant_table(
  'notification_preference',
  $body$
    user_id  uuid not null,
    type     text not null check (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(type) <= 64),
    in_app   boolean not null,
    email    text not null check (email in ('immediate','digest','off')),
    foreign key (tenant_id, user_id) references app.user_account (tenant_id, id)
  $body$,
  'select, insert, update, delete'
);
create unique index notification_preference_uq on app.notification_preference (tenant_id, user_id, type);

-- What the organisation decided per type: switched off entirely, and/or addressed to other roles than
-- the default recipients. A type with no row is enabled with its default recipients.
select app.create_tenant_table(
  'notification_rule',
  $body$
    type             text not null check (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' and length(type) <= 64),
    enabled          boolean not null default true,
    recipient_roles  text[] check (recipient_roles is null or cardinality(recipient_roles) <= 20)
  $body$,
  'select, insert, update, delete'
);
create unique index notification_rule_uq on app.notification_rule (tenant_id, type);

-- The delivery log (visible to administrators): every decision taken for a recipient and channel.
select app.create_tenant_table(
  'notification_delivery',
  $body$
    notification_id  uuid,
    user_id          uuid not null,
    type             text not null check (length(type) between 3 and 64),
    channel          text not null check (channel in ('in_app','email')),
    status           text not null check (status in ('delivered','queued','deferred','skipped','failed')),
    reason           text check (reason is null or length(reason) <= 100),
    foreign key (tenant_id, user_id) references app.user_account (tenant_id, id),
    foreign key (tenant_id, notification_id) references app.notification (tenant_id, id)
  $body$,
  'select, insert'
);
create index notification_delivery_user_idx on app.notification_delivery (tenant_id, user_id, created_at desc, id desc);
create index notification_delivery_throttle_idx on app.notification_delivery (tenant_id, user_id, created_at desc)
  where channel = 'email' and status = 'queued';
