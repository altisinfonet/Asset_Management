-- 0006_audit_outbox_idempotency [M1]: technical tables (idempotency, outbox) and the partitioned,
-- append-only audit_log with its partition factory.

create table app.idempotency_key (
  tenant_id        uuid not null references app.tenant (id),
  principal_id     uuid not null,                            -- user id or api_key id
  key              text not null check (length(key) between 8 and 255),
  method           text not null,
  path             text not null,
  request_hash     text not null,                            -- sha-256 of the canonical request body
  state            text not null default 'in_flight' check (state in ('in_flight','completed')),
  response_status  integer,
  response_headers jsonb,
  response_body    jsonb,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '24 hours',
  primary key (tenant_id, principal_id, key)
);
create index idempotency_key_expiry_idx on app.idempotency_key (tenant_id, expires_at);
select app.apply_tenant_conventions('app.idempotency_key', 'select, insert, update, delete');

create table app.outbox_event (
  id             uuid primary key,
  tenant_id      uuid not null references app.tenant (id),
  event_type     text not null,                              -- e.g. asset.checked_out
  aggregate_type text not null,
  aggregate_id   uuid not null,
  payload        jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at     timestamptz not null default now(),
  published_at   timestamptz,
  attempts       integer not null default 0,
  unique (tenant_id, id)
);
create index outbox_event_pending_idx on app.outbox_event (tenant_id, id) where published_at is null;
select app.apply_tenant_conventions('app.outbox_event', 'select, insert, update, delete');

-- -----------------------------------------------------------------------------
-- audit_log: append-only, partitioned by month on "at" (decision ED-09)
--   * no FKs (the log must outlive the rows it describes)
--   * app_user gets SELECT/INSERT on the PARENT ONLY; partitions carry no grants
-- -----------------------------------------------------------------------------

create table app.audit_log (
  id            uuid not null,
  tenant_id     uuid not null,
  at            timestamptz not null default now(),
  actor_type    text not null check (actor_type in ('user','api_key','integration','system')),
  actor_user_id uuid,
  actor_ref     uuid,                                         -- api_key / integration id when not a user
  action        text not null,                                -- e.g. asset.create, asset.checkout
  entity_type   text not null,
  entity_id     uuid,
  diff          jsonb,                                        -- {before,after}, sensitive fields redacted
  ip            inet,
  user_agent    text,
  request_id    text,
  primary key (id, at)
) partition by range (at);
create index audit_log_tenant_time_idx on app.audit_log (tenant_id, at desc, id desc);
create index audit_log_entity_idx      on app.audit_log (tenant_id, entity_type, entity_id, at desc);
create index audit_log_actor_idx       on app.audit_log (tenant_id, actor_user_id, at desc) where actor_user_id is not null;
select app.apply_tenant_conventions('app.audit_log', 'select, insert');   -- partitioned PARENT only

-- Partition factory for every partitioned table in schema app (audit_log now; asset_history in M2
-- is picked up automatically). Run by app_owner (migrations / the rotation job), never by app_user.
-- Every partition, and each table's default partition, gets FORCE RLS + the tenant policy as
-- defence in depth and NO grants. Idempotent; returns the number of partitions created.
-- p_from is any date in the first month to create; p_months is how many months to cover.
create function app.ensure_partitions(p_from date, p_months integer) returns integer
language plpgsql set search_path = pg_catalog as $$
declare
  v_parent  text;
  v_start   date;
  v_name    text;
  v_created integer := 0;
  v_guard   text := app.tenant_guard();
begin
  if p_months < 0 or p_months > 120 then
    raise exception 'p_months must be between 0 and 120';
  end if;
  for v_parent in
    select c.relname::text from pg_class c
     where c.relnamespace = 'app'::regnamespace and c.relkind = 'p' order by c.relname
  loop
    for i in 0 .. p_months - 1 loop
      v_start := (date_trunc('month', p_from) + make_interval(months => i))::date;
      v_name  := v_parent || '_' || to_char(v_start, 'YYYY_MM');
      if to_regclass('app.' || quote_ident(v_name)) is null then
        execute format('create table app.%I partition of app.%I for values from (%L) to (%L)',
                       v_name, v_parent,
                       to_char(v_start, 'YYYY-MM-DD') || ' 00:00:00+00',
                       to_char((v_start + interval '1 month')::date, 'YYYY-MM-DD') || ' 00:00:00+00');
        execute format('alter table app.%I enable row level security', v_name);
        execute format('alter table app.%I force row level security', v_name);
        execute format('create policy tenant_isolation on app.%I using (tenant_id = %s) with check (tenant_id = %s)',
                       v_name, v_guard, v_guard);
        v_created := v_created + 1;
      end if;
    end loop;
    v_name := v_parent || '_default';
    if to_regclass('app.' || quote_ident(v_name)) is null then
      execute format('create table app.%I partition of app.%I default', v_name, v_parent);
      execute format('alter table app.%I enable row level security', v_name);
      execute format('alter table app.%I force row level security', v_name);
      execute format('create policy tenant_isolation on app.%I using (tenant_id = %s) with check (tenant_id = %s)',
                     v_name, v_guard, v_guard);
      v_created := v_created + 1;
    end if;
  end loop;
  return v_created;
end
$$;
revoke all on function app.ensure_partitions(date, integer) from public;

-- Current month plus the next 11, and a default partition (no grants on any of them).
select app.ensure_partitions(current_date, 12);
