-- 0090_repairs [M2-MNT-01]: the repair and maintenance log. The M2 wave-2 "repairs / notifications /
-- saved views / export" agent owns 0090-0099.
-- Source of truth for the shape: docs/engineering/schema.sql (B10), plus `set_status_id` (the status the
-- asset was moved to when the record opened; NULL when the record did not move it) and the partial unique
-- index that lets only ONE open record at a time move an asset's status (the database backstop of the
-- rule that makes "restore the previous status on close" unambiguous).
--
-- Attachments (photos, invoices) hang off a record through app.attachment (entity_type
-- 'maintenance_record', allowed since 0005): `files/owners.ts` already resolves the owner here.

create table app.maintenance_record (
  id                      uuid primary key,
  tenant_id               uuid not null references app.tenant (id),
  asset_id                uuid not null,
  kind                    text not null default 'repair'
                          check (kind in ('repair','maintenance','inspection','upgrade')),
  status                  text not null default 'open'
                          check (status in ('open','in_progress','completed','cancelled')),
  title                   text not null check (length(btrim(title)) between 1 and 200),
  description             text,
  resolution_notes        text,
  reported_at             timestamptz not null default now(),
  started_at              timestamptz,
  completed_at            timestamptz,
  vendor_id               uuid,
  performed_by_person_id  uuid,
  ticket_ref              text check (ticket_ref is null or length(ticket_ref) <= 200),
  cost_minor              bigint check (cost_minor is null or cost_minor >= 0),
  currency                text check (currency is null or currency ~ '^[A-Z]{3}$'),
  set_status_id           uuid,                                  -- status the asset was moved to on open
  restore_status_id       uuid,                                  -- status put back on completion / cancellation
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid,
  updated_by              uuid,
  archived_at             timestamptz,
  version                 integer not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, asset_id)               references app.asset (tenant_id, id),
  foreign key (tenant_id, vendor_id)              references app.vendor (tenant_id, id),
  foreign key (tenant_id, performed_by_person_id) references app.person (tenant_id, id),
  foreign key (tenant_id, set_status_id)          references app.status_label (tenant_id, id),
  foreign key (tenant_id, restore_status_id)      references app.status_label (tenant_id, id),
  constraint maintenance_cost_currency check (cost_minor is null or currency is not null),
  constraint maintenance_time_order    check (completed_at is null or started_at is null or completed_at >= started_at),
  -- `completed_at` is the completion time of a COMPLETED record and nothing else (a cancelled one has none)
  constraint maintenance_completed_state check ((status = 'completed') = (completed_at is not null)),
  constraint maintenance_restore_needs_move check (restore_status_id is null or set_status_id is not null)
);
create index maintenance_asset_idx  on app.maintenance_record (tenant_id, asset_id, reported_at desc, id desc);
create index maintenance_open_idx   on app.maintenance_record (tenant_id, status, reported_at desc)
  where status in ('open','in_progress') and archived_at is null;
create index maintenance_vendor_idx on app.maintenance_record (tenant_id, vendor_id) where vendor_id is not null;
create index maintenance_reported_idx on app.maintenance_record (tenant_id, reported_at desc, id desc);
create unique index maintenance_one_status_move_uq on app.maintenance_record (tenant_id, asset_id)
  where set_status_id is not null and status in ('open','in_progress') and archived_at is null;
select app.apply_tenant_conventions('app.maintenance_record');
