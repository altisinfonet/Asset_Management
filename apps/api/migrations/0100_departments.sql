-- 0100_departments [ED-17; founder request 2026-11-24 "free text causes mistakes"]: managed departments.
-- A tenant table `app.department` replaces the free-text `app.person.department`; people and assets
-- reference it (`department_id`, composite FK). Existing free-text values become departments (one per
-- distinct, trimmed, case-insensitively deduplicated value per tenant) and the people are linked.
-- `person.department` (text) stays for one release as a DEPRECATED, read-only column: nothing reads or
-- writes it any more (the API derives `Person.department` from the linked department); a later migration
-- drops it. app.provision_tenant is replaced from its CURRENT definition (0094): `department:read` joins
-- the read set of every built-in role, `department:manage` joins the Asset manager.
-- Migration range 0100-0109 belongs to this change.

create table app.department (
  id                uuid primary key,
  tenant_id         uuid not null references app.tenant (id),
  name              text not null check (length(btrim(name)) between 1 and 200),
  code              text check (code is null or length(btrim(code)) between 1 and 50),
  description       text,
  manager_person_id uuid,                               -- optional head of the department
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  archived_at       timestamptz,
  version           integer not null default 1,
  -- Stored lower-cased keys: equality on them uses a plain btree through RLS (ADR 0005).
  name_key          text generated always as (lower(btrim(name))) stored,
  code_key          text generated always as (lower(btrim(code))) stored,
  unique (tenant_id, id),
  foreign key (tenant_id, manager_person_id) references app.person (tenant_id, id)
);
-- A name (and a code) is unique among the live departments of a tenant, whatever the case or padding.
create unique index department_name_uq on app.department (tenant_id, name_key) where archived_at is null;
create unique index department_code_uq on app.department (tenant_id, code_key)
  where code is not null and archived_at is null;
create index department_manager_idx on app.department (tenant_id, manager_person_id)
  where manager_person_id is not null;
select app.apply_tenant_conventions('app.department');

-- People: the managed reference replaces the free text.
alter table app.person add column department_id uuid;
alter table app.person
  add constraint person_department_fk
  foreign key (tenant_id, department_id) references app.department (tenant_id, id);
create index person_department_idx on app.person (tenant_id, department_id) where department_id is not null;
comment on column app.person.department is
  'DEPRECATED (0100): the free-text department. Nothing reads or writes it; use department_id. Dropped in a later release.';

-- Assets: an optional owning / cost-centre department next to the location (where it is).
alter table app.asset add column department_id uuid;
alter table app.asset
  add constraint asset_department_fk
  foreign key (tenant_id, department_id) references app.department (tenant_id, id);
create index asset_department_idx on app.asset (tenant_id, department_id) where department_id is not null;

-- Existing data: one department per distinct trimmed, case-insensitively deduplicated free-text value of
-- each tenant (the most used spelling wins, ties go to the alphabetically first), then link the people.
-- app.person and app.department are under FORCE RLS: set the tenant context per tenant (as 0094 did).
-- The touch trigger is switched off for the link so the migration does not bump the people's version
-- and updated_at (their ETags stay valid).
alter table app.person disable trigger trg_touch_person;
do $$
declare
  t uuid;
begin
  for t in select tenant_id from identity.tenant_directory loop
    perform set_config('app.tenant_id', t::text, true);

    insert into app.department (id, tenant_id, name)
    select distinct on (s.key) gen_random_uuid(), t, s.name
      from (
        select lower(btrim(p.department)) as key, left(btrim(p.department), 200) as name, count(*) as n
          from app.person p
         where p.department is not null and btrim(p.department) <> ''
         group by lower(btrim(p.department)), left(btrim(p.department), 200)
      ) s
     -- re-runnable: a department of that name that already exists is reused, not created twice
     where not exists (
       select 1 from app.department d
        where d.tenant_id = t and d.name_key = lower(btrim(s.name)) and d.archived_at is null)
     order by s.key, s.n desc, s.name;

    update app.person p
       set department_id = d.id
      from app.department d
     where d.tenant_id = p.tenant_id
       and d.name_key = lower(btrim(left(p.department, 200)))
       and d.archived_at is null
       and p.department_id is null
       and p.department is not null and btrim(p.department) <> '';
  end loop;
  perform set_config('app.tenant_id', '', true);
end
$$;
alter table app.person enable trigger trg_touch_person;

-- Permissions of the existing tenants: `department:read` for every built-in role that reads the
-- registry, `department:manage` for the Asset manager (the Administrator holds `*`).
do $$
declare
  t uuid;
begin
  for t in select tenant_id from identity.tenant_directory loop
    perform set_config('app.tenant_id', t::text, true);
    update app.role
       set permissions = permissions || array['department:read']
     where is_builtin and key in ('asset_manager', 'technician', 'auditor', 'viewer')
       and not ('department:read' = any (permissions));
    update app.role
       set permissions = permissions || array['department:manage']
     where is_builtin and key = 'asset_manager'
       and not ('department:manage' = any (permissions));
  end loop;
  perform set_config('app.tenant_id', '', true);
end
$$;

-- app.provision_tenant, from the CURRENT definition (0094); the only changes are the two permissions.
-- Any later migration that replaces it again MUST start from THIS definition.
create or replace function app.provision_tenant(
  p_tenant_id     uuid,
  p_name          text,
  p_slug          text,
  p_base_currency text default 'USD',
  p_cell          text default 'us-1'
) returns uuid
language plpgsql set search_path = pg_catalog as $$
declare
  v_read text[] := array[
    'asset:read','catalog:read','location:read','person:read','accessory:read','consumable:read',
    'loaner:read','repair:read','import:read','attachment:read','company:read','search:read',
    'department:read'];
begin
  if p_tenant_id is distinct from nullif(current_setting('app.tenant_id', true), '')::uuid then
    raise exception 'app.tenant_id must be set to the new tenant id before provisioning'
      using errcode = 'insufficient_privilege';
  end if;

  insert into app.tenant (id, name, base_currency, cell) values (p_tenant_id, p_name, p_base_currency, p_cell);
  insert into identity.tenant_directory (tenant_id, slug, cell) values (p_tenant_id, p_slug, p_cell);

  -- default company: every company_id column is populated with it until multi-company ships (v2)
  insert into app.company (id, tenant_id, name, is_default) values (gen_random_uuid(), p_tenant_id, p_name, true);

  -- built-in roles (custom roles are v2)
  insert into app.role (id, tenant_id, key, name, description, permissions, is_builtin) values
    (gen_random_uuid(), p_tenant_id, 'tenant_admin',  'Administrator',  'Full access to the tenant', array['*'], true),
    (gen_random_uuid(), p_tenant_id, 'asset_manager', 'Asset manager',  'Manage the registry, check-outs, imports and reports',
       v_read || array['asset:create','asset:update','asset:delete','asset:checkout','asset:checkin','asset:transfer','asset:label',
                       'catalog:manage','location:manage','person:manage','accessory:manage','accessory:checkout',
                       'consumable:manage','consumable:adjust','loaner:manage','loaner:checkout','repair:manage',
                       'import:run','attachment:write','audit:read','user:read','role:read',
                       'view:share','export:run','department:manage'], true),
    (gen_random_uuid(), p_tenant_id, 'technician',    'Technician',     'Field flows: scan, check-out/in, transfer, repair log, photos',
       v_read || array['asset:update','asset:checkout','asset:checkin','asset:transfer','asset:label','accessory:checkout',
                       'consumable:adjust','loaner:checkout','repair:manage','attachment:write'], true),
    (gen_random_uuid(), p_tenant_id, 'auditor',       'Auditor',        'Read-only including the audit log',
       v_read || array['audit:read','user:read','role:read'], true),
    (gen_random_uuid(), p_tenant_id, 'viewer',        'Viewer',         'Read-only access to the registry', v_read, true);

  -- configurable status labels mapped to fixed state types
  insert into app.status_label (id, tenant_id, name, state_type, color, position, is_default) values
    (gen_random_uuid(), p_tenant_id, 'Ready to deploy', 'deployable',   '#2e7d32', 10, true),
    (gen_random_uuid(), p_tenant_id, 'Deployed',        'deployed',     '#1565c0', 20, false),
    (gen_random_uuid(), p_tenant_id, 'Pending',         'pending',      '#f9a825', 30, false),
    (gen_random_uuid(), p_tenant_id, 'In repair',       'undeployable', '#ef6c00', 40, false),
    (gen_random_uuid(), p_tenant_id, 'Broken',          'undeployable', '#c62828', 50, false),
    (gen_random_uuid(), p_tenant_id, 'Retired',         'archived',     '#616161', 60, false),
    (gen_random_uuid(), p_tenant_id, 'Lost or stolen',  'lost',         '#6a1b9a', 70, false);

  return p_tenant_id;
end
$$;
grant execute on function app.provision_tenant(uuid, text, text, text, text) to app_user;
