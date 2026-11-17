-- 0001_init: baseline. Intentionally empty (M1 scaffold, no business schema yet).
-- Roles (migrator, app) and extensions (pg_trgm) are created by docker/postgres/init/.
-- Conventions for later migrations: tenant tables carry tenant_id + RLS policy (WITH CHECK) +
-- FORCE, views are security_invoker, expand/contract only. See docs/03_system_architecture.md 8.5.
select 1;
