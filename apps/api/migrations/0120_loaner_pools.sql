-- 0120_loaner_pools [M2-LOAN-01, M2-LOAN-03, M2-LIFE-09; ED-20, ED-21, ADR 0011]: the loaner pool, its
-- membership, the assignment -> pool foreign key that migration 0041 left open, and the alert ledger the
-- overdue job uses to say "once per loan per state". Source of truth for the shapes:
-- docs/engineering/schema.sql (B8, B9, B15). Migration range 0120-0129 belongs to this change.
--
-- No permission changes: loaner:read / loaner:manage / loaner:checkout already exist in every tenant
-- (app.provision_tenant since 0008, unchanged here).

-- -----------------------------------------------------------------------------
-- The pool: a named set of spare devices with loan rules.
-- -----------------------------------------------------------------------------

create table app.loaner_pool (
  id                   uuid primary key,
  tenant_id            uuid not null references app.tenant (id),
  name                 text not null check (length(btrim(name)) between 1 and 200),
  description          text,
  home_location_id     uuid,                                   -- where returned devices go back to (the cart)
  default_loan_days    integer not null default 7 check (default_loan_days > 0),
  max_loan_days        integer check (max_loan_days is null or max_loan_days >= default_loan_days),
  -- null = no limit; otherwise the number of open loans one person may hold from this pool at once
  max_loans_per_person integer check (max_loans_per_person is null or max_loans_per_person >= 1),
  -- empty = every kind of person may borrow (the API shows null); otherwise only the listed kinds
  eligible_person_kinds text[] not null default '{}'
                          check (cardinality(eligible_person_kinds) <= 4
                          and eligible_person_kinds <@ array['employee','student','contractor','external']::text[]),
  owner_user_id        uuid,                                   -- who is told about overdue loans (else the pool managers)
  is_active            boolean not null default true,          -- an inactive pool lends nothing but keeps its members
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  archived_at          timestamptz,
  version              integer not null default 1,
  -- Stored lower-cased key: equality on it uses a plain btree through RLS (ADR 0005).
  name_key             text generated always as (lower(btrim(name))) stored,
  unique (tenant_id, id),
  foreign key (tenant_id, home_location_id) references app.location (tenant_id, id),
  foreign key (tenant_id, owner_user_id)    references app.user_account (tenant_id, id)
);
create unique index loaner_pool_name_uq on app.loaner_pool (tenant_id, name_key) where archived_at is null;
create index loaner_pool_location_idx on app.loaner_pool (tenant_id, home_location_id)
  where home_location_id is not null;
select app.apply_tenant_conventions('app.loaner_pool');

-- -----------------------------------------------------------------------------
-- Membership: an asset belongs to at most one pool (the primary key). Plain rows, removed with a
-- DELETE (membership is a fact about "now", the history lives in the audit log and asset history).
-- -----------------------------------------------------------------------------

create table app.loaner_pool_member (
  tenant_id      uuid not null references app.tenant (id),
  asset_id       uuid not null,
  loaner_pool_id uuid not null,
  added_at       timestamptz not null default now(),
  added_by       uuid,
  primary key (tenant_id, asset_id),
  foreign key (tenant_id, asset_id)       references app.asset (tenant_id, id),
  foreign key (tenant_id, loaner_pool_id) references app.loaner_pool (tenant_id, id)
);
create index loaner_pool_member_pool_idx on app.loaner_pool_member (tenant_id, loaner_pool_id);
select app.apply_tenant_conventions('app.loaner_pool_member', 'select, insert, delete');

-- -----------------------------------------------------------------------------
-- The foreign key migration 0041 left to the integrator: a loan belongs to a pool of the same tenant.
-- (The CHECK assignment_loan_due already requires an asset and a due date for a loan.)
-- -----------------------------------------------------------------------------

alter table app.assignment
  add constraint assignment_loaner_pool_fk
  foreign key (tenant_id, loaner_pool_id) references app.loaner_pool (tenant_id, id);

-- The dashboard's "recent activity" and the loan lists read loans newest first (ADR 0011).
create index assignment_loan_out_idx on app.assignment (tenant_id, checked_out_at desc, id desc)
  where loaner_pool_id is not null;
create index assignment_loan_in_idx on app.assignment (tenant_id, checked_in_at desc, id desc)
  where loaner_pool_id is not null and checked_in_at is not null;

-- -----------------------------------------------------------------------------
-- Alert ledger (M2-LOAN-03): one row per alert the daily job raised. The unique indexes make the job
-- re-runnable: the first run of a day inserts the row and emits the event, a second run finds the row
-- and stays silent. due_soon: once per loan and due date (an extension re-arms it); overdue: once per
-- loan and day. Append-only (SELECT/INSERT).
-- -----------------------------------------------------------------------------

create table app.loan_alert (
  id              uuid primary key,
  tenant_id       uuid not null references app.tenant (id),
  assignment_id   uuid not null,
  kind            text not null check (kind in ('due_soon','overdue')),
  alert_date      date not null,                               -- the day the job ran for (tenant day: UTC)
  expected_return date not null,                               -- the due date the alert was about
  days_overdue    integer not null default 0 check (days_overdue >= 0),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, assignment_id) references app.assignment (tenant_id, id)
);
create unique index loan_alert_due_soon_uq on app.loan_alert (tenant_id, assignment_id, expected_return)
  where kind = 'due_soon';
create unique index loan_alert_overdue_uq on app.loan_alert (tenant_id, assignment_id, alert_date)
  where kind = 'overdue';
select app.apply_tenant_conventions('app.loan_alert', 'select, insert');
