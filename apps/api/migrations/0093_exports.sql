-- 0093_exports [M2-REG-02]: CSV exports of lists. A request row, a worker job (`export.run`) that writes
-- the file through the StorageAdapter under a tenant-prefixed key, and a short-lived download link. The
-- file is deleted 24 hours after it was written (`export.sweep`).
--
-- Requested and downloaded exports are audited as sensitive reads (src/exports); this table is the
-- state of the job, not the audit trail.

select app.create_tenant_table(
  'export_job',
  $body$
    requested_by  uuid not null,
    resource      text not null check (resource in ('assets','people','locations')),
    format        text not null default 'csv' check (format in ('csv')),
    filters       jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 16384),
    status        text not null default 'queued'
                  check (status in ('queued','running','succeeded','failed','expired')),
    row_count     integer check (row_count is null or row_count >= 0),
    size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
    filename      text check (filename is null or length(filename) <= 200),
    storage_key   text check (storage_key is null or storage_key like 'tenants/' || tenant_id::text || '/%'),
    error         text check (error is null or length(error) <= 500),
    started_at    timestamptz,
    completed_at  timestamptz,
    expires_at    timestamptz,
    foreign key (tenant_id, requested_by) references app.user_account (tenant_id, id),
    constraint export_job_file_state check ((status = 'succeeded') = (storage_key is not null) or status = 'expired')
  $body$,
  'select, insert, update'
);
create index export_job_user_idx on app.export_job (tenant_id, requested_by, created_at desc, id desc);
create index export_job_expiry_idx on app.export_job (tenant_id, expires_at) where status = 'succeeded';
