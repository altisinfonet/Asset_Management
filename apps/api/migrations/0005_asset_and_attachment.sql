-- 0005_asset_and_attachment [M1]: asset registry, tag generator, attachment metadata.

-- location_id has NO foreign key yet (app.location is M2; the M2 migration adds
-- FOREIGN KEY (tenant_id, location_id) REFERENCES app.location (tenant_id, id)).
create table app.asset (
  id                  uuid primary key,
  tenant_id           uuid not null references app.tenant (id),
  company_id          uuid not null,                       -- default company filled by trigger
  asset_tag           text not null check (length(asset_tag) between 1 and 64 and asset_tag !~ '\s'),
  label_code          text not null default replace(gen_random_uuid()::text, '-', ''),  -- opaque QR payload
  name                text,
  serial              text,
  category_id         uuid not null,
  category_kind       text not null default 'asset' check (category_kind = 'asset'),
  model_id            uuid,
  status_id           uuid not null,
  location_id         uuid,
  vendor_id           uuid,
  parent_asset_id     uuid,
  purchase_date       date,
  purchase_cost_minor bigint check (purchase_cost_minor is null or purchase_cost_minor >= 0),
  currency            text check (currency is null or currency ~ '^[A-Z]{3}$'),
  order_number        text,
  warranty_end        date,
  notes               text,
  custom_data         jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_data) = 'object'),
  external_source     text,                                -- e.g. 'snipe_it', 'google_admin'
  external_id         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  archived_at         timestamptz,
  version             integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, label_code),
  unique (tenant_id, external_source, external_id),
  foreign key (tenant_id, company_id)  references app.company (tenant_id, id),
  foreign key (tenant_id, category_id, category_kind) references app.category (tenant_id, id, kind),
  foreign key (tenant_id, model_id, category_id)      references app.asset_model (tenant_id, id, category_id),
  foreign key (tenant_id, status_id)   references app.status_label (tenant_id, id),
  foreign key (tenant_id, vendor_id)   references app.vendor (tenant_id, id),
  foreign key (tenant_id, parent_asset_id) references app.asset (tenant_id, id),
  check (parent_asset_id is distinct from id),
  check (purchase_cost_minor is null or currency is not null),
  check ((external_source is null) = (external_id is null))
);
create unique index asset_tag_uq on app.asset (tenant_id, lower(asset_tag));
create index asset_serial_idx   on app.asset (tenant_id, lower(serial)) where serial is not null;
create index asset_status_idx   on app.asset (tenant_id, status_id, id desc) where archived_at is null;
create index asset_location_idx on app.asset (tenant_id, location_id, id desc) where archived_at is null;
create index asset_category_idx on app.asset (tenant_id, category_id, id desc) where archived_at is null;
create index asset_model_idx    on app.asset (tenant_id, model_id) where model_id is not null;
create index asset_company_idx  on app.asset (tenant_id, company_id);
create index asset_vendor_idx   on app.asset (tenant_id, vendor_id) where vendor_id is not null;
create index asset_parent_idx   on app.asset (tenant_id, parent_asset_id) where parent_asset_id is not null;
create index asset_warranty_idx on app.asset (tenant_id, warranty_end) where warranty_end is not null and archived_at is null;
create index asset_updated_idx  on app.asset (tenant_id, updated_at desc, id desc);
create index asset_name_idx     on app.asset (tenant_id, lower(name), id) where name is not null;
create index asset_tag_trgm     on app.asset using gin (tenant_id, asset_tag public.gin_trgm_ops);
create index asset_serial_trgm  on app.asset using gin (tenant_id, serial public.gin_trgm_ops) where serial is not null;
create index asset_name_trgm    on app.asset using gin (tenant_id, name public.gin_trgm_ops) where name is not null;
create index asset_custom_gin   on app.asset using gin (custom_data jsonb_path_ops);
select app.apply_tenant_conventions('app.asset');

create trigger trg_company_asset before insert on app.asset
  for each row execute function app.fill_default_company();

-- Tag generator: per-tenant, per-prefix counter (tags are never reused, ED-12). SECURITY INVOKER:
-- runs under the caller's RLS, so the tenant is the transaction's tenant.
create function app.next_asset_tag(p_prefix text default '') returns text
language plpgsql set search_path = pg_catalog as $$
declare
  v bigint;
begin
  insert into app.asset_tag_counter as c (tenant_id, prefix, last_value)
  values (nullif(current_setting('app.tenant_id', true), '')::uuid, p_prefix, 1)
  on conflict (tenant_id, prefix) do update set last_value = c.last_value + 1
  returning c.last_value into v;
  return p_prefix || lpad(v::text, 5, '0');
end
$$;
grant execute on function app.next_asset_tag(text) to app_user;

-- -----------------------------------------------------------------------------
-- Attachments (metadata only; bytes live in object storage)
-- -----------------------------------------------------------------------------

create table app.attachment (
  id            uuid primary key,
  tenant_id     uuid not null references app.tenant (id),
  entity_type   text not null
                check (entity_type in ('asset','accessory','consumable','location','person','maintenance_record','assignment','import_job')),
  entity_id     uuid not null,                              -- polymorphic, resolved tenant-scoped by the app
  kind          text not null default 'document' check (kind in ('photo','document','signature','import_file','other')),
  storage_key   text not null,
  filename      text not null check (length(filename) between 1 and 255),
  content_type  text not null,
  size_bytes    bigint not null check (size_bytes >= 0),
  sha256        text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  scan_status   text not null default 'pending' check (scan_status in ('pending','clean','infected','error')),
  uploaded_at   timestamptz,                                -- set when the client confirms the PUT
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  archived_at   timestamptz,
  version       integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, storage_key),
  check (storage_key like 'tenants/' || tenant_id::text || '/%')   -- tenant-prefixed keys (plan 6.6)
);
create index attachment_entity_idx on app.attachment (tenant_id, entity_type, entity_id, id desc) where archived_at is null;
select app.apply_tenant_conventions('app.attachment');
