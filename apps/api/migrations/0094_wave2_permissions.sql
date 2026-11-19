-- 0094_wave2_permissions [M2-REG-01, M2-REG-02, M2-NOT-01]: `view:share` (share a saved view with the
-- whole organisation) and `export:run` (CSV exports) are granted to the built-in Asset manager;
-- `notification:manage` (notification rules and the delivery log) belongs to the Administrator only, who
-- holds `*`. Existing tenants are updated in place and app.provision_tenant is replaced so new tenants get
-- them.
--
-- app.provision_tenant is replaced starting from the CURRENT definition (0011, which kept `search:read`
-- for every built-in role); the only change is the two permissions on the asset_manager row. Any later
-- migration that replaces it again MUST start from THIS definition. test/auth/role-seed.e2e.test.ts
-- compares a freshly provisioned tenant with src/auth/permissions.ts.

-- app.role is under FORCE RLS: set the tenant context per tenant (as 0011 did).
do $$
declare
  t uuid;
begin
  for t in select tenant_id from identity.tenant_directory loop
    perform set_config('app.tenant_id', t::text, true);
    update app.role
       set permissions = permissions || array['view:share', 'export:run']
     where is_builtin and key = 'asset_manager'
       and not ('view:share' = any (permissions));
  end loop;
  perform set_config('app.tenant_id', '', true);
end
$$;

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
    'loaner:read','repair:read','import:read','attachment:read','company:read','search:read'];
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
                       'view:share','export:run'], true),
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
