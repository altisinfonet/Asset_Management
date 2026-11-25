-- 0150_location_scoping [M2-LOC-03; ED-26]: location scoping of role assignments.
-- Scope is enforced in the application layer (ED-07 / ED-26: RLS stays tenant-only). A scoped request
-- filters with `location_id IN (<ids of the subtree>)`, plain uuid equality that is leakproof and can use a
-- btree under RLS (ADR 0005). Every scoped table already has a tenant-led index on its location column
-- (asset, accessory, consumable, person since 0040, loaner pool), so no index is added here.
-- Exports and imports run in the worker, after the request: the scope of the requester is stored on the
-- job (`location_scoped`, and the root location ids of the subtrees in `location_scope`), so the worker
-- applies exactly the scope the request had. Unscoped jobs keep the defaults (false, empty).
-- Migration range 0150-0159 belongs to this change.

alter table app.export_job
  add column location_scoped boolean not null default false,
  add column location_scope uuid[] not null default '{}'::uuid[];
alter table app.import_job
  add column location_scoped boolean not null default false,
  add column location_scope uuid[] not null default '{}'::uuid[];
