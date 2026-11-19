-- 0040_locations_people [M2-LOC-01, M2-LOC-02, M2-USR-01; ED-01, ED-07]: the location hierarchy, people
-- (assignable persons with or without a login), and the two foreign keys the M1 migrations left open:
-- app.asset.location_id and app.role_assignment.scope_location_id now reference app.location.
-- Source of truth for the shapes: docs/engineering/schema.sql (B4). The M2 wave-1 agent owns 0040-0049.

-- -----------------------------------------------------------------------------
-- Locations: site > building > floor > room ... as an adjacency list plus a trigger-maintained
-- materialised path (ancestor_ids = root..self). ED-07: subtree queries use ancestor_ids; RLS stays
-- tenant-only; no ltree.
-- -----------------------------------------------------------------------------

create table app.location (
  id           uuid primary key,
  tenant_id    uuid not null references app.tenant (id),
  company_id   uuid not null,
  parent_id    uuid,
  name         text not null check (length(btrim(name)) between 1 and 200),
  kind         text not null default 'other'
               check (kind in ('site','building','floor','room','storage','vehicle','other')),
  code         text,
  address      jsonb check (address is null or jsonb_typeof(address) = 'object'),
  latitude     numeric(9,6) check (latitude  between -90  and 90),
  longitude    numeric(9,6) check (longitude between -180 and 180),
  notes        text,
  ancestor_ids uuid[] not null default '{}',           -- root..self, maintained by trigger (subtree filter)
  depth        integer not null default 0,             -- maintained by trigger
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  archived_at  timestamptz,
  version      integer not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references app.company (tenant_id, id),
  foreign key (tenant_id, parent_id)  references app.location (tenant_id, id),
  check (parent_id is distinct from id)
);
-- A name is unique among the live children of one parent (roots share the NULL parent).
create unique index location_sibling_name_uq on app.location (tenant_id, parent_id, lower(name))
  nulls not distinct where archived_at is null;
create index location_parent_idx  on app.location (tenant_id, parent_id);
create index location_company_idx on app.location (tenant_id, company_id);
create index location_ancestors_gin on app.location using gin (tenant_id, ancestor_ids);
select app.apply_tenant_conventions('app.location');

create trigger trg_company_location before insert on app.location
  for each row execute function app.fill_default_company();

-- BEFORE trigger derives the path from the parent and rejects cycles (a location under its own
-- subtree); AFTER trigger rewrites the path of every descendant when a location moves, in the same
-- statement and transaction as the move.
create function app.location_before_write() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare
  p_anc uuid[];
begin
  if new.parent_id is null then
    new.ancestor_ids := array[new.id];
    new.depth := 0;
  else
    select l.ancestor_ids into p_anc
      from app.location l
     where l.tenant_id = new.tenant_id and l.id = new.parent_id;
    if p_anc is null then
      raise exception 'parent location % not found', new.parent_id using errcode = 'foreign_key_violation';
    end if;
    if new.id = any (p_anc) then
      raise exception 'location hierarchy cycle (location % under its own subtree)', new.id
        using errcode = 'check_violation';
    end if;
    new.ancestor_ids := p_anc || new.id;
    new.depth := cardinality(p_anc);
  end if;
  return new;
end
$$;

create function app.location_after_move() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  update app.location d
     set ancestor_ids = new.ancestor_ids || d.ancestor_ids[array_position(d.ancestor_ids, new.id) + 1:],
         depth = cardinality(new.ancestor_ids) + cardinality(d.ancestor_ids[array_position(d.ancestor_ids, new.id) + 1:]) - 1
   where d.tenant_id = new.tenant_id
     and d.id <> new.id
     and new.id = any (d.ancestor_ids);
  return null;
end
$$;

create trigger location_a_before_write before insert or update of parent_id on app.location
  for each row execute function app.location_before_write();
create trigger location_c_after_move after update of parent_id on app.location
  for each row when (old.parent_id is distinct from new.parent_id)
  execute function app.location_after_move();

-- The M1 migrations deliberately left these two columns without a foreign key.
alter table app.asset
  add constraint asset_location_fk
  foreign key (tenant_id, location_id) references app.location (tenant_id, id);
alter table app.role_assignment
  add constraint role_assignment_scope_location_fk
  foreign key (tenant_id, scope_location_id) references app.location (tenant_id, id);

-- -----------------------------------------------------------------------------
-- People (ED-01): the assignee of a custody period. A person may have no login (students,
-- contractors); a person with a login links to user_account (user_id, unique). Assignments always
-- target a person, never a user_account.
-- -----------------------------------------------------------------------------

create table app.person (
  id           uuid primary key,
  tenant_id    uuid not null references app.tenant (id),
  company_id   uuid not null,
  user_id      uuid,
  kind         text not null default 'employee'
               check (kind in ('employee','student','contractor','external')),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  first_name   text,
  last_name    text,
  email        text check (email is null or position('@' in email) > 1),
  phone        text,
  employee_ref text,
  department   text,
  job_title    text,
  location_id  uuid,                                    -- primary / home location
  status       text not null default 'active' check (status in ('active','inactive')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  archived_at  timestamptz,
  version      integer not null default 1,
  -- Stored lower-cased keys: equality on them uses a plain btree through RLS (ADR 0005).
  email_key    text generated always as (lower(email)) stored,
  search_text  text generated always as (
    lower(display_name || chr(31) || coalesce(email, '') || chr(31) || coalesce(employee_ref, ''))
  ) stored,
  unique (tenant_id, id),
  unique (tenant_id, user_id),
  foreign key (tenant_id, company_id)  references app.company (tenant_id, id),
  foreign key (tenant_id, user_id)     references app.user_account (tenant_id, id),
  foreign key (tenant_id, location_id) references app.location (tenant_id, id)
);
create unique index person_employee_ref_uq on app.person (tenant_id, employee_ref)
  where employee_ref is not null and archived_at is null;
create unique index person_email_uq on app.person (tenant_id, email_key)
  where email is not null and archived_at is null;
create index person_name_idx     on app.person (tenant_id, display_name, id);
create index person_company_idx  on app.person (tenant_id, company_id);
create index person_location_idx on app.person (tenant_id, location_id) where location_id is not null;
select app.apply_tenant_conventions('app.person');

create trigger trg_company_person before insert on app.person
  for each row execute function app.fill_default_company();

-- One person row per login account (ED-01). A person that already exists with the same email and no
-- login becomes the new user's person (the "link later" case); otherwise a new person is created.
-- SECURITY INVOKER: runs under the caller's RLS, so the row belongs to the transaction's tenant.
create function app.user_account_after_insert_person() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare
  v_person uuid;
  v_email_taken boolean;
begin
  select p.id into v_person
    from app.person p
   where p.tenant_id = new.tenant_id and p.user_id is null and p.archived_at is null
     and p.email_key = lower(new.email)
   limit 1;
  if v_person is not null then
    update app.person set user_id = new.id where tenant_id = new.tenant_id and id = v_person;
    return null;
  end if;
  select exists (
    select 1 from app.person p
     where p.tenant_id = new.tenant_id and p.archived_at is null and p.email_key = lower(new.email)
  ) into v_email_taken;
  insert into app.person (id, tenant_id, user_id, kind, display_name, email)
  values (gen_random_uuid(), new.tenant_id, new.id, 'employee', new.display_name,
          case when v_email_taken then null else new.email end);
  return null;
end
$$;
create trigger user_account_person_after_insert after insert on app.user_account
  for each row execute function app.user_account_after_insert_person();

-- A renamed login account renames its person.
create function app.user_account_after_update_person() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  update app.person p
     set display_name = new.display_name,
         email = case when exists (
                   select 1 from app.person o
                    where o.tenant_id = p.tenant_id and o.id <> p.id and o.archived_at is null
                      and o.email_key = lower(new.email))
                 then p.email else new.email end
   where p.tenant_id = new.tenant_id and p.user_id = new.id
     and (p.display_name is distinct from new.display_name or p.email is distinct from new.email);
  return null;
end
$$;
create trigger user_account_person_after_update after update of display_name, email on app.user_account
  for each row when (old.display_name is distinct from new.display_name or old.email is distinct from new.email)
  execute function app.user_account_after_update_person();

-- Backfill: every existing login account gets its person (FORCE RLS binds the owner too: set the
-- tenant context per tenant, exactly as 0011 does).
do $$
declare
  t uuid;
begin
  for t in select tenant_id from identity.tenant_directory loop
    perform set_config('app.tenant_id', t::text, true);
    insert into app.person (id, tenant_id, company_id, user_id, kind, display_name, email, status)
    select gen_random_uuid(), u.tenant_id,
           (select c.id from app.company c where c.tenant_id = u.tenant_id and c.is_default),
           u.id, 'employee', u.display_name, u.email, 'active'
      from app.user_account u
     where not exists (select 1 from app.person p where p.tenant_id = u.tenant_id and p.user_id = u.id)
     order by u.created_at, u.id
    on conflict do nothing;
  end loop;
  perform set_config('app.tenant_id', '', true);
end
$$;
