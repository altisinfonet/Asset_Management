-- 0004_catalog [M1]: registry catalogue (category, manufacturer, vendor, asset_model, status_label,
-- custom_field_def, asset_tag_counter).

create table app.category (
  id          uuid primary key,
  tenant_id   uuid not null references app.tenant (id),
  name        text not null check (length(btrim(name)) between 1 and 100),
  kind        text not null default 'asset'
              check (kind in ('asset','accessory','consumable','component','license')),
  tag_prefix  text check (tag_prefix is null or tag_prefix ~ '^[A-Z0-9-]{1,12}$'),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  archived_at timestamptz,
  version     integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, id, kind)                          -- lets children pin the category kind in the FK
);
create unique index category_name_uq on app.category (tenant_id, kind, lower(name)) where archived_at is null;
select app.apply_tenant_conventions('app.category');

create table app.manufacturer (
  id            uuid primary key,
  tenant_id     uuid not null references app.tenant (id),
  name          text not null check (length(btrim(name)) between 1 and 200),
  url           text,
  support_url   text,
  support_email text,
  support_phone text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  archived_at   timestamptz,
  version       integer not null default 1,
  unique (tenant_id, id)
);
create unique index manufacturer_name_uq on app.manufacturer (tenant_id, lower(name)) where archived_at is null;
select app.apply_tenant_conventions('app.manufacturer');

create table app.vendor (
  id            uuid primary key,
  tenant_id     uuid not null references app.tenant (id),
  name          text not null check (length(btrim(name)) between 1 and 200),
  contact_name  text,
  contact_email text,
  phone         text,
  url           text,
  address       text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  archived_at   timestamptz,
  version       integer not null default 1,
  unique (tenant_id, id)
);
create unique index vendor_name_uq on app.vendor (tenant_id, lower(name)) where archived_at is null;
select app.apply_tenant_conventions('app.vendor');

create table app.asset_model (
  id                          uuid primary key,
  tenant_id                   uuid not null references app.tenant (id),
  category_id                 uuid not null,
  category_kind               text not null default 'asset' check (category_kind = 'asset'),
  manufacturer_id             uuid,
  name                        text not null check (length(btrim(name)) between 1 and 200),
  model_number                text,
  default_depreciation_months integer check (default_depreciation_months is null or default_depreciation_months >= 0),
  eol_date                    date,
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  created_by                  uuid,
  updated_by                  uuid,
  archived_at                 timestamptz,
  version                     integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, id, category_id),                  -- asset pins its category to its model's category
  foreign key (tenant_id, category_id, category_kind) references app.category (tenant_id, id, kind),
  foreign key (tenant_id, manufacturer_id)            references app.manufacturer (tenant_id, id)
);
create unique index asset_model_name_uq on app.asset_model (tenant_id, manufacturer_id, lower(name), model_number)
  nulls not distinct where archived_at is null;
create index asset_model_category_idx on app.asset_model (tenant_id, category_id);
create index asset_model_manufacturer_idx on app.asset_model (tenant_id, manufacturer_id);
create index asset_model_name_trgm on app.asset_model using gin (tenant_id, name public.gin_trgm_ops);
select app.apply_tenant_conventions('app.asset_model');

-- Configurable label mapped to a fixed state type (plan 5.2: configurable labels, fixed state types).
-- 'undeployable' is an addition to the plan's five types so "in repair / broken" is expressible.
create table app.status_label (
  id              uuid primary key,
  tenant_id       uuid not null references app.tenant (id),
  name            text not null check (length(btrim(name)) between 1 and 100),
  state_type      text not null
                  check (state_type in ('deployable','deployed','pending','undeployable','archived','lost')),
  color           text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  description     text,
  position        integer not null default 0,
  is_default      boolean not null default false,       -- status given to newly created assets
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  archived_at     timestamptz,
  version         integer not null default 1,
  unique (tenant_id, id)
);
create unique index status_label_name_uq on app.status_label (tenant_id, lower(name)) where archived_at is null;
create unique index status_label_one_default_uq on app.status_label (tenant_id) where is_default and archived_at is null;
select app.apply_tenant_conventions('app.status_label');

-- Definition only; values live in asset.custom_data (JSONB) and are validated by the application.
-- category_id NULL = field applies to every asset category.
create table app.custom_field_def (
  id            uuid primary key,
  tenant_id     uuid not null references app.tenant (id),
  category_id   uuid,
  key           text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  label         text not null check (length(btrim(label)) between 1 and 100),
  data_type     text not null
                check (data_type in ('text','long_text','number','boolean','date','select','multiselect','url','email')),
  required      boolean not null default false,
  options       jsonb check (options is null or jsonb_typeof(options) = 'array'),      -- for select/multiselect
  validation    jsonb check (validation is null or jsonb_typeof(validation) = 'object'), -- {min,max,pattern,...}
  help_text     text,
  position      integer not null default 0,
  show_in_list  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  archived_at   timestamptz,
  version       integer not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references app.category (tenant_id, id),
  check (data_type not in ('select','multiselect') or options is not null)
);
create unique index custom_field_def_key_uq on app.custom_field_def (tenant_id, category_id, key)
  nulls not distinct where archived_at is null;
select app.apply_tenant_conventions('app.custom_field_def');

-- Per-tenant, per-prefix counters for generated asset tags (see app.next_asset_tag, 0005).
create table app.asset_tag_counter (
  tenant_id  uuid not null references app.tenant (id),
  prefix     text not null check (prefix ~ '^[A-Z0-9-]{0,12}$'),
  last_value bigint not null default 0 check (last_value >= 0),
  primary key (tenant_id, prefix)
);
select app.apply_tenant_conventions('app.asset_tag_counter');
