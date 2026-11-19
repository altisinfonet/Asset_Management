-- 0041_custody [M2-LIFE-01..06; ED-09, ED-11, ED-13]: the assignment model, transfers and the monthly
-- partitioned asset_history (chain of custody), plus the disposal columns of app.asset.
-- Source of truth for the shapes: docs/engineering/schema.sql (B9). The M2 wave-1 agent owns 0040-0049.
--
-- INTEGRATION NOTES (parallel M2 branches; the integrator applies these when the branches meet):
--   * app.assignment.accessory_id and app.assignment.loaner_pool_id are plain uuid columns here
--     WITHOUT foreign keys: app.accessory and app.loaner_pool are built by other agents. Once those
--     tables exist add
--       alter table app.assignment add foreign key (tenant_id, accessory_id)   references app.accessory (tenant_id, id);
--       alter table app.assignment add foreign key (tenant_id, loaner_pool_id) references app.loaner_pool (tenant_id, id);
--     and the accessory stock trigger (schema.sql: assignment_check_accessory_stock).
--   * app.assignment.attachment_ids / checkin_attachment_ids hold the ids of photos linked at
--     check-out / check-in. They are validated for uuid format only; the attachments migration
--     (0050-0059) owns the table, so the integrator adds the existence/entity validation in the
--     custody service (and, if wanted, an attachment.entity_id link back to the assignment).

-- -----------------------------------------------------------------------------
-- Assignments (custody periods)
-- -----------------------------------------------------------------------------

-- Accessories can come back in parts (ED-11): a partial return increments quantity_returned and the
-- row stays open; the return that makes quantity_returned = quantity also sets checked_in_at. An
-- asset (quantity = 1) closes with quantity_returned = 1 and checked_in_at set in the same UPDATE.
create table app.assignment (
  id                      uuid primary key,
  tenant_id               uuid not null references app.tenant (id),
  asset_id                uuid,
  accessory_id            uuid,                                 -- FK added by the accessories migration
  person_id               uuid,
  location_id             uuid,
  target_asset_id         uuid,
  quantity                integer not null default 1 check (quantity > 0),
  quantity_returned       integer not null default 0,           -- ED-11
  loaner_pool_id          uuid,                                 -- FK added by the loaner migration
  checked_out_at          timestamptz not null default now(),
  checked_out_by          uuid,
  expected_return         date,
  checked_in_at           timestamptz,
  checked_in_by           uuid,
  checkin_location_id     uuid,
  acceptance_state        text not null default 'not_required'
                          check (acceptance_state in ('not_required','pending','accepted','declined')),
  note                    text,
  checkin_note            text,
  attachment_ids          uuid[] not null default '{}' check (cardinality(attachment_ids) <= 10),
  checkin_attachment_ids  uuid[] not null default '{}' check (cardinality(checkin_attachment_ids) <= 10),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  version                 integer not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, asset_id)            references app.asset (tenant_id, id),
  foreign key (tenant_id, person_id)           references app.person (tenant_id, id),
  foreign key (tenant_id, location_id)         references app.location (tenant_id, id),
  foreign key (tenant_id, target_asset_id)     references app.asset (tenant_id, id),
  foreign key (tenant_id, checkin_location_id) references app.location (tenant_id, id),
  constraint assignment_one_item   check (num_nonnulls(asset_id, accessory_id) = 1),
  constraint assignment_one_target check (num_nonnulls(person_id, location_id, target_asset_id) = 1),
  constraint assignment_asset_qty  check (asset_id is null or quantity = 1),
  constraint assignment_not_self   check (target_asset_id is null or target_asset_id <> asset_id),
  constraint assignment_loan_due   check (loaner_pool_id is null or (asset_id is not null and expected_return is not null)),
  constraint assignment_time_order check (checked_in_at is null or checked_in_at >= checked_out_at),
  -- partial returns: 0 <= quantity_returned <= quantity, and the period is closed exactly when everything is back
  constraint assignment_returned_range check (quantity_returned >= 0 and quantity_returned <= quantity),
  constraint assignment_returned_state check ((checked_in_at is null) = (quantity_returned < quantity))
);
-- An asset has at most one open custody period (the concurrency guard of check-out).
create unique index assignment_one_open_per_asset_uq on app.assignment (tenant_id, asset_id)
  where asset_id is not null and checked_in_at is null;
create index assignment_asset_history_idx on app.assignment (tenant_id, asset_id, checked_out_at desc, id desc)
  where asset_id is not null;
create index assignment_accessory_open_idx on app.assignment (tenant_id, accessory_id)
  where accessory_id is not null and checked_in_at is null;
create index assignment_person_open_idx on app.assignment (tenant_id, person_id, checked_out_at desc, id desc)
  where person_id is not null;
create index assignment_location_open_idx on app.assignment (tenant_id, location_id)
  where location_id is not null and checked_in_at is null;
create index assignment_target_asset_open_idx on app.assignment (tenant_id, target_asset_id)
  where target_asset_id is not null and checked_in_at is null;
create index assignment_due_idx on app.assignment (tenant_id, expected_return)
  where checked_in_at is null and expected_return is not null;
create index assignment_pool_open_idx on app.assignment (tenant_id, loaner_pool_id)
  where loaner_pool_id is not null and checked_in_at is null;
select app.apply_tenant_conventions('app.assignment');

-- Returns only move forward: quantity is fixed after check-out and quantity_returned never
-- decreases (so a closed custody period cannot be reopened).
create function app.assignment_guard_update() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.quantity <> old.quantity then
    raise exception 'assignment quantity cannot change after check-out' using errcode = 'check_violation';
  end if;
  if new.quantity_returned < old.quantity_returned then
    raise exception 'quantity_returned cannot decrease (% -> %)', old.quantity_returned, new.quantity_returned
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger assignment_b_guard_update before update of quantity, quantity_returned on app.assignment
  for each row execute function app.assignment_guard_update();

-- -----------------------------------------------------------------------------
-- Transfers: atomic hand-over (closes one assignment and opens the next). Append-only.
-- -----------------------------------------------------------------------------

create table app.transfer (
  id                 uuid primary key,
  tenant_id          uuid not null references app.tenant (id),
  asset_id           uuid not null,
  from_assignment_id uuid,                                  -- null when the asset was in stock
  to_assignment_id   uuid not null,
  from_location_id   uuid,
  to_location_id     uuid,
  reason             text,
  note               text,
  transferred_at     timestamptz not null default now(),
  transferred_by     uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, asset_id)           references app.asset (tenant_id, id),
  foreign key (tenant_id, from_assignment_id) references app.assignment (tenant_id, id),
  foreign key (tenant_id, to_assignment_id)   references app.assignment (tenant_id, id),
  foreign key (tenant_id, from_location_id)   references app.location (tenant_id, id),
  foreign key (tenant_id, to_location_id)     references app.location (tenant_id, id),
  check (from_assignment_id is distinct from to_assignment_id)
);
create index transfer_asset_idx on app.transfer (tenant_id, asset_id, transferred_at desc, id desc);
create index transfer_from_assignment_idx on app.transfer (tenant_id, from_assignment_id)
  where from_assignment_id is not null;
select app.apply_tenant_conventions('app.transfer', 'select, insert');

-- -----------------------------------------------------------------------------
-- asset_history: the user-facing chain of custody (append-only), partitioned monthly on "at" from
-- day one (ED-09), under the same rules as audit_log: app_user holds SELECT/INSERT on the PARENT
-- only; every partition has FORCE RLS + the tenant policy and NO grants (app.ensure_partitions
-- creates them). The primary key contains the partition key; nothing references the table.
-- -----------------------------------------------------------------------------

create table app.asset_history (
  id            uuid not null,
  tenant_id     uuid not null references app.tenant (id),
  asset_id      uuid not null,
  at            timestamptz not null default now(),
  event_type    text not null check (event_type in (
                  'created','updated','status_changed','location_changed','checked_out','checked_in',
                  'transferred','repair_opened','repair_completed','archived','restored','label_printed','imported')),
  actor_type    text not null default 'user' check (actor_type in ('user','api_key','integration','system')),
  actor_id      uuid,
  assignment_id uuid,
  transfer_id   uuid,
  summary       text,
  payload       jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  request_id    text,
  primary key (id, at),
  foreign key (tenant_id, asset_id)      references app.asset (tenant_id, id),
  foreign key (tenant_id, assignment_id) references app.assignment (tenant_id, id),
  foreign key (tenant_id, transfer_id)   references app.transfer (tenant_id, id)
) partition by range (at);
create index asset_history_asset_idx on app.asset_history (tenant_id, asset_id, at desc, id desc);
create index asset_history_assignment_idx on app.asset_history (tenant_id, assignment_id)
  where assignment_id is not null;
create index asset_history_transfer_idx on app.asset_history (tenant_id, transfer_id)
  where transfer_id is not null;
select app.apply_tenant_conventions('app.asset_history', 'select, insert');   -- partitioned PARENT only

-- Current month plus the next 11 and the default partition (idempotent; also covers audit_log).
select app.ensure_partitions(current_date, 12);

-- -----------------------------------------------------------------------------
-- Disposal (M2-LIFE-05): reason + date recorded on the asset (the status moves to an archived-type
-- label and the asset is archived by the application in the same transaction).
-- -----------------------------------------------------------------------------

alter table app.asset
  add column disposed_on     date,
  add column disposal_reason text check (disposal_reason in
    ('sold','donated','recycled','scrapped','stolen','returned_to_vendor','other')),
  add column disposal_note   text,
  add constraint asset_disposal_chk check ((disposed_on is null) = (disposal_reason is null));
