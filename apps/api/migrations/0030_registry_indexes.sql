-- 0030_registry_indexes [M1-REG-06, M1-REG-07, M1-REG-08]: supports the asset registry endpoints.
-- No new tables. Widens one check, adds stored lower-case key columns on app.asset and the indexes
-- the list, lookup and tag-numbering queries need (all lead with tenant_id).
--
-- WHY STORED KEY COLUMNS (finding of the M1-REG-07 performance work, see ADR 0005): the runtime role
-- is subject to row-level security, and PostgreSQL only uses a user predicate as an INDEX condition
-- when every function in it is LEAKPROOF (otherwise it could leak rows the policy hides through
-- error messages). `lower(...)`, `ILIKE`, `@@` and jsonb `@>` are NOT leakproof, so the expression
-- index `(tenant_id, lower(asset_tag))` and the trigram / full-text / jsonb GIN indexes of 0005 are
-- ignored for `WHERE lower(asset_tag) = ...` through RLS (verified with EXPLAIN: Seq/Bitmap scan of
-- the tenant plus a Filter). `=` on text, uuid, date and timestamptz IS leakproof, so equality on a
-- stored, already lower-cased column uses a plain btree: exact tag / serial lookups are O(log n).

-- Asset tag numbering (M1-REG-06): the counter row is keyed by the full tag prefix = tenant template
-- prefix (up to 12 characters) + category prefix (up to 12), so the key may be longer than the
-- category prefix alone that 0004 allowed.
alter table app.asset_tag_counter drop constraint asset_tag_counter_prefix_check;
alter table app.asset_tag_counter
  add constraint asset_tag_counter_prefix_check check (prefix ~ '^[A-Z0-9-]{0,24}$');

-- Lower-cased keys, maintained by the database (generated columns: no application code can forget
-- them). `search_text` joins tag, serial and name with an unlikely separator (chr(31)) so a search
-- cannot match across two fields; one `strpos` over it replaces three ILIKE predicates.
alter table app.asset
  add column asset_tag_key text generated always as (lower(asset_tag)) stored,
  add column serial_key    text generated always as (lower(serial)) stored,
  add column search_text   text generated always as (
    lower(asset_tag || chr(31) || coalesce(serial, '') || chr(31) || coalesce(name, ''))
  ) stored;

-- Tag uniqueness (ED-12: archived assets keep their tag) now rides on the stored key.
drop index app.asset_tag_uq;
create unique index asset_tag_uq on app.asset (tenant_id, asset_tag_key);
drop index app.asset_serial_idx;
-- (not partial: a partial index is only usable when the query repeats its predicate)
create index asset_serial_idx on app.asset (tenant_id, serial_key);

-- Default list order (`-created_at`, id) over active assets, served by one index scan: no sort.
create index asset_created_idx on app.asset (tenant_id, created_at desc, id desc) where archived_at is null;

-- The custom field lookups of an asset write / the category screen.
create index custom_field_def_category_idx on app.custom_field_def (tenant_id, category_id);
