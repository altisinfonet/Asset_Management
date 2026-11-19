-- 0070_labels [M2-TAG-02]: fixed label templates (per tenant), label batches (async PDF rendering) and
-- the separate seeding function for the templates. The M2 wave-2 labels agent owns 0070-0079.
-- Source of truth for the shapes: docs/engineering/schema.sql (B10), extended as documented in ADR 0007.
--
-- app.provision_tenant is NOT replaced here (other M2 branches own seeds in it). Templates are seeded by
-- app.seed_label_templates(tenant_id), called by bootstrapTenant, by this migration for every existing
-- tenant, and lazily by the labels service (idempotent: ON CONFLICT DO NOTHING), so a tenant created
-- through any other path still gets them on first use.

-- -----------------------------------------------------------------------------
-- Fixed templates (plan decision 22: the editor is v1.1). Geometry is mirrored by the code constants in
-- apps/api/src/tagging/templates.ts; a test fails when a seeded row and the constant disagree.
-- offset_x_mm / offset_y_mm are the per-template calibration shift of the whole sheet (M2-TAG-04): the
-- only columns the API lets a manager change.
-- -----------------------------------------------------------------------------

create table app.label_template (
  id              uuid primary key,
  tenant_id       uuid not null references app.tenant (id),
  key             text not null check (key ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  name            text not null check (length(btrim(name)) between 1 and 200),
  page_size       text not null check (page_size in ('letter','a4','custom')),
  page_width_mm   numeric(7,2) not null check (page_width_mm > 0),
  page_height_mm  numeric(7,2) not null check (page_height_mm > 0),
  label_width_mm  numeric(7,2) not null check (label_width_mm > 0),
  label_height_mm numeric(7,2) not null check (label_height_mm > 0),
  cols            integer not null check (cols between 1 and 20),
  rows            integer not null check (rows between 1 and 50),
  margin_top_mm   numeric(7,2) not null default 0 check (margin_top_mm >= 0),
  margin_left_mm  numeric(7,2) not null default 0 check (margin_left_mm >= 0),
  gap_x_mm        numeric(7,2) not null default 0 check (gap_x_mm >= 0),
  gap_y_mm        numeric(7,2) not null default 0 check (gap_y_mm >= 0),
  offset_x_mm     numeric(5,2) not null default 0 check (offset_x_mm between -10 and 10),
  offset_y_mm     numeric(5,2) not null default 0 check (offset_y_mm between -10 and 10),
  code_type       text not null default 'qr' check (code_type in ('qr','code128','qr_and_code128')),
  fields          text[] not null default '{asset_tag}'
                  check (cardinality(fields) between 1 and 6
                         and fields <@ array['asset_tag','name','serial','location','model','organisation']),
  is_system       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  version         integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, key),
  -- the grid must fit on the page (before calibration)
  check (margin_left_mm + cols * label_width_mm  + (cols - 1) * gap_x_mm <= page_width_mm  + 0.05),
  check (margin_top_mm  + rows * label_height_mm + (rows - 1) * gap_y_mm <= page_height_mm + 0.05)
);
select app.apply_tenant_conventions('app.label_template', 'select, insert, update');

-- -----------------------------------------------------------------------------
-- Label batches: one row per "print these labels" request. The worker renders the PDF (job
-- `label.render`, ids only), stores it through the StorageAdapter under a tenant-prefixed key and flips
-- the row to `ready`; the requester downloads it through a short-lived presigned URL. The file is kept
-- until expires_at, then deleted by `label.sweep` (status `expired`).
-- -----------------------------------------------------------------------------

create table app.label_batch (
  id                  uuid primary key,
  tenant_id           uuid not null references app.tenant (id),
  template_id         uuid not null,
  template_key        text not null,
  status              text not null default 'queued' check (status in ('queued','ready','failed','expired')),
  -- the assets, in print order (resolved when the request was made, from explicit ids or a list filter)
  asset_ids           uuid[] not null check (cardinality(asset_ids) between 1 and 5000),
  source_filter       jsonb check (source_filter is null or jsonb_typeof(source_filter) = 'object'),
  asset_count         integer not null check (asset_count between 1 and 5000),
  copies              integer not null default 1 check (copies between 1 and 10),
  label_count         integer not null check (label_count between 1 and 10000),
  start_position      integer not null default 1 check (start_position >= 1),
  codes               text[] not null check (cardinality(codes) <= 2 and codes <@ array['qr','code128']),
  fields              text[] not null check (cardinality(fields) <= 6
                                             and fields <@ array['asset_tag','name','serial','location','model','organisation']),
  outlines            boolean not null default false,
  logo_attachment_id  uuid,
  requested_by_type   text not null default 'user' check (requested_by_type in ('user','api_key')),
  page_count          integer check (page_count is null or page_count >= 1),
  storage_key         text,
  content_type        text,
  size_bytes          bigint check (size_bytes is null or size_bytes >= 0),
  sha256              text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  rendered_at         timestamptz,
  render_ms           integer check (render_ms is null or render_ms >= 0),
  error_code          text check (error_code is null or length(error_code) <= 100),
  error_detail        text check (error_detail is null or length(error_detail) <= 1000),
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  version             integer not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, template_id)        references app.label_template (tenant_id, id),
  foreign key (tenant_id, logo_attachment_id) references app.attachment (tenant_id, id),
  constraint label_batch_storage_prefix check (storage_key is null or storage_key like 'tenants/' || tenant_id::text || '/%'),
  constraint label_batch_ready_has_file check (status <> 'ready' or (storage_key is not null and size_bytes is not null and page_count is not null))
);
create index label_batch_requester_idx on app.label_batch (tenant_id, created_by, created_at desc, id desc);
create index label_batch_open_idx      on app.label_batch (tenant_id, created_at) where status = 'queued';
create index label_batch_expiry_idx    on app.label_batch (tenant_id, expires_at) where status = 'ready';
select app.apply_tenant_conventions('app.label_batch', 'select, insert, update');

-- -----------------------------------------------------------------------------
-- Seeding (separate provisioning step). SECURITY INVOKER like provision_tenant: runs under the caller's
-- RLS, refuses unless app.tenant_id is the tenant, idempotent.
--
-- Geometry follows the published layouts; the arithmetic is checked by the table's own CHECKs and by a
-- unit test, the die lines are to be verified on a real print (M2-TAG-04, offsets above):
--   letter-30up-qr   Avery 5160: 66.675 x 25.4 mm, 3 x 10, column pitch 69.85 mm, top 12.7 mm
--   a4-21up-qr       Avery L7160: 63.5 x 38.1 mm, 3 x 7, column pitch 66.04 mm, top 15.15 mm
--   a4-24up-qr       Avery L7159 (3 x 8): 63.5 x 33.9 mm, column pitch 66.04 mm, top 12.9 mm
--   letter-10up-qr   Avery 5163: 101.6 x 50.8 mm, 2 x 5, column gap 4.76 mm (0.1875 in), top 12.7 mm
--   single-50x25-qr  one 50 x 25 mm label per page (roll / thermal printers, metric stock)
--   thermal-2x1in-qr one 2 x 1 inch label per page (roll / thermal printers, US stock)
-- -----------------------------------------------------------------------------

create function app.seed_label_templates(p_tenant_id uuid) returns integer
language plpgsql set search_path = pg_catalog as $$
declare
  v_inserted integer;
begin
  if p_tenant_id is distinct from nullif(current_setting('app.tenant_id', true), '')::uuid then
    raise exception 'app.tenant_id must be set to the tenant id before seeding label templates'
      using errcode = 'insufficient_privilege';
  end if;

  insert into app.label_template
    (id, tenant_id, key, name, page_size, page_width_mm, page_height_mm, label_width_mm, label_height_mm,
     cols, rows, margin_top_mm, margin_left_mm, gap_x_mm, gap_y_mm, code_type, fields)
  values
    (gen_random_uuid(), p_tenant_id, 'letter-30up-qr',   'US Letter 30-up (Avery 5160 layout), QR',
       'letter', 215.90, 279.40,  66.68, 25.40, 3, 10, 12.70, 4.76, 3.18, 0.00, 'qr',
       array['asset_tag','name']),
    (gen_random_uuid(), p_tenant_id, 'a4-21up-qr',       'A4 21-up (Avery L7160 layout), QR',
       'a4',     210.00, 297.00,  63.50, 38.10, 3,  7, 15.15, 7.21, 2.54, 0.00, 'qr',
       array['asset_tag','name']),
    (gen_random_uuid(), p_tenant_id, 'a4-24up-qr',       'A4 24-up, 3 x 8 (Avery L7159 layout), QR',
       'a4',     210.00, 297.00,  63.50, 33.90, 3,  8, 12.90, 7.21, 2.54, 0.00, 'qr',
       array['asset_tag','name']),
    (gen_random_uuid(), p_tenant_id, 'letter-10up-qr',   'US Letter 10-up (Avery 5163 layout), QR and Code128',
       'letter', 215.90, 279.40, 101.60, 50.80, 2,  5, 12.70, 3.97, 4.76, 0.00, 'qr_and_code128',
       array['asset_tag','name','serial']),
    (gen_random_uuid(), p_tenant_id, 'single-50x25-qr',  'Single label 50 x 25 mm, QR (one per page)',
       'custom',  50.00,  25.00,  50.00, 25.00, 1,  1,  0.00, 0.00, 0.00, 0.00, 'qr',
       array['asset_tag']),
    (gen_random_uuid(), p_tenant_id, 'thermal-2x1in-qr', 'Single label 2 x 1 inch for thermal / roll printers, QR and Code128',
       'custom',  50.80,  25.40,  50.80, 25.40, 1,  1,  0.00, 0.00, 0.00, 0.00, 'qr_and_code128',
       array['asset_tag','name'])
  on conflict (tenant_id, key) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$$;
grant execute on function app.seed_label_templates(uuid) to app_user;

-- Every tenant that exists today. app.label_template is under FORCE RLS: even the owner sees and writes
-- nothing without a tenant context, so set it per tenant (transaction-local, like migration 0011).
do $$
declare
  t uuid;
begin
  for t in select tenant_id from identity.tenant_directory loop
    perform set_config('app.tenant_id', t::text, true);
    perform app.seed_label_templates(t);
  end loop;
  perform set_config('app.tenant_id', '', true);
end
$$;
