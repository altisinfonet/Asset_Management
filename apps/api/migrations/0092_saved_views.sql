-- 0092_saved_views [M2-REG-01]: server-side saved list views, private to their owner or shared with the
-- whole tenant (sharing needs the `view:share` permission). `filters`, `columns` and `sort` are what the
-- web list keeps; the server only bounds their size and checks the id references for warnings.
--
-- ADR 0005: the hot lookups are by stored lower-case key + btree equality, so the name is compared
-- through `name_key` (a stored generated column).

select app.create_tenant_table(
  'saved_view',
  $body$
    user_id     uuid not null,
    resource    text not null check (resource in ('assets')),
    name        text not null check (length(btrim(name)) between 1 and 100),
    name_key    text generated always as (lower(btrim(name))) stored,
    filters     jsonb not null default '{}'::jsonb
                check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 16384),
    columns     text[] not null default '{}' check (cardinality(columns) <= 40),
    sort        text check (sort is null or length(sort) <= 64),
    is_shared   boolean not null default false,
    foreign key (tenant_id, user_id) references app.user_account (tenant_id, id)
  $body$,
  'select, insert, update, delete'
);
-- A name is unique among one user's views of a list, and among the views shared tenant-wide.
create unique index saved_view_owner_name_uq on app.saved_view (tenant_id, user_id, resource, name_key);
create unique index saved_view_shared_name_uq on app.saved_view (tenant_id, resource, name_key) where is_shared;
