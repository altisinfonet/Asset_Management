-- fresh connection, no tenant ever set (GUC undefined -> NULL)
SELECT tt.ok('T2a fresh connection, no tenant: asset rows', tt.n('SELECT count(*) FROM app.asset') = 0, 'count=' || tt.n('SELECT count(*) FROM app.asset'));
SELECT tt.ok('T2b fresh connection, no tenant: tenant/audit rows', tt.n('SELECT count(*) FROM app.tenant') = 0 AND tt.n('SELECT count(*) FROM app.audit_log') = 0, '');
SELECT tt.err('T2c fresh connection, no tenant: INSERT fails', $$INSERT INTO app.category (id, tenant_id, name) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','X')$$, '42501');
SELECT tt.ok('T2g fresh connection, no tenant: asset_history 0 rows', tt.n('SELECT count(*) FROM app.asset_history') = 0, '');
SELECT tt.ok('T7a identity lookup works with no tenant (pre-auth)', tt.n($$SELECT count(*) FROM identity.tenant_directory WHERE slug IN ('tenant-a','tenant-b')$$) = 2, '');
