-- negative control: add a grant on an asset_history partition, as the owner; lint must flag it and the per-partition policy must still scope the read
SET ROLE app_owner;
SELECT 'app.asset_history_' || to_char(now(), 'YYYY_MM') AS hpart \gset
GRANT SELECT ON TABLE :hpart TO app_user;
SELECT 'schema_lint reports: ' || violation FROM app.schema_lint();
RESET ROLE;
BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('app.tenant_id', 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', true);
SELECT 'direct partition read as tenant A with the (mistaken) grant: rows=' || count(*) || ' tenants=' || count(DISTINCT tenant_id) AS res FROM :hpart;
COMMIT;
SET ROLE app_owner;
REVOKE SELECT ON TABLE :hpart FROM app_user;
SELECT 'after revoke, schema_lint violations=' || count(*) FROM app.schema_lint();
