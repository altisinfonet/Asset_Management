-- 0050_files_scan_thumbnails [M2-FILE-01..03, M2-SEC-02]: attachments become a complete pipeline.
-- No new tables (app.attachment exists since 0005). Adds the scan / derivative bookkeeping columns,
-- widens the polymorphic owner list with `asset_model` (model images), links the primary image of an
-- asset and of an asset model to an attachment, and indexes the two orphan-sweep queries.
-- Every statement keeps the tenant conventions: composite (tenant_id, id) foreign keys, nothing
-- readable across tenants (the table's RLS policy from 0005 is unchanged).

-- A model image is an attachment whose owner is an asset model.
alter table app.attachment drop constraint attachment_entity_type_check;
alter table app.attachment
  add constraint attachment_entity_type_check
  check (entity_type in ('asset','asset_model','accessory','consumable','location','person',
                         'maintenance_record','assignment','import_job'));

alter table app.attachment
  -- ETag the storage reported when the upload was confirmed. The scan job and the download presign
  -- re-check it, so an object overwritten after "complete" is never scanned-as-clean-and-served.
  add column etag               text,
  add column scanned_at         timestamptz,
  -- Signature name when infected, or a short machine reason ('scan-disabled', 'size-mismatch', ...).
  add column scan_detail        text check (scan_detail is null or length(scan_detail) <= 200),
  -- Server-generated derivative (re-encoded WebP thumbnail). Same tenant-prefix rule as storage_key.
  add column thumb_key          text,
  add column thumb_content_type text,
  add column width              integer check (width is null or width > 0),
  add column height             integer check (height is null or height > 0),
  -- true once the ORIGINAL was re-encoded without EXIF/GPS (per-tenant option; derivatives are always clean).
  add column exif_stripped      boolean not null default false,
  add constraint attachment_thumb_key_prefix
    check (thumb_key is null or thumb_key like 'tenants/' || tenant_id::text || '/%'),
  add constraint attachment_clean_needs_upload
    check (scan_status <> 'clean' or uploaded_at is not null);

create unique index attachment_thumb_key_uq on app.attachment (tenant_id, thumb_key) where thumb_key is not null;
-- Orphan sweep (scheduler -> `attachment.sweep`): uploads whose "complete" call never arrived, and
-- completed uploads whose scan job was lost.
create index attachment_incomplete_idx
  on app.attachment (tenant_id, created_at)
  where uploaded_at is null and archived_at is null;
create index attachment_pending_scan_idx
  on app.attachment (tenant_id, uploaded_at)
  where scan_status = 'pending' and uploaded_at is not null and archived_at is null;

-- Primary image of an asset and of an asset model (M2-FILE-03). Plain nullable columns with a
-- composite foreign key: an image can only ever be an attachment of the SAME tenant.
alter table app.asset
  add column image_attachment_id uuid,
  add constraint asset_image_attachment_fk
    foreign key (tenant_id, image_attachment_id) references app.attachment (tenant_id, id);
create index asset_image_idx on app.asset (tenant_id, image_attachment_id) where image_attachment_id is not null;

alter table app.asset_model
  add column image_attachment_id uuid,
  add constraint asset_model_image_attachment_fk
    foreign key (tenant_id, image_attachment_id) references app.attachment (tenant_id, id);
create index asset_model_image_idx on app.asset_model (tenant_id, image_attachment_id) where image_attachment_id is not null;
