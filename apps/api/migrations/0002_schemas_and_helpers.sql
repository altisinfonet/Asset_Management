-- 0002_schemas_and_helpers [M1]: schemas, extensions, generic trigger functions and the tenant-table
-- helper functions. Runs as app_owner (the migrator) over a direct connection.
-- Source of truth for the shapes: docs/engineering/schema.sql (see ADR 0001 for the conversion rules).
-- Roles app_owner / app_user and the extensions are bootstrapped by docker/postgres/init/01-roles.sql;
-- the `create extension if not exists` below is a no-op there (both are trusted extensions, so the
-- database owner may create them on a bring-your-own Postgres where the bootstrap did not).

create extension if not exists pg_trgm   schema public;   -- fuzzy search on tag/serial/name
create extension if not exists btree_gin schema public;   -- lets GIN indexes lead with tenant_id

create schema if not exists app;        -- tenant data, RLS
create schema if not exists identity;   -- pre-auth lookups, NO RLS (hashes + ids only)
revoke all on schema app, identity from public;
grant usage on schema app, identity to app_user;

-- -----------------------------------------------------------------------------
-- Generic trigger functions (SECURITY INVOKER, fixed search_path)
-- -----------------------------------------------------------------------------

-- Optimistic concurrency: version drives the HTTP ETag; every UPDATE bumps it.
create function app.touch_row() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  new.updated_at := now();
  new.version    := old.version + 1;
  return new;
end
$$;

-- company_id is a scoping column populated with the tenant's default company until
-- the multi-company UI exists (plan 6.1).
create function app.fill_default_company() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.company_id is null then
    select c.id into new.company_id
      from app.company c
     where c.tenant_id = new.tenant_id and c.is_default;
  end if;
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- Tenant-table conventions (M1-TEN-01). The single approved way to make a table tenant-scoped.
-- -----------------------------------------------------------------------------

-- The policy predicate. NULLIF is mandatory: after a tenant transaction a pooled connection returns
-- '' (not NULL) for the custom GUC, and a bare ''::uuid raises 22P02 (spike finding F1). The
-- sub-select makes Postgres evaluate it once per statement.
create function app.tenant_guard() returns text
language sql immutable set search_path = pg_catalog as $$
  select '(select nullif(current_setting(''app.tenant_id'', true), '''')::uuid)'
$$;

-- Applies the tenancy conventions to an EXISTING table: ENABLE + FORCE RLS, the tenant_isolation
-- policy (NULLIF form, USING and WITH CHECK), the version/updated_at trigger when the table has a
-- version column, and DML grants for app_user on the table itself (never on partitions: grants on a
-- partitioned PARENT are enough, and a direct grant on a partition would bypass the parent policy).
-- p_key is the tenant column: 'tenant_id' (default) or 'id' for app.tenant itself.
-- Idempotent. Run by app_owner (migrations); app_user cannot execute it.
create function app.apply_tenant_conventions(
  p_table  regclass,
  p_grants text default 'select, insert, update',
  p_key    text default 'tenant_id'
) returns void
language plpgsql set search_path = pg_catalog as $$
declare
  v_schema text;
  v_name   text;
  v_guard  text := app.tenant_guard();
  v_is_partition boolean;
  v_has_version boolean;
begin
  select n.nspname, c.relname, c.relispartition
    into v_schema, v_name, v_is_partition
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.oid = p_table;

  if v_schema <> 'app' then
    raise exception 'tenant tables live in schema app, not %.%', v_schema, v_name;
  end if;
  if v_is_partition then
    raise exception 'apply_tenant_conventions on partition app.%: configure the partitioned parent (partitions are handled by app.ensure_partitions)', v_name;
  end if;
  if p_key not in ('tenant_id', 'id') then
    raise exception 'p_key must be tenant_id or id';
  end if;
  if not exists (select 1 from pg_attribute a where a.attrelid = p_table and a.attname = p_key and not a.attisdropped) then
    raise exception 'table app.% has no column %', v_name, p_key;
  end if;

  execute format('alter table %s enable row level security', p_table);
  execute format('alter table %s force row level security', p_table);
  execute format('drop policy if exists tenant_isolation on %s', p_table);
  execute format('create policy tenant_isolation on %s using (%I = %s) with check (%I = %s)',
                 p_table, p_key, v_guard, p_key, v_guard);

  select exists (select 1 from pg_attribute a where a.attrelid = p_table and a.attname = 'version' and not a.attisdropped)
    into v_has_version;
  if v_has_version and not exists (select 1 from pg_trigger t where t.tgrelid = p_table and t.tgname = 'trg_touch_' || v_name) then
    execute format('create trigger %I before update on %s for each row execute function app.touch_row()',
                   'trg_touch_' || v_name, p_table);
  end if;

  if p_grants is not null and p_grants <> '' then
    execute format('grant %s on %s to app_user', p_grants, p_table);
  end if;
end
$$;
revoke all on function app.apply_tenant_conventions(regclass, text, text) from public;

-- Creates a tenant table with the standard columns and conventions in one call:
--   id uuid PK (application supplied, UUIDv7: NO database default), tenant_id uuid NOT NULL -> app.tenant,
--   [company_id uuid NOT NULL], created_at / updated_at / created_by / updated_by / archived_at / version,
--   UNIQUE (tenant_id, id) so children can use composite FKs, a tenant-led index, RLS + policy + grants.
-- p_body is extra column and constraint DDL (comma separated, no leading comma).
-- Composite foreign keys to other tenant tables are written in p_body as
--   FOREIGN KEY (tenant_id, x_id) REFERENCES app.x (tenant_id, id).
create function app.create_tenant_table(
  p_name    text,
  p_body    text default '',
  p_grants  text default 'select, insert, update',
  p_company boolean default false
) returns regclass
language plpgsql set search_path = pg_catalog as $$
declare
  v_ddl text;
begin
  if p_name !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception 'invalid table name %', p_name;
  end if;
  v_ddl := format($f$
    create table app.%I (
      id          uuid primary key,
      tenant_id   uuid not null references app.tenant (id),
      %s
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now(),
      created_by  uuid,
      updated_by  uuid,
      archived_at timestamptz,
      version     integer not null default 1,
      unique (tenant_id, id)%s
    )$f$,
    p_name,
    case when p_company then 'company_id uuid not null,' else '' end,
    case when coalesce(btrim(p_body), '') = '' then '' else ', ' || p_body end);
  execute v_ddl;
  execute format('create index %I on app.%I (tenant_id, created_at desc, id desc)', p_name || '_tenant_created_idx', p_name);
  if p_company then
    execute format('alter table app.%I add foreign key (tenant_id, company_id) references app.company (tenant_id, id)', p_name);
    execute format('create trigger %I before insert on app.%I for each row execute function app.fill_default_company()',
                   'trg_company_' || p_name, p_name);
  end if;
  perform app.apply_tenant_conventions(format('app.%I', p_name)::regclass, p_grants);
  return format('app.%I', p_name)::regclass;
end
$$;
revoke all on function app.create_tenant_table(text, text, text, boolean) from public;
