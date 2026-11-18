-- 0030_registry_indexes [M1-REG-06, M1-REG-07, M1-REG-08]: supports the asset registry endpoints.
-- No new tables: the registry tables ship in 0004/0005. This migration only widens one check and
-- adds the indexes the list, search and tag-numbering queries need (all lead with tenant_id).

-- Asset tag numbering (M1-REG-06): the counter row is keyed by the full tag prefix = tenant template
-- prefix (up to 12 characters) + category prefix (up to 12), so the key may be longer than the
-- category prefix alone that 0004 allowed.
alter table app.asset_tag_counter drop constraint asset_tag_counter_prefix_check;
alter table app.asset_tag_counter
  add constraint asset_tag_counter_prefix_check check (prefix ~ '^[A-Z0-9-]{0,24}$');

-- Default list order (`-created_at`, id) over active assets, served by one index scan: no sort.
create index asset_created_idx on app.asset (tenant_id, created_at desc, id desc) where archived_at is null;

-- Full-text search over the free-text columns (M1-REG-08). The expression is mirrored exactly by
-- ASSET_FTS in src/registry/asset-queries.ts: change both together. Tag, serial and name are served
-- by the trigram indexes of 0005 (asset_tag_trgm, asset_serial_trgm, asset_name_trgm).
create index asset_fts_idx on app.asset using gin (
  tenant_id,
  (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(order_number, '') || ' ' || coalesce(notes, '')))
);

-- Model search by model number, and the custom field lookups of an asset write / category screen.
create index asset_model_number_trgm on app.asset_model using gin (tenant_id, model_number public.gin_trgm_ops)
  where model_number is not null;
create index custom_field_def_category_idx on app.custom_field_def (tenant_id, category_id);
