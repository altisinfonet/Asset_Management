-- 0020_outbox_relay [M1-PLAT-05]: retry bookkeeping for the outbox relay (worker role).
-- The relay claims one pending row per transaction under the tenant context (FOR UPDATE SKIP LOCKED),
-- dispatches it to the in-process subscribers and stamps `published_at`. A failed dispatch rolls the
-- claim back and records the attempt separately: attempts + 1, exponential `next_attempt_at`, the
-- error text; after the configured maximum the row is dead-lettered (`dead_lettered_at`) and the
-- relay skips it until an operator clears the column (replay).

alter table app.outbox_event
  add column next_attempt_at  timestamptz not null default now(),
  add column last_error       text,
  add column dead_lettered_at timestamptz;

-- The pending predicate now includes "not dead-lettered"; the relay orders by id (UUIDv7: time order).
drop index app.outbox_event_pending_idx;
create index outbox_event_pending_idx
  on app.outbox_event (tenant_id, next_attempt_at, id)
  where published_at is null and dead_lettered_at is null;
create index outbox_event_dead_idx
  on app.outbox_event (tenant_id, dead_lettered_at)
  where dead_lettered_at is not null;
