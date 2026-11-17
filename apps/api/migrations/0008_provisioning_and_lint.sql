-- 0008_provisioning_and_lint [M1]: tenant provisioning and the schema lint.

-- -----------------------------------------------------------------------------
-- Tenant provisioning (SECURITY INVOKER; runs as app_user under RLS).
-- The caller must have made app.tenant_id equal to p_tenant_id (transaction-local) first.
-- Seed rows get gen_random_uuid() ids (v4): there is no database-side id default (ED-08) and
-- nothing depends on seed ids being time-ordered. The M2 migration that creates
-- app.label_template replaces this function to seed the fixed label sheets as well.
-- -----------------------------------------------------------------------------

create function app.provision_tenant(
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
    'loaner:read','repair:read','import:read','attachment:read','company:read'];
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
                       'import:run','attachment:write','audit:read','user:read','role:read'], true),
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

-- -----------------------------------------------------------------------------
-- Schema lint (M1-TEN-03). CI: `select * from app.schema_lint()` must return zero rows
-- (apps/api CLI: `schema:lint`). Also runs at the end of this migration and after every `migrate`.
--
-- Classification: every table is `tenant` (schema app, tenant_id column or app.tenant itself),
-- `non-tenant` (schema identity, with a table comment starting 'non-tenant: <reason>') or
-- `partition` (child of a partitioned parent). Anything else is unclassified and fails.
-- -----------------------------------------------------------------------------

create function app.schema_lint() returns table (violation text)
language sql stable set search_path = pg_catalog as $$
  -- 1. every tenant table has ENABLE + FORCE RLS and the NULLIF policy on both USING and WITH CHECK
  select format('table app.%s lacks RLS/FORCE or the tenant_isolation policy', c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind in ('r','p')
     and (c.relname = 'tenant' or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped))
     and not (
       c.relrowsecurity and c.relforcerowsecurity and exists (
         select 1 from pg_policy p
          where p.polrelid = c.oid
            and pg_get_expr(p.polqual, p.polrelid)      like '%NULLIF(current_setting(''app.tenant_id''%'
            and pg_get_expr(p.polwithcheck, p.polrelid) like '%NULLIF(current_setting(''app.tenant_id''%'))
  union all
  -- 2. tenant_id must lead at least one index (RLS filter + FK checks stay fast)
  select format('table app.%s has no index led by tenant_id', c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
   where n.nspname = 'app' and c.relkind in ('r','p') and not c.relispartition
     and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)
  union all
  -- 3. no privilege on any partition for anyone but the owner (direct partition reads bypass the parent policy)
  select format('partition app.%s has a grant to %s', c.relname, case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) x
   where c.relispartition and n.nspname = 'app' and x.grantee <> c.relowner
  union all
  -- 4. views must be security_invoker
  select format('view %s.%s is not security_invoker', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'v' and n.nspname in ('app','identity')
     and not coalesce('security_invoker=true' = any (c.reloptions) or 'security_invoker=on' = any (c.reloptions), false)
  union all
  -- 5. SECURITY DEFINER is banned
  select format('function %s.%s is SECURITY DEFINER', n.nspname, p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app','identity') and p.prosecdef
  union all
  -- 6. no application role may be superuser / BYPASSRLS (FORCE does not bind either)
  select format('role %s is superuser or BYPASSRLS', r.rolname)
    from pg_roles r
   where (r.rolname in ('app_user','app_owner') or r.rolname like 'app\_%')
     and (r.rolsuper or r.rolbypassrls)
  union all
  -- 6b. the runtime role owns nothing and cannot create objects
  select format('app_user owns %s', c.relname)
    from pg_class c join pg_roles r on r.oid = c.relowner
   where r.rolname = 'app_user' and c.relnamespace in ('app'::regnamespace, 'identity'::regnamespace)
  union all
  select format('app_user has CREATE on schema %s', n.nspname)
    from pg_namespace n
   where n.nspname in ('app','identity','public')
     and exists (select 1 from pg_roles where rolname = 'app_user')
     and has_schema_privilege('app_user', n.oid, 'CREATE')
  union all
  -- 7. no database-side uuidv7() default (PostgreSQL 18 only; ids come from the application, ED-08)
  select format('column %s.%s has a uuidv7() default (PostgreSQL 18 only; the app supplies ids)', c.relname, a.attname)
    from pg_attrdef d
    join pg_class c on c.oid = d.adrelid
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where c.relnamespace in ('app'::regnamespace, 'identity'::regnamespace)
     and pg_get_expr(d.adbin, d.adrelid) like '%uuidv7%'
  union all
  -- 8. foreign keys between tenant tables must be composite (tenant_id, ...) -> (tenant_id, ...)
  select format('foreign key %s on %s.%s must be composite on (tenant_id, ...) -> %s.%s (tenant_id, ...)',
                con.conname, n.nspname, c.relname, rn.nspname, rc.relname)
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class rc on rc.oid = con.confrelid
    join pg_namespace rn on rn.oid = rc.relnamespace
   where con.contype = 'f' and con.conparentid = 0
     and n.nspname in ('app','identity') and rn.nspname = 'app'
     and exists (select 1 from pg_attribute a where a.attrelid = rc.oid and a.attname = 'tenant_id' and not a.attisdropped)
     and not (
       exists (select 1 from pg_attribute a where a.attrelid = con.conrelid and a.attname = 'tenant_id' and a.attnum = any (con.conkey))
       and exists (select 1 from pg_attribute a where a.attrelid = con.confrelid and a.attname = 'tenant_id' and a.attnum = any (con.confkey)))
  union all
  -- 9. classification: no unclassified tables
  select format('table app.%s is unclassified: it has no tenant_id column (tenant tables carry tenant_id; app.tenant is the only exception)', c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind in ('r','p') and not c.relispartition and c.relname <> 'tenant'
     and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
  union all
  select format('table identity.%s is unclassified: add COMMENT ON TABLE ... IS ''non-tenant: <reason>''', c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'identity' and c.relkind in ('r','p') and not c.relispartition
     and coalesce(obj_description(c.oid, 'pg_class'), '') not like 'non-tenant: _%'
$$;

do $$
declare
  v text;
  n integer := 0;
begin
  for v in select violation from app.schema_lint() loop
    raise warning 'schema lint: %', v;
    n := n + 1;
  end loop;
  if n > 0 then
    raise exception 'schema lint failed with % violation(s)', n;
  end if;
  raise notice 'schema lint OK';
end
$$;
