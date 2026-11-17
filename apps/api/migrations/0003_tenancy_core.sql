-- 0003_tenancy_core [M1]: tenant, company, users, roles, invitations, API keys.
-- Every table gets the tenancy conventions (RLS ENABLE + FORCE, NULLIF policy, touch trigger, grants)
-- from app.apply_tenant_conventions (0002). Ids are supplied by the application (UUIDv7, ED-08).

-- Tenant registry row. RLS: a tenant sees only its own row (id = app.tenant_id), which
-- also lets signup insert a tenant while the new id is the transaction's tenant context.
create table app.tenant (
  id            uuid primary key,
  name          text not null check (length(btrim(name)) between 1 and 200),
  plan          text not null default 'free'
                check (plan in ('free','starter','pro','enterprise','self_hosted')),
  status        text not null default 'active'
                check (status in ('active','suspended','pending_deletion')),
  cell          text not null default 'us-1',
  base_currency text not null default 'USD' check (base_currency ~ '^[A-Z]{3}$'),
  settings      jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);
select app.apply_tenant_conventions('app.tenant', 'select, insert, update', 'id');

create table app.company (
  id          uuid primary key,
  tenant_id   uuid not null references app.tenant (id),
  name        text not null check (length(btrim(name)) between 1 and 200),
  code        text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  archived_at timestamptz,
  version     integer not null default 1,
  unique (tenant_id, id),
  check (not is_default or archived_at is null)
);
create unique index company_one_default_uq on app.company (tenant_id) where is_default;
create unique index company_name_uq on app.company (tenant_id, lower(name)) where archived_at is null;
select app.apply_tenant_conventions('app.company');

-- -----------------------------------------------------------------------------
-- Users and roles (login-capable accounts only; assignable-only people are app.person [M2])
-- -----------------------------------------------------------------------------

create table app.role (
  id          uuid primary key,
  tenant_id   uuid not null references app.tenant (id),
  key         text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name        text not null check (length(btrim(name)) between 1 and 100),
  description text,
  permissions text[] not null default '{}',          -- 'resource:action' strings, '*' = all
  is_builtin  boolean not null default false,        -- built-in roles are seeded; custom roles are v2
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, key)
);
select app.apply_tenant_conventions('app.role');

create table app.user_account (
  id            uuid primary key,
  tenant_id     uuid not null references app.tenant (id),
  email         text not null check (position('@' in email) > 1),
  display_name  text not null check (length(btrim(display_name)) between 1 and 200),
  status        text not null default 'invited' check (status in ('invited','active','disabled')),
  locale        text,
  timezone      text,
  mfa_enabled   boolean not null default false,      -- mirror of identity.mfa_factor, for UI/policy reads
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  archived_at   timestamptz,
  version       integer not null default 1,
  unique (tenant_id, id)
);
create unique index user_account_email_uq on app.user_account (tenant_id, lower(email)) where archived_at is null;
create index user_account_status_idx on app.user_account (tenant_id, status);
select app.apply_tenant_conventions('app.user_account');

create table app.invitation (
  id          uuid primary key,
  tenant_id   uuid not null references app.tenant (id),
  user_id     uuid,                                   -- the invited (status = invited) account
  email       text not null,
  role_id     uuid not null,
  status      text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  version     integer not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, role_id) references app.role (tenant_id, id),
  foreign key (tenant_id, user_id) references app.user_account (tenant_id, id)
);
create index invitation_pending_idx on app.invitation (tenant_id, lower(email)) where status = 'pending';
select app.apply_tenant_conventions('app.invitation');

-- [M1 columns, M2 target] role scope: tenant-wide, one company, or a location subtree.
-- scope_location_id has NO foreign key yet: app.location is an M2 table. The M2 migration that
-- creates app.location adds FOREIGN KEY (tenant_id, scope_location_id) REFERENCES app.location.
create table app.role_assignment (
  id                uuid primary key,
  tenant_id         uuid not null references app.tenant (id),
  user_id           uuid not null,
  role_id           uuid not null,
  scope_type        text not null default 'tenant' check (scope_type in ('tenant','company','location')),
  scope_company_id  uuid,
  scope_location_id uuid,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, user_id)          references app.user_account (tenant_id, id),
  foreign key (tenant_id, role_id)          references app.role (tenant_id, id),
  foreign key (tenant_id, scope_company_id) references app.company (tenant_id, id),
  check (
    (scope_type = 'tenant'   and scope_company_id is null     and scope_location_id is null) or
    (scope_type = 'company'  and scope_company_id is not null and scope_location_id is null) or
    (scope_type = 'location' and scope_location_id is not null and scope_company_id is null)
  )
);
create unique index role_assignment_uq on app.role_assignment
  (tenant_id, user_id, role_id, scope_type, scope_company_id, scope_location_id) nulls not distinct;
create index role_assignment_user_idx on app.role_assignment (tenant_id, user_id);
select app.apply_tenant_conventions('app.role_assignment', 'select, insert, update, delete');

-- Machine credentials. The secret is never stored here; identity.api_key_lookup holds the hash.
create table app.api_key (
  id           uuid primary key,
  tenant_id    uuid not null references app.tenant (id),
  name         text not null check (length(btrim(name)) between 1 and 100),
  key_prefix   text not null check (key_prefix ~ '^[A-Za-z0-9]{8,16}$'),
  scopes       text[] not null default '{}',          -- 'resource:action' strings
  expires_at   timestamptz,
  last_used_at timestamptz,
  last_used_ip inet,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  version      integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, key_prefix)
);
select app.apply_tenant_conventions('app.api_key');
