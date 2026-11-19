\set A 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
\set B 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'

-- ---------------------------------------------------------------- T1 isolation
BEGIN;
SELECT set_config('app.tenant_id', :'A', true);
SELECT tt.ok('T1a tenant A sees its 2 assets', tt.n('SELECT count(*) FROM app.asset') = 2, 'count=' || tt.n('SELECT count(*) FROM app.asset'));
SELECT tt.ok('T1b tenant A cannot see B rows (asset/category/location/person/audit)',
  tt.n($$SELECT count(*) FROM app.asset WHERE tenant_id = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'$$) = 0
  AND tt.n($$SELECT count(*) FROM app.category WHERE id = 'b1000000-0000-7000-8000-000000000001'$$) = 0
  AND tt.n($$SELECT count(*) FROM app.location WHERE id = 'b3000000-0000-7000-8000-000000000001'$$) = 0
  AND tt.n($$SELECT count(*) FROM app.person WHERE id = 'b4000000-0000-7000-8000-000000000001'$$) = 0
  AND tt.n($$SELECT count(*) FROM app.audit_log WHERE tenant_id = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'$$) = 0, '');
SELECT tt.ok('T1c tenant A sees only its own tenant row', tt.n('SELECT count(*) FROM app.tenant') = 1, '');
SELECT tt.ok('T1d tenant A: by-id read of B asset returns 0 rows', tt.n($$SELECT count(*) FROM app.asset WHERE id = 'b5000000-0000-7000-8000-000000000001'$$) = 0, '');
COMMIT;
BEGIN;
SELECT set_config('app.tenant_id', :'B', true);
SELECT tt.ok('T1e tenant B sees exactly its 1 asset', tt.n('SELECT count(*) FROM app.asset') = 1, 'count=' || tt.n('SELECT count(*) FROM app.asset'));
COMMIT;

-- ---------------------------------------------------------------- T2 unset tenant on a USED connection ('' not NULL)
SELECT tt.ok('T2d used connection after tenant tx: GUC is empty string', coalesce(current_setting('app.tenant_id', true), 'NULL') = '', 'guc=[' || coalesce(current_setting('app.tenant_id', true), 'NULL') || ']');
SELECT tt.ok('T2e used connection, no tenant: 0 rows and NO 22P02 error', tt.n('SELECT count(*) FROM app.asset') = 0, '');
SELECT tt.err('T2f used connection, no tenant: INSERT fails with 42501 (not 22P02)', $$INSERT INTO app.category (id, tenant_id, name) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','X')$$, '42501');

-- ---------------------------------------------------------------- T3 WITH CHECK
BEGIN;
SELECT set_config('app.tenant_id', :'A', true);
SELECT tt.err('T3a A inserts a row stamped with tenant B', $$INSERT INTO app.category (id, tenant_id, name) VALUES (gen_random_uuid(), 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb','Evil')$$, '42501');
SELECT tt.err('T3b A re-stamps its own row to tenant B', $$UPDATE app.manufacturer SET tenant_id = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb' WHERE name = 'Dell'$$, '42501');
SELECT tt.ok('T3c A cannot update B rows (0 rows affected)',
  tt.n($$WITH u AS (UPDATE app.asset SET name = 'pwned' WHERE id = 'b5000000-0000-7000-8000-000000000001' RETURNING 1) SELECT count(*) FROM u$$) = 0, '');
COMMIT;

-- ---------------------------------------------------------------- T4 composite FK blocks cross-tenant references
BEGIN;
SELECT set_config('app.tenant_id', :'A', true);
SELECT tt.err('T4a asset(A) -> category of B', $$INSERT INTO app.asset (id, tenant_id, asset_tag, category_id, status_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','X-1','b1000000-0000-7000-8000-000000000001',(SELECT id FROM app.status_label WHERE is_default))$$, '23503');
SELECT tt.err('T4b asset(A) -> model of B', $$INSERT INTO app.asset (id, tenant_id, asset_tag, category_id, model_id, status_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','X-2','a1000000-0000-7000-8000-000000000001','b2000000-0000-7000-8000-000000000001',(SELECT id FROM app.status_label WHERE is_default))$$, '23503');
SELECT tt.err('T4c asset(A) -> location of B', $$INSERT INTO app.asset (id, tenant_id, asset_tag, category_id, status_id, location_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','X-3','a1000000-0000-7000-8000-000000000001',(SELECT id FROM app.status_label WHERE is_default),'b3000000-0000-7000-8000-000000000001')$$, '23503');
SELECT tt.err('T4d assignment(A) -> person of B', $$INSERT INTO app.assignment (id, tenant_id, asset_id, person_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a5000000-0000-7000-8000-000000000001','b4000000-0000-7000-8000-000000000001')$$, '23503');
SELECT tt.err('T4e assignment(A) -> asset of B', $$INSERT INTO app.assignment (id, tenant_id, asset_id, person_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','b5000000-0000-7000-8000-000000000001','a4000000-0000-7000-8000-000000000001')$$, '23503');
SELECT tt.err('T4f location(A) -> parent location of B', $$INSERT INTO app.location (id, tenant_id, parent_id, name) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','b3000000-0000-7000-8000-000000000001','Leak')$$, '23503');
SELECT tt.err('T4g asset(A) -> model of A but wrong category (model pins category)', $$INSERT INTO app.asset (id, tenant_id, asset_tag, category_id, model_id, status_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','X-4','a1000000-0000-7000-8000-000000000004','a2000000-0000-7000-8000-000000000001',(SELECT id FROM app.status_label WHERE is_default))$$, '23503');
SELECT tt.err('T4h accessory(A) in an asset-kind category (category kind pinned)', $$INSERT INTO app.accessory (id, tenant_id, category_id, name) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a1000000-0000-7000-8000-000000000001','Bad')$$, '23503');
COMMIT;

-- ---------------------------------------------------------------- T5 audit_log partitions
SELECT 'app.audit_log_' || to_char(now(), 'YYYY_MM') AS part \gset
BEGIN;
SELECT set_config('app.tenant_id', :'A', true);
SELECT tt.ok('T5a audit_log via parent: A sees only its 2 rows', tt.n('SELECT count(*) FROM app.audit_log') = 2, 'count=' || tt.n('SELECT count(*) FROM app.audit_log'));
SELECT tt.ok('T5b insert through parent routes to partition (app_user has no grant on it)', tt.n($$WITH i AS (INSERT INTO app.audit_log (id, tenant_id, actor_type, action, entity_type) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','system','t5.insert','test') RETURNING 1) SELECT count(*) FROM i$$) = 1, '');
SELECT tt.err('T5c direct SELECT on current-month partition is denied', 'SELECT count(*) FROM ' || :'part', '42501');
SELECT tt.err('T5d direct SELECT on default partition is denied', 'SELECT count(*) FROM app.audit_log_default', '42501');
SELECT tt.err('T5e direct INSERT into a partition is denied', 'INSERT INTO ' || :'part' || $$ (tenant_id, actor_type, action, entity_type) VALUES ('aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','system','x','y')$$, '42501');
SELECT tt.err('T5f UPDATE on audit_log (append-only) is denied', $$UPDATE app.audit_log SET action = 'tamper'$$, '42501');
SELECT tt.err('T5g DELETE on audit_log (append-only) is denied', 'DELETE FROM app.audit_log', '42501');
SELECT tt.err('T5h WITH CHECK on audit_log insert for tenant B', $$INSERT INTO app.audit_log (id, tenant_id, actor_type, action, entity_type) VALUES (gen_random_uuid(), 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb','system','x','y')$$, '42501');
COMMIT;
SELECT tt.ok('T5i app_user holds no privilege on any partition (has_table_privilege)',
  NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relispartition AND c.relnamespace = 'app'::regnamespace AND has_table_privilege('app_user', c.oid, 'SELECT,INSERT,UPDATE,DELETE')), 'partitions=' || (SELECT count(*) FROM pg_class c WHERE c.relispartition AND c.relnamespace = 'app'::regnamespace));

-- ---------------------------------------------------------------- T20 asset_history partitions (ED-09), same rules as audit_log
SELECT 'app.asset_history_' || to_char(now(), 'YYYY_MM') AS hpart \gset
SELECT tt.ok('T20z asset_history is a partitioned table with 12 monthly partitions + default',
  (SELECT relkind FROM pg_class WHERE oid = 'app.asset_history'::regclass) = 'p'
  AND (SELECT count(*) FROM pg_inherits WHERE inhparent = 'app.asset_history'::regclass) = 13
  AND to_regclass('app.asset_history_default') IS NOT NULL, 'partitions=' || (SELECT count(*) FROM pg_inherits WHERE inhparent = 'app.asset_history'::regclass));
BEGIN;
SELECT set_config('app.tenant_id', :'A', true);
SELECT tt.ok('T20a asset_history via parent: A sees only its 2 rows', tt.n('SELECT count(*) FROM app.asset_history') = 2 AND tt.n($$SELECT count(*) FROM app.asset_history WHERE tenant_id = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'$$) = 0, 'count=' || tt.n('SELECT count(*) FROM app.asset_history'));
SELECT tt.ok('T20b insert through parent routes to the partition (app_user has no grant on it)', tt.n($$WITH i AS (INSERT INTO app.asset_history (id, tenant_id, asset_id, event_type) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', 'a5000000-0000-7000-8000-000000000001', 'updated') RETURNING 1) SELECT count(*) FROM i$$) = 1, '');
SELECT tt.err('T20c direct SELECT on current-month asset_history partition is denied', 'SELECT count(*) FROM ' || :'hpart', '42501');
SELECT tt.err('T20d direct SELECT on asset_history default partition is denied', 'SELECT count(*) FROM app.asset_history_default', '42501');
SELECT tt.err('T20e direct INSERT into an asset_history partition is denied', 'INSERT INTO ' || :'hpart' || $$ (id, tenant_id, asset_id, event_type) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', 'a5000000-0000-7000-8000-000000000001', 'updated')$$, '42501');
SELECT tt.err('T20f UPDATE on asset_history (append-only) is denied', $$UPDATE app.asset_history SET summary = 'tamper'$$, '42501');
SELECT tt.err('T20g DELETE on asset_history (append-only) is denied', 'DELETE FROM app.asset_history', '42501');
SELECT tt.err('T20h WITH CHECK on asset_history insert for tenant B', $$INSERT INTO app.asset_history (id, tenant_id, asset_id, event_type) VALUES (gen_random_uuid(), 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb', 'b5000000-0000-7000-8000-000000000001', 'updated')$$, '42501');
SELECT tt.err('T20i composite FK: asset_history(A) -> asset of B', $$INSERT INTO app.asset_history (id, tenant_id, asset_id, event_type) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', 'b5000000-0000-7000-8000-000000000001', 'updated')$$, '23503');
SELECT tt.err('T20j composite FK: asset_history(A) -> assignment of another tenant (random id)', $$INSERT INTO app.asset_history (id, tenant_id, asset_id, event_type, assignment_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', 'a5000000-0000-7000-8000-000000000001', 'checked_out', gen_random_uuid())$$, '23503');
COMMIT;
BEGIN;
SELECT set_config('app.tenant_id', :'B', true);
SELECT tt.ok('T20k tenant B sees exactly its 1 asset_history row', tt.n('SELECT count(*) FROM app.asset_history') = 1, 'count=' || tt.n('SELECT count(*) FROM app.asset_history'));
COMMIT;
SELECT tt.ok('T20l no tenant set: asset_history 0 rows', tt.n('SELECT count(*) FROM app.asset_history') = 0, '');
SELECT tt.ok('T20m every asset_history partition has FORCE RLS and the tenant policy',
  NOT EXISTS (SELECT 1 FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'app.asset_history'::regclass
              AND NOT (c.relrowsecurity AND c.relforcerowsecurity AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation'))), '');

-- ---------------------------------------------------------------- T21 no database-side uuidv7() defaults (PostgreSQL 16/17 compatibility, ED-08)
SELECT tt.ok('T21a no column default calls uuidv7() in app/identity', tt.n($$SELECT count(*) FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid WHERE c.relnamespace IN ('app'::regnamespace,'identity'::regnamespace) AND pg_get_expr(d.adbin, d.adrelid) LIKE '%uuidv7%'$$) = 0, 'server_version=' || current_setting('server_version'));
BEGIN;
SELECT set_config('app.tenant_id', :'A', true);
SELECT tt.err('T21b inserting without an id fails (NOT NULL; app must supply ids)', $$INSERT INTO app.audit_log (tenant_id, actor_type, action, entity_type) VALUES ('aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', 'system', 'x', 'y')$$, '23502');
COMMIT;

-- ---------------------------------------------------------------- T6 security_invoker views
BEGIN;
SELECT set_config('app.tenant_id', :'A', true);
SELECT tt.ok('T6a v_accessory_availability shows only A', tt.n('SELECT count(*) FROM app.v_accessory_availability') = 1 AND tt.n($$SELECT count(*) FROM app.v_accessory_availability WHERE tenant_id <> 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'$$) = 0, '');
SELECT tt.ok('T6b v_low_stock is empty for A (consumable 3 > min 2)', tt.n('SELECT count(*) FROM app.v_low_stock') = 0, '');
COMMIT;
SELECT tt.ok('T6c view with no tenant set returns 0 rows', tt.n('SELECT count(*) FROM app.v_accessory_availability') = 0, '');

-- ---------------------------------------------------------------- T8 domain constraints
BEGIN;
SELECT set_config('app.tenant_id', :'A', true);
SELECT tt.err('T8a assignment with two targets rejected', $$INSERT INTO app.assignment (id, tenant_id, asset_id, person_id, location_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a5000000-0000-7000-8000-000000000001','a4000000-0000-7000-8000-000000000001','a3000000-0000-7000-8000-000000000001')$$, '23514');
SELECT tt.err('T8b assignment with no target rejected', $$INSERT INTO app.assignment (id, tenant_id, asset_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a5000000-0000-7000-8000-000000000001')$$, '23514');
SELECT tt.err('T8c assignment of both asset and accessory rejected', $$INSERT INTO app.assignment (id, tenant_id, asset_id, accessory_id, person_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a5000000-0000-7000-8000-000000000001','a6000000-0000-7000-8000-000000000001','a4000000-0000-7000-8000-000000000001')$$, '23514');
INSERT INTO app.assignment (id, tenant_id, asset_id, person_id) VALUES ('a8000000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a5000000-0000-7000-8000-000000000001','a4000000-0000-7000-8000-000000000001');
SELECT tt.err('T8d second open checkout of the same asset rejected', $$INSERT INTO app.assignment (id, tenant_id, asset_id, location_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a5000000-0000-7000-8000-000000000001','a3000000-0000-7000-8000-000000000001')$$, '23505');
INSERT INTO app.loaner_pool (id, tenant_id, name) VALUES ('a9000000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','Pool');
SELECT tt.err('T8e loaner checkout without due date rejected', $$INSERT INTO app.assignment (id, tenant_id, asset_id, person_id, loaner_pool_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a5000000-0000-7000-8000-000000000002','a4000000-0000-7000-8000-000000000001','a9000000-0000-7000-8000-000000000001')$$, '23514');
UPDATE app.assignment SET checked_in_at = now() + interval '1 second', quantity_returned = 1 WHERE id = 'a8000000-0000-7000-8000-000000000001';
SELECT tt.ok('T8f check-in closes the period; asset can be checked out again', tt.n($$WITH i AS (INSERT INTO app.assignment (id, tenant_id, asset_id, location_id) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a5000000-0000-7000-8000-000000000001','a3000000-0000-7000-8000-000000000001') RETURNING 1) SELECT count(*) FROM i$$) = 1, '');
SELECT tt.ok('T8g accessory check-out within stock (qty_total=2, checking out 2)', tt.n($$WITH i AS (INSERT INTO app.assignment (id, tenant_id, accessory_id, person_id, quantity) VALUES ('a8000000-0000-7000-8000-000000000002', 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a6000000-0000-7000-8000-000000000001','a4000000-0000-7000-8000-000000000001',2) RETURNING 1) SELECT count(*) FROM i$$) = 1, '');
SELECT tt.err('T8h accessory over-checkout rejected (stock trigger)', $$INSERT INTO app.assignment (id, tenant_id, accessory_id, person_id, quantity) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a6000000-0000-7000-8000-000000000001','a4000000-0000-7000-8000-000000000001',1)$$, '23514');
SELECT tt.ok('T8i v_accessory_availability reflects it (available = 0)', tt.n('SELECT qty_available FROM app.v_accessory_availability') = 0, '');
INSERT INTO app.stock_movement (id, tenant_id, consumable_id, qty_delta, reason) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a7000000-0000-7000-8000-000000000001',-2,'issue');
SELECT tt.ok('T8j stock movement applied: qty_on_hand 3 -> 1, balance_after recorded', tt.n('SELECT qty_on_hand FROM app.consumable') = 1 AND tt.n('SELECT balance_after FROM app.stock_movement') = 1, '');
SELECT tt.ok('T8k v_low_stock now lists the consumable (1 <= min 2)', tt.n('SELECT count(*) FROM app.v_low_stock') = 1, '');
SELECT tt.err('T8l stock overdraw rejected (qty_on_hand >= 0)', $$INSERT INTO app.stock_movement (id, tenant_id, consumable_id, qty_delta, reason) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a7000000-0000-7000-8000-000000000001',-5,'issue')$$, '23514');
SELECT tt.err('T8m stock_movement is append-only (UPDATE denied)', $$UPDATE app.stock_movement SET qty_delta = 99$$, '42501');
-- ---------------------------------------------------------------- T19 accessory partial returns (quantity_returned, ED-11)
SELECT tt.ok('T19a before: accessory dock has 2 units out, open row, quantity_returned=0', tt.n($$SELECT quantity_returned FROM app.assignment WHERE id = 'a8000000-0000-7000-8000-000000000002' AND checked_in_at IS NULL$$) = 0, '');
UPDATE app.assignment SET quantity_returned = 1 WHERE id = 'a8000000-0000-7000-8000-000000000002';
SELECT tt.ok('T19b partial return of 1 of 2: row stays open, availability 0 -> 1',
  tt.n($$SELECT count(*) FROM app.assignment WHERE id = 'a8000000-0000-7000-8000-000000000002' AND checked_in_at IS NULL AND quantity_returned = 1$$) = 1
  AND tt.n('SELECT qty_available FROM app.v_accessory_availability') = 1, 'available=' || tt.n('SELECT qty_available FROM app.v_accessory_availability'));
SELECT tt.err('T19f INSERT with quantity_returned > quantity rejected', $$INSERT INTO app.assignment (id, tenant_id, accessory_id, person_id, quantity, quantity_returned) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', 'a6000000-0000-7000-8000-000000000001', 'a4000000-0000-7000-8000-000000000001', 1, 2)$$, '23514');
SELECT tt.ok('T19c freed unit can be checked out again (stock trigger counts quantity - quantity_returned)', tt.n($$WITH i AS (INSERT INTO app.assignment (id, tenant_id, accessory_id, person_id, quantity) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', 'a6000000-0000-7000-8000-000000000001', 'a4000000-0000-7000-8000-000000000001', 1) RETURNING 1) SELECT count(*) FROM i$$) = 1, '');
SELECT tt.err('T19d over-checkout still rejected after the partial return (2 total, 2 out)', $$INSERT INTO app.assignment (id, tenant_id, accessory_id, person_id, quantity) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', 'a6000000-0000-7000-8000-000000000001', 'a4000000-0000-7000-8000-000000000001', 1)$$, '23514');
SELECT tt.err('T19e quantity_returned cannot exceed quantity (UPDATE 3 > 2)', $$UPDATE app.assignment SET quantity_returned = 3 WHERE id = 'a8000000-0000-7000-8000-000000000002'$$, '23514');
SELECT tt.err('T19g fully returned but still open (quantity_returned = quantity, no checked_in_at) rejected', $$UPDATE app.assignment SET quantity_returned = 2 WHERE id = 'a8000000-0000-7000-8000-000000000002'$$, '23514');
SELECT tt.err('T19h closed while units are still out (checked_in_at with quantity_returned < quantity) rejected', $$UPDATE app.assignment SET checked_in_at = now() + interval '1 second' WHERE id = 'a8000000-0000-7000-8000-000000000002'$$, '23514');
SELECT tt.err('T19i quantity_returned cannot decrease', $$UPDATE app.assignment SET quantity_returned = 0 WHERE id = 'a8000000-0000-7000-8000-000000000002'$$, '23514');
SELECT tt.err('T19j quantity cannot change after check-out', $$UPDATE app.assignment SET quantity = 5 WHERE id = 'a8000000-0000-7000-8000-000000000002'$$, '23514');
SELECT tt.err('T19k asset assignment cannot be open with quantity_returned = 1', $$INSERT INTO app.assignment (id, tenant_id, asset_id, person_id, quantity_returned) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', 'a5000000-0000-7000-8000-000000000002', 'a4000000-0000-7000-8000-000000000001', 1)$$, '23514');
UPDATE app.assignment SET quantity_returned = 2, checked_in_at = now() + interval '1 second' WHERE id = 'a8000000-0000-7000-8000-000000000002';
SELECT tt.ok('T19l final return closes the row (quantity_returned = quantity, checked_in_at set); availability 1',
  tt.n($$SELECT count(*) FROM app.assignment WHERE id = 'a8000000-0000-7000-8000-000000000002' AND checked_in_at IS NOT NULL AND quantity_returned = quantity$$) = 1
  AND tt.n('SELECT qty_available FROM app.v_accessory_availability') = 1, '');
COMMIT;

BEGIN;
SELECT set_config('app.tenant_id', :'A', true);
SELECT tt.ok('T8n location path/depth: Room 101 has depth 2 and 3 ancestors',
  tt.n($$SELECT depth FROM app.location WHERE name = 'Room 101'$$) = 2 AND tt.n($$SELECT cardinality(ancestor_ids) FROM app.location WHERE name = 'Room 101'$$) = 3, '');
UPDATE app.location SET parent_id = 'a3000000-0000-7000-8000-000000000004' WHERE id = 'a3000000-0000-7000-8000-000000000002';
SELECT tt.ok('T8o moving Floor 1 under Annex re-parents Room 101 (root = Annex, depth 2, subtree(Annex) = 3 rows)',
  tt.n($$SELECT depth FROM app.location WHERE name = 'Room 101'$$) = 2
  AND tt.n($$SELECT count(*) FROM app.location WHERE name = 'Room 101' AND ancestor_ids[1] = 'a3000000-0000-7000-8000-000000000004'$$) = 1
  AND tt.n($$SELECT count(*) FROM app.location WHERE ancestor_ids @> ARRAY['a3000000-0000-7000-8000-000000000004'::uuid]$$) = 3, '');
SELECT tt.err('T8p location cycle (Annex under Room 101) rejected', $$UPDATE app.location SET parent_id = 'a3000000-0000-7000-8000-000000000003' WHERE id = 'a3000000-0000-7000-8000-000000000004'$$, '23514');
COMMIT;

-- ---------------------------------------------------------------- misc
BEGIN;
SELECT set_config('app.tenant_id', :'A', true);
SELECT tt.err('T10a attachment storage_key must carry the tenant prefix', $$INSERT INTO app.attachment (id, tenant_id, entity_type, entity_id, storage_key, filename, content_type, size_bytes) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','asset','a5000000-0000-7000-8000-000000000001','tenants/bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb/x.jpg','x.jpg','image/jpeg',10)$$, '23514');
SELECT tt.ok('T10b attachment with own tenant prefix accepted', tt.n($$WITH i AS (INSERT INTO app.attachment (id, tenant_id, entity_type, entity_id, storage_key, filename, content_type, size_bytes) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','asset','a5000000-0000-7000-8000-000000000001','tenants/aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa/x.jpg','x.jpg','image/jpeg',10) RETURNING 1) SELECT count(*) FROM i$$) = 1, '');
SELECT tt.err('T11 provision_tenant refuses a tenant id different from the transaction context', $$SELECT app.provision_tenant('cccccccc-cccc-7ccc-8ccc-cccccccccccc','C','tenant-c')$$, '42501');
SELECT app.next_asset_tag('LAP-') AS t1 \gset
SELECT app.next_asset_tag('LAP-') AS t2 \gset
SELECT tt.ok('T14 next_asset_tag generates sequential per-tenant tags', :'t1' = 'LAP-00001' AND :'t2' = 'LAP-00002', :'t1' || ', ' || :'t2');
UPDATE app.asset SET name = 'Laptop 1 (renamed)' WHERE id = 'a5000000-0000-7000-8000-000000000001';
SELECT tt.ok('T15 version bumps on update (ETag source)', tt.n($$SELECT version FROM app.asset WHERE id = 'a5000000-0000-7000-8000-000000000001'$$) = 2, 'version=' || tt.n($$SELECT version FROM app.asset WHERE id = 'a5000000-0000-7000-8000-000000000001'$$));
SELECT tt.ok('T16 default company filled by trigger on asset insert', tt.n($$SELECT count(*) FROM app.asset a JOIN app.company c ON c.id = a.company_id AND c.tenant_id = a.tenant_id AND c.is_default$$) = 2, '');
SELECT tt.ok('T17 seeds: 5 built-in roles, 7 status labels, 6 label templates',
  tt.n('SELECT count(*) FROM app.role WHERE is_builtin') = 5 AND tt.n('SELECT count(*) FROM app.status_label') = 7 AND tt.n('SELECT count(*) FROM app.label_template') = 6, '');
SELECT tt.err('T18 custom_field_def duplicate key in the same scope rejected', $$INSERT INTO app.custom_field_def (id, tenant_id, key, label, data_type) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','warranty_tier','W','text'); INSERT INTO app.custom_field_def (id, tenant_id, key, label, data_type) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','warranty_tier','W2','text')$$, '23505');
COMMIT;

-- ---------------------------------------------------------------- T9 app_user cannot do DDL / escalate
SELECT tt.err('T9a app_user cannot CREATE TABLE in schema app', 'CREATE TABLE app.evil (x int)', '42501');
SELECT tt.err('T9b app_user cannot CREATE TABLE in public', 'CREATE TABLE public.evil (x int)', '42501');
SELECT tt.err('T9c app_user cannot DISABLE RLS (not owner)', 'ALTER TABLE app.asset DISABLE ROW LEVEL SECURITY', '42501');
SELECT tt.err('T9d app_user cannot NO FORCE RLS (not owner)', 'ALTER TABLE app.asset NO FORCE ROW LEVEL SECURITY', '42501');
SELECT tt.err('T9e app_user cannot call ensure_partitions', $$SELECT app.ensure_partitions(current_date, 1)$$, '42501');
SELECT tt.err('T9f app_user cannot SET ROLE app_owner', 'SET ROLE app_owner', '42501');
SELECT tt.ok('T9g app_user: not superuser, no BYPASSRLS, owns nothing in app/identity',
  (SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = current_user)
  AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AND c.relnamespace IN ('app'::regnamespace,'identity'::regnamespace)), 'current_user=' || current_user);

-- ---------------------------------------------------------------- T13 schema lint
SELECT tt.ok('T13 app.schema_lint() returns no violations', tt.n('SELECT count(*) FROM app.schema_lint()') = 0, 'violations=' || tt.n('SELECT count(*) FROM app.schema_lint()'));
