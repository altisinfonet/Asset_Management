# RLS + PgBouncer + pg-boss spike (2026-11-17)

Throwaway spike preserved for reference. Results and findings: [docs/validation/spike_rls_pgbouncer.md](../../docs/validation/spike_rls_pgbouncer.md).
Credentials in these files are local throwaway test values, not secrets.

Run: `docker compose -p atspike up -d`, then `cd node && npm ci && node rls_test.mjs`. Tear down with `docker compose -p atspike down -v`.
