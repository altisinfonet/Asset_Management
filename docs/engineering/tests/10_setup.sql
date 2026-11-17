\set ON_ERROR_STOP on
-- tenant A: provisioned by app_user itself (signup path), then fixtures
BEGIN;
SELECT set_config('app.tenant_id', 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', true);
SELECT app.provision_tenant('aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', 'Tenant A', 'tenant-a');
INSERT INTO app.category (id, tenant_id, name, kind) VALUES
 ('a1000000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','Laptop','asset'),
 ('a1000000-0000-7000-8000-000000000002','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','Dock','accessory'),
 ('a1000000-0000-7000-8000-000000000003','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','Toner','consumable'),
 ('a1000000-0000-7000-8000-000000000004','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','Projector','asset');
INSERT INTO app.manufacturer (id, tenant_id, name) VALUES ('a1100000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','Dell');
INSERT INTO app.asset_model (id, tenant_id, category_id, manufacturer_id, name, model_number) VALUES
 ('a2000000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a1000000-0000-7000-8000-000000000001','a1100000-0000-7000-8000-000000000001','Latitude 7440','7440');
INSERT INTO app.location (id, tenant_id, parent_id, name, kind) VALUES
 ('a3000000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',NULL,'HQ','site'),
 ('a3000000-0000-7000-8000-000000000002','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a3000000-0000-7000-8000-000000000001','Floor 1','floor'),
 ('a3000000-0000-7000-8000-000000000003','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a3000000-0000-7000-8000-000000000002','Room 101','room'),
 ('a3000000-0000-7000-8000-000000000004','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',NULL,'Annex','site');
INSERT INTO app.person (id, tenant_id, display_name, email, kind) VALUES
 ('a4000000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','Alice Adams','alice@a.test','employee');
INSERT INTO app.asset (id, tenant_id, asset_tag, name, serial, category_id, model_id, status_id, location_id) VALUES
 ('a5000000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','A-0001','Laptop 1','SN-A1','a1000000-0000-7000-8000-000000000001','a2000000-0000-7000-8000-000000000001',(SELECT id FROM app.status_label WHERE name='Ready to deploy'),'a3000000-0000-7000-8000-000000000003'),
 ('a5000000-0000-7000-8000-000000000002','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','A-0002','Laptop 2','SN-A2','a1000000-0000-7000-8000-000000000001',NULL,(SELECT id FROM app.status_label WHERE name='Ready to deploy'),NULL);
INSERT INTO app.accessory (id, tenant_id, category_id, name, qty_total) VALUES
 ('a6000000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a1000000-0000-7000-8000-000000000002','USB-C dock',2);
INSERT INTO app.consumable (id, tenant_id, category_id, name, qty_on_hand, min_qty) VALUES
 ('a7000000-0000-7000-8000-000000000001','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','a1000000-0000-7000-8000-000000000003','Toner 55A',3,2);
INSERT INTO app.audit_log (id, tenant_id, actor_type, action, entity_type, entity_id) VALUES
 (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','user','asset.create','asset','a5000000-0000-7000-8000-000000000001'),
 (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','user','asset.update','asset','a5000000-0000-7000-8000-000000000001');
INSERT INTO app.asset_history (id, tenant_id, asset_id, event_type, summary) VALUES
 (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', 'a5000000-0000-7000-8000-000000000001', 'created', 'seed 1'),
 (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', 'a5000000-0000-7000-8000-000000000001', 'updated', 'seed 2');
COMMIT;

-- tenant B
BEGIN;
SELECT set_config('app.tenant_id', 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb', true);
SELECT app.provision_tenant('bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb', 'Tenant B', 'tenant-b');
INSERT INTO app.category (id, tenant_id, name, kind) VALUES
 ('b1000000-0000-7000-8000-000000000001','bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb','Laptop','asset');
INSERT INTO app.asset_model (id, tenant_id, category_id, name) VALUES
 ('b2000000-0000-7000-8000-000000000001','bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb','b1000000-0000-7000-8000-000000000001','ThinkPad');
INSERT INTO app.location (id, tenant_id, name, kind) VALUES
 ('b3000000-0000-7000-8000-000000000001','bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb','B HQ','site');
INSERT INTO app.person (id, tenant_id, display_name) VALUES
 ('b4000000-0000-7000-8000-000000000001','bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb','Bob Brown');
INSERT INTO app.asset (id, tenant_id, asset_tag, name, category_id, status_id) VALUES
 ('b5000000-0000-7000-8000-000000000001','bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb','B-0001','B Laptop','b1000000-0000-7000-8000-000000000001',(SELECT id FROM app.status_label WHERE name='Ready to deploy'));
INSERT INTO app.audit_log (id, tenant_id, actor_type, action, entity_type) VALUES
 (gen_random_uuid(), 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb','user','asset.create','asset');
INSERT INTO app.asset_history (id, tenant_id, asset_id, event_type, summary) VALUES
 (gen_random_uuid(), 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb', 'b5000000-0000-7000-8000-000000000001', 'created', 'seed B');
COMMIT;
\echo setup complete
