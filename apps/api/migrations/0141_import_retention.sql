-- 0141_import_retention [M2-IMP; ED-25]: retention of the content of finished imports. The scheduled
-- `import.sweep` job deletes the rows (the cells of the file, the mapped records, the before-images), the
-- column profile, the sample rows and the value map of an import that finished (completed, failed or
-- cancelled) more than IMPORT_ROW_RETENTION_DAYS ago, archives the uploaded file and removes its object,
-- and stamps the job here. The job itself (counts, summary, mapping, options, audit trail) stays.
-- Migration range 0140-0149 belongs to this change.

alter table app.import_job add column data_purged_at timestamptz;

-- The purge looks for finished jobs that still hold data, oldest first.
create index import_job_purge_idx on app.import_job (tenant_id, finished_at)
  where data_purged_at is null and state in ('completed','failed','cancelled');
