-- 0009_readiness_ledger_grant [M1-PLAT-01]: GET /readyz must verify "migrations current" as the runtime
-- role. The ledger lives in schema public (created by the runner, owned by app_owner); app_user may
-- read only the migration ids (not the checksums), nothing else, and cannot write.

grant select (id) on public.schema_migrations to app_user;
