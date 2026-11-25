-- 0170_isolation_hardening [M2-SEC-01; ED-28]: two database-level gaps found by the extended isolation harness.
--
-- 1. Schema lint rule 8 (composite foreign keys between tenant tables) only checked that `tenant_id` is
--    SOMEWHERE among the referencing and among the referenced columns. A key such as
--    `(tenant_id, parent_id) references parent (id, tenant_id)` passed although it pairs the tenant
--    column with an id column and does not keep the reference inside the tenant. The rule now requires
--    `tenant_id` to be paired with `tenant_id` at the same position. Every existing key already is; the
--    lint test has a failing fixture for the misaligned form. The rest of the function is unchanged
--    (copied from 0008, its only definition so far).
-- 2. `app.attachment.entity_id` is polymorphic (asset, model, accessory, ...), so no foreign key keeps it
--    inside the tenant: the API checks the owner (422 `not-found`), but a direct insert could name a record
--    of another tenant. A BEFORE INSERT / UPDATE OF trigger now requires the owner row to exist in the SAME
--    tenant and otherwise refuses with foreign_key_violation (23503), exactly like a composite key. The
--    lookup is a primary-key probe on (tenant_id, id); the function is not SECURITY DEFINER (lint rule 5),
--    so under RLS it sees exactly the rows the writer may see.
--
-- Migration range 0170-0179 belongs to this change.

create or replace function app.schema_lint() returns table (violation text)
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
  -- 8. foreign keys between tenant tables must be composite (tenant_id, ...) -> (tenant_id, ...), with
  --    tenant_id paired with tenant_id at the same position (0170: a key that pairs tenant_id with an id
  --    column contains both names and passed the earlier form of this rule)
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
     and not exists (
       select 1
         from generate_subscripts(con.conkey, 1) i
         join pg_attribute ca on ca.attrelid = con.conrelid  and ca.attnum = con.conkey[i]
         join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = con.confkey[i]
        where ca.attname = 'tenant_id' and pa.attname = 'tenant_id')
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

create function app.attachment_owner_guard() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare
  found boolean;
begin
  found := case new.entity_type
    when 'asset'              then exists (select 1 from app.asset              where tenant_id = new.tenant_id and id = new.entity_id)
    when 'asset_model'        then exists (select 1 from app.asset_model        where tenant_id = new.tenant_id and id = new.entity_id)
    when 'accessory'          then exists (select 1 from app.accessory          where tenant_id = new.tenant_id and id = new.entity_id)
    when 'consumable'         then exists (select 1 from app.consumable         where tenant_id = new.tenant_id and id = new.entity_id)
    when 'location'           then exists (select 1 from app.location           where tenant_id = new.tenant_id and id = new.entity_id)
    when 'person'             then exists (select 1 from app.person             where tenant_id = new.tenant_id and id = new.entity_id)
    when 'maintenance_record' then exists (select 1 from app.maintenance_record where tenant_id = new.tenant_id and id = new.entity_id)
    when 'assignment'         then exists (select 1 from app.assignment         where tenant_id = new.tenant_id and id = new.entity_id)
    when 'import_job'         then exists (select 1 from app.import_job         where tenant_id = new.tenant_id and id = new.entity_id)
    -- an unknown type is left to the entity_type CHECK constraint, which is checked after this trigger
    else true
  end;
  if not found then
    raise exception 'attachment owner %/% is not a record of tenant %', new.entity_type, new.entity_id, new.tenant_id
      using errcode = 'foreign_key_violation', constraint = 'attachment_owner_same_tenant';
  end if;
  return new;
end
$$;

create trigger attachment_owner_guard
  before insert or update of tenant_id, entity_type, entity_id on app.attachment
  for each row execute function app.attachment_owner_guard();
