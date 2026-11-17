-- connected as app_owner (migrator): FORCE RLS must bind it
SELECT tt.ok('T12a owner, no tenant set: 0 rows (FORCE RLS)', tt.n('SELECT count(*) FROM app.asset') = 0, 'current_user=' || current_user);
BEGIN;
SELECT set_config('app.tenant_id', 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', true);
SELECT tt.ok('T12b owner with tenant A set sees only A rows', tt.n('SELECT count(*) FROM app.asset') = 2 AND tt.n($$SELECT count(*) FROM app.asset WHERE tenant_id <> 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'$$) = 0, '');
COMMIT;
SELECT tt.ok('T12c owner role: not superuser, no BYPASSRLS', (SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = current_user), '');
-- partition factory (owner only): idempotent for existing months, creates new months for BOTH partitioned tables
SELECT tt.ok('T22a ensure_partitions is a no-op for the installed 12 months', app.ensure_partitions(current_date, 12) = 0, '');
SELECT app.ensure_partitions((current_date + interval '30 months')::date, 1) AS created \gset
SELECT tt.ok('T22b ensure_partitions creates one new partition for audit_log and one for asset_history', :created = 2, 'created=' || :created);
SELECT tt.ok('T22c new partitions carry FORCE RLS + policy and no grants (schema_lint clean)', tt.n('SELECT count(*) FROM app.schema_lint()') = 0, 'violations=' || tt.n('SELECT count(*) FROM app.schema_lint()'));
