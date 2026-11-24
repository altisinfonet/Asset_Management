-- 0110_imports [M2-IMP-01..07, ED-18]: CSV / XLSX import with a mandatory dry run.
--
--   import_job       one import: the state machine (draft -> uploaded -> analyzing -> analyzed -> mapped ->
--                    dry_running -> dry_run_done -> committing -> completed | failed | cancelled), the parse
--                    settings, the column mapping, the options, the value map, the counters of both phases
--                    and the digest of the reviewed dry run.
--   import_row       one row of the file, with BOTH phases: the raw cells, the mapped record, the dry-run
--                    outcome (`plan`), the commit outcome (`result`), the ids it created and the before-image
--                    of what an update replaced (recorded now so import undo, v1.1, needs no migration).
--   import_template  a saved column mapping (per tenant, per entity type), applied to a job by header name.
--
-- Migration range 0110-0119 belongs to this change.

select app.create_tenant_table(
  'import_job',
  $body$
    requested_by       uuid not null,
    source             text not null check (source in ('csv','xlsx','google_admin_csv')),
    entity_type        text not null check (entity_type in ('asset','person','location','department')),
    preset_key         text check (preset_key is null or length(preset_key) <= 64),
    state              text not null default 'draft'
                       check (state in ('draft','uploaded','analyzing','analyzed','mapped','dry_running',
                                        'dry_run_done','committing','completed','failed','cancelled')),
    file_attachment_id uuid,
    filename           text check (filename is null or length(filename) <= 255),
    -- what the analysis found (or what the user overrode): csv | xlsx, encoding, delimiter, sheet, header row
    parse              jsonb not null default '{}'::jsonb check (jsonb_typeof(parse) = 'object'),
    headers            jsonb check (headers is null or jsonb_typeof(headers) = 'array'),
    -- column profile (sample values, distinct counts, detected types, blanks, duplicates) and 50 sample rows
    profile            jsonb check (profile is null or jsonb_typeof(profile) = 'array'),
    samples            jsonb check (samples is null or jsonb_typeof(samples) = 'array'),
    mapping            jsonb not null default '{}'::jsonb
                       check (jsonb_typeof(mapping) = 'object' and pg_column_size(mapping) <= 262144),
    options            jsonb not null default '{}'::jsonb
                       check (jsonb_typeof(options) = 'object' and pg_column_size(options) <= 65536),
    value_map          jsonb not null default '{}'::jsonb
                       check (jsonb_typeof(value_map) = 'object' and pg_column_size(value_map) <= 1048576),
    summary            jsonb check (summary is null or jsonb_typeof(summary) = 'object'),
    rows_total         integer not null default 0 check (rows_total >= 0),
    -- dry run (what WOULD happen) and commit (what happened)
    plan_create        integer not null default 0 check (plan_create >= 0),
    plan_update        integer not null default 0 check (plan_update >= 0),
    plan_skip          integer not null default 0 check (plan_skip >= 0),
    plan_error         integer not null default 0 check (plan_error >= 0),
    done_create        integer not null default 0 check (done_create >= 0),
    done_update        integer not null default 0 check (done_update >= 0),
    done_skip          integer not null default 0 check (done_skip >= 0),
    done_error         integer not null default 0 check (done_error >= 0),
    -- progress of the running phase: rows handled so far and the last row number handled
    rows_processed     integer not null default 0 check (rows_processed >= 0),
    cursor_row         integer not null default 0 check (cursor_row >= 0),
    dry_run_digest     text check (dry_run_digest is null or dry_run_digest ~ '^[0-9a-f]{64}$'),
    dry_run_at         timestamptz,
    committed_at       timestamptz,
    started_at         timestamptz,
    finished_at        timestamptz,
    cancel_requested   boolean not null default false,
    error              text check (error is null or length(error) <= 1000),
    foreign key (tenant_id, requested_by) references app.user_account (tenant_id, id),
    foreign key (tenant_id, file_attachment_id) references app.attachment (tenant_id, id),
    -- a commit can only have started after a dry run was reviewed
    constraint import_job_commit_needs_digest check (
      state not in ('committing','completed') or dry_run_digest is not null)
  $body$,
  'select, insert, update'
);
create index import_job_state_idx on app.import_job (tenant_id, state, updated_at)
  where state in ('analyzing','dry_running','committing');
create index import_job_requester_idx on app.import_job (tenant_id, requested_by, created_at desc, id desc);

-- One row per file row. `raw` is the array of the row's cells (by column index, as read); `mapped` the
-- canonical record the mapping produced; `plan` / `errors` / `warnings` the dry-run verdict; `result` /
-- `result_errors` / `created_id` / `before_image` the commit verdict. The key is (tenant, job, row number),
-- which is also the index the batches walk: no surrogate id, nothing else refers to a row.
create table app.import_row (
  tenant_id     uuid not null references app.tenant (id),
  job_id        uuid not null,
  row_no        integer not null check (row_no >= 1),   -- 1-based position among the data rows
  line_no       integer not null check (line_no >= 1),  -- line (CSV) or row (XLSX) in the file, for messages
  raw           jsonb not null check (jsonb_typeof(raw) = 'array'),
  mapped        jsonb check (mapped is null or jsonb_typeof(mapped) = 'object'),
  match_key     text,                                   -- normalised primary de-duplication key
  match_key2    text,                                   -- normalised secondary key (serial)
  dup_of        integer,                                -- row_no of the first row with the same key
  plan          text check (plan in ('create','update','skip','error')),
  errors        jsonb check (errors is null or jsonb_typeof(errors) = 'array'),
  warnings      jsonb check (warnings is null or jsonb_typeof(warnings) = 'array'),
  entity_id     uuid,                                   -- the existing record an update will change
  entity_version integer,                               -- its version when the dry run looked
  result        text check (result in ('created','updated','skipped','error')),
  result_errors jsonb check (result_errors is null or jsonb_typeof(result_errors) = 'array'),
  created_id    uuid,
  before_image  jsonb check (before_image is null or jsonb_typeof(before_image) = 'object'),
  processed_at  timestamptz,
  primary key (tenant_id, job_id, row_no),
  foreign key (tenant_id, job_id) references app.import_job (tenant_id, id)
);
-- Walking the pending rows of a phase, the error report and the duplicate lookups.
create index import_row_plan_idx on app.import_row (tenant_id, job_id, plan, row_no);
create index import_row_pending_idx on app.import_row (tenant_id, job_id, row_no)
  where result is null and plan in ('create','update');
create index import_row_key_idx on app.import_row (tenant_id, job_id, match_key)
  where match_key is not null;
create index import_row_key2_idx on app.import_row (tenant_id, job_id, match_key2)
  where match_key2 is not null;
-- delete: a re-analysis replaces the rows of the job (only while it has not committed anything)
select app.apply_tenant_conventions('app.import_row', 'select, insert, update, delete');

-- Saved column mappings ("templates") per tenant. `columns` is matched to a file by header text, not by
-- position, so a template made from one export applies to the next one.
select app.create_tenant_table(
  'import_template',
  $body$
    name         text not null check (length(btrim(name)) between 1 and 100),
    name_key     text generated always as (lower(btrim(name))) stored,
    entity_type  text not null check (entity_type in ('asset','person','location','department')),
    description  text check (description is null or length(description) <= 1000),
    columns      jsonb not null check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) <= 500),
    options      jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(options) = 'object' and pg_column_size(options) <= 65536)
  $body$,
  'select, insert, update'
);
create unique index import_template_name_uq
  on app.import_template (tenant_id, entity_type, name_key) where archived_at is null;
