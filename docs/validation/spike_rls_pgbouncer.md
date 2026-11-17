# Spike: Postgres RLS tenant isolation through PgBouncer (transaction mode) and pg-boss

Date: 2026-11-17. Validates the riskiest multi-tenancy assumption in `03_system_architecture.md` section 5 (A1, A6, 5.3) and `02_product_plan.md` 6.1 (RLS pitfalls): tenant isolation holds through PgBouncer transaction pooling, and pg-boss works through the pooler.

**Verdict: the assumption holds.** All 9 isolation tests plus the extra prepared-statement test PASS on PostgreSQL 18.7 and 16.16, both direct and through PgBouncer 1.26.1 in transaction mode. pg-boss runs through the pooler (100/100 jobs, zero RLS violations) with LISTEN/NOTIFY left off. Five findings need changes to the architecture or plan (section "Changes the architecture should make"). Two are real hazards found by the spike: the empty-string GUC behaviour (the policy as written errors instead of returning zero rows after a connection has been used), and direct partition access bypassing the parent policy.

## 1. Versions

| Component | Version |
|---|---|
| PostgreSQL (primary run) | 18.7 (`postgres:18`, Debian 18.7-1.pgdg13+2) |
| PostgreSQL (repeat run) | 16.16 (`postgres:16`, Debian 16.16-1.pgdg13+1) |
| PgBouncer | 1.26.1, libevent 2.1.13, OpenSSL 3.5.8 (`edoburu/pgbouncer:latest`, image id `8638aa563607`) |
| pg-boss | 12.38.2 (latest on npm at spike time; requires Node >= 22.12, PostgreSQL >= 13) |
| node-postgres (`pg`) | 8.23.1 |
| Node.js / npm | v24.19.0 / 11.17.0 |
| Docker engine / Compose | 28.5.1 / v2.40.2-desktop.1 (Docker Desktop, Windows Server 2022; Docker Desktop had to be started first, the daemon was stopped) |

PostgreSQL 16 is what the architecture currently pins (section 8.2). Everything below passed identically on 16 and 18, so the PostgreSQL major is not a risk for this assumption.

## 2. Setup

All files live in the session scratchpad (`...\scratchpad\spike_rls\`): `docker-compose.yml`, `pgbouncer.ini`, `userlist.txt`, `init/01_schema.sql`, `node/rls_test.mjs`, `node/boss_test.mjs`, `node/notify_probe.mjs`, `node/prep_probe.mjs`, and raw outputs `node/out_*.txt` and `results_*.json`. Nothing was created in the repository except this report.

Compose file (project name `atspike`, `atspike16` for the 16 run; ports 55432 Postgres, 56432 PgBouncer):

```yaml
name: ${SPIKE_PROJECT:-atspike}
services:
  postgres:
    image: postgres:${PGVER:-18}
    container_name: ${SPIKE_PROJECT:-atspike}-pg
    environment: { POSTGRES_PASSWORD: superpw, POSTGRES_DB: spike }
    volumes: ["./init:/docker-entrypoint-initdb.d:ro"]
    ports: ["${PG_PORT:-55432}:5432"]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres -d spike"], interval: 2s, retries: 30 }
  pgbouncer:
    image: edoburu/pgbouncer:latest
    container_name: ${SPIKE_PROJECT:-atspike}-pgb
    entrypoint: ["pgbouncer", "/etc/pgbouncer/pgbouncer.ini"]
    volumes: ["./pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro", "./userlist.txt:/etc/pgbouncer/userlist.txt:ro"]
    ports: ["${PGB_PORT:-56432}:6432"]
    depends_on: { postgres: { condition: service_healthy } }
```

`pgbouncer.ini` (relevant part; `spike_one` is an alias with `pool_size=1` used only to make the negative control deterministic):

```ini
[databases]
spike     = host=postgres port=5432 dbname=spike
spike_one = host=postgres port=5432 dbname=spike pool_size=1
[pgbouncer]
auth_type = scram-sha-256
pool_mode = transaction
max_prepared_statements = 100
default_pool_size = 4
max_client_conn = 500
server_reset_query =
ignore_startup_parameters = extra_float_digits,options
```

Roles and policies (`init/01_schema.sql`, objects created as `app_owner`):

```sql
CREATE ROLE app_owner LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE app_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
ALTER ROLE app_user LOGIN PASSWORD '...';

CREATE TABLE asset (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, name text NOT NULL);
ALTER TABLE asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON asset
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- hardened variant (recommended, see finding F1)
CREATE POLICY tenant_isolation ON asset_nullif
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE audit_log (id bigint GENERATED ALWAYS AS IDENTITY, tenant_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(), action text NOT NULL, PRIMARY KEY (id, at)) PARTITION BY RANGE (at);
CREATE TABLE audit_log_2026_11 PARTITION OF audit_log FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');  -- + 2026_12, default
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;  ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log USING (...same...) WITH CHECK (...same...);   -- policy on parent only

CREATE VIEW asset_v_invoker WITH (security_invoker = true) AS SELECT id, tenant_id, name FROM asset;
CREATE VIEW asset_v_definer AS SELECT id, tenant_id, name FROM asset;                    -- default, owner rights
-- plus asset_noforce (ENABLE only, no FORCE) with noforce_v_definer / noforce_v_invoker views
```

Application access pattern used by every test (the `withTenantTx` rule):

```js
await c.query('BEGIN')
await c.query("select set_config('app.tenant_id', $1, true)", [tenant])   // true = transaction-local
... queries ...
await c.query('COMMIT')   // ROLLBACK on error
```

Test connections go through PgBouncer as `app_user` with a node pool of 10 (PgBouncer `default_pool_size=4`, so clients are multiplexed over 4 server connections).

## 3. Results: isolation tests

| # | Test | PG 18 via PgBouncer | PG 16 via PgBouncer | PG 18 direct | PG 16 direct |
|---|---|---|---|---|---|
| a | Tenant A sees only A, B only B (`set_config(..., true)` in tx) | PASS | PASS | PASS | PASS |
| b | Unset tenant: 0 rows, inserts fail (fail closed) | PASS | PASS | PASS | PASS |
| b3 | Gotcha: previously-used connection gives `''` not NULL (policy as written errors; NULLIF variant returns 0 rows) | PASS (hazard confirmed) | PASS | PASS | PASS |
| c | 600 interleaved concurrent txs, 2 tenants: zero cross-tenant reads; no GUC outside tx | PASS | PASS | PASS | PASS |
| d | Negative control: session `SET` leaks across pooled clients | PASS (leak demonstrated) | PASS | N/A | N/A |
| e | WITH CHECK blocks inserting/updating a row for another tenant | PASS | PASS | PASS | PASS |
| f | `security_invoker` view respects RLS; definer view bypasses on a non-FORCE table | PASS | PASS | PASS | PASS |
| g | Partition: parent policy via parent vs direct partition access | PASS (direct access **leaks**, see below) | PASS | PASS | PASS |
| h | `app_owner` without FORCE bypasses; with FORCE restricted | PASS | PASS | PASS | PASS |
| i | Extra: named prepared statements survive transaction pooling | PASS | PASS | PASS | PASS |

PASS means the test asserted the documented behaviour, including the tests (d, f, g) whose purpose is to demonstrate a bypass or leak.

### Actual output (PG 18.7 + PgBouncer 1.26.1; PG 16 output is equivalent)

**a**
```
A: 5 rows, distinct tenant_ids=aaaaaaaa-...   B: 5 rows, distinct tenant_ids=bbbbbbbb-...
```

**b / b3 (fail closed, and the empty-string gotcha)**
```
b1 fresh direct backend (GUC never defined): count=0 guc=null
b1 insert with unset tenant -> 42501 new row violates row-level security policy for table "asset"
b2 pooled tx, no set_config: ERROR 22P02 invalid input syntax for type uuid: ""
outside any tx, after earlier tenant tx: guc="" (empty string, not NULL)
policy as specified  (current_setting(..., true)::uuid)              -> ERROR 22P02 invalid input syntax for type uuid: ""
NULLIF variant       (NULLIF(current_setting(..., true), '')::uuid)  -> count=0
NULLIF variant insert with unset tenant -> 42501 new row violates row-level security policy
```
The policy as written is still fail-closed (no rows returned), but on any connection that has previously served a tenant transaction it raises 22P02 instead of returning 0 rows. Only a never-used backend returns 0 rows. After the first tenant transaction on a connection the custom GUC stays defined as `''` for the rest of the session.

**c (leak test)**
```
txs completed=600, cross-tenant/row-count violations=0, wrong-GUC-in-tx=0, intended failures rolled back=36
distinct server backend PIDs used by the 600 txs: 4 (pgbouncer default_pool_size=4; node pool max=10 clients)
80 autocommit queries outside any tx across 4 backends: observed GUC values="" leaked=0
select from asset_nullif outside any tx -> 0
SHOW POOLS (spike/app_user): cl_active=10 cl_waiting=0 sv_active=0 sv_idle=4 pool_mode=transaction
```
600 transactions (random 0 to 15 ms sleeps between statements to force interleaving; every 17th deliberately failed a WITH CHECK and rolled back) multiplexed 10 clients over 4 server connections. The run through direct Postgres used 10 backends and also passed.

**d (negative control)**
```
client1 did session SET to tenant A (backend 351); DIFFERENT client2 now sees backend=351 guc=aaaaaaaa-... rows=5 tenants=aaaaaaaa-...
=> LEAK CONFIRMED: client2 never set a tenant but reads tenant A data.
contrast: tx-local set_config then COMMIT -> other client sees guc=""
```
With `server_reset_query` empty (transaction mode never runs it) a session-level `SET` is inherited by whichever client receives that server connection next. This confirms why the "no session state, ever" rule (A6) is load-bearing.

**e**
```
tenant A inserts row with tenant_id=B -> 42501 new row violates row-level security policy for table "asset"
tenant A updates own rows to tenant_id=B -> 42501 new row violates row-level security policy for table "asset"
tenant A update/delete targeting B's rows: rowCount update=0 delete=0
```

**f**
```
FORCE table  : asset_v_invoker (security_invoker=true) as A: rows=5 tenants=1
FORCE table  : asset_v_definer (default, owner=app_owner) as A: rows=5 tenants=1   <- FORCE RLS still applies to the view owner
NO-FORCE tbl : noforce_v_invoker as A: rows=5 tenants=1
NO-FORCE tbl : noforce_v_definer as A: rows=10 tenants=2   <- BYPASS (owner rights, no FORCE)
```
A default view owned by `app_owner` bypasses RLS only when the underlying table lacks FORCE. With FORCE, the view owner is itself subject to the policy, so FORCE is also the backstop against a forgotten `security_invoker`.

**g (partitions)**
```
as tenant A, via parent audit_log: 2 rows ["login","create"]  (A owns 2 of 4 rows)
relrowsecurity/force: audit_log=true/true, audit_log_2026_11=false/false, audit_log_2026_12=false/false, audit_log_default=false/false
as tenant A, DIRECT audit_log_2026_11 (app_user has table privilege on partition): 3 rows, tenants=aaaa,bbbb
as tenant A, DIRECT audit_log_2026_12: 1 rows, tenants=bbbb
=> direct partition access BYPASSES parent policy (leak) when app_user has privileges on the partition
mitigation: REVOKE on partitions -> direct partition read: 42501 permission denied for table audit_log_2026_11
mitigation: via parent still works with only parent privileges: select=2 rows, insert routed to partition ok
mitigation 2: policy on the partition itself + privilege granted -> direct read as A: 2 rows, only A=true
```
Actual behaviour: RLS applies when querying through the parent, using the parent's policies. A query naming a partition directly uses only that partition's own RLS state (disabled by default), so it returns every tenant's rows if the role holds privileges on the partition. Privileges are checked on the parent only for queries through the parent, so granting `app_user` privileges on the parent alone is enough for select, insert (including tuple routing) and the monthly partition rotation to keep working. This is the PostgreSQL-documented behaviour; the spike confirms it on 16 and 18.

**h**
```
app_owner, no tenant set: asset_noforce (ENABLE only) -> 10 rows (BYPASS); asset (FORCE) -> 0 rows
app_owner with tenant A set: asset (FORCE) -> 5 rows; asset_noforce -> 10 rows
after ALTER TABLE asset_noforce FORCE ROW LEVEL SECURITY (same tx): 5 rows
superuser postgres on FORCE table with no tenant: 10 rows (superuser/BYPASSRLS ignore FORCE)
```
Side effect worth knowing: with FORCE, `app_owner` cannot clean up tenant data (a `DELETE` as owner with no tenant set matched 0 rows). That is the intended behaviour but means backfills and test cleanup must set the tenant, or run as a superuser outside the application.

**i (extra)**
```
30 executions of one named prepared statement over 6 clients/4 backends: all counts=5   (max_prepared_statements=100)
max_prepared_statements=100: ok=48/48 errors=[]
max_prepared_statements=0  : ok=24/48 errors=["prepared statement \"q1\" already exists"]
```
With PgBouncer 1.21+ and `max_prepared_statements` set, named prepared statements (used by some ORMs/drivers) work. With the setting at 0 they break. node-postgres only sends named statements when a `name` is given; parameterised unnamed queries worked in every test regardless.

## 4. Results: pg-boss 12.38.2 through PgBouncer

Workload: 100 jobs `{tenantId, n}` alternating tenants A/B on one queue; handler (batch of up to 10, 3 concurrent) opens a transaction on a separate `app_user` pool through PgBouncer, runs `set_config('app.tenant_id', $1, true)`, selects from `asset` (asserts exactly 5 rows, all own tenant) and inserts an `audit_log` row. Pass criteria: 100 jobs `completed`, 100 handled, 0 RLS violations, 50 audit rows per tenant, no error or warning events.

| Scenario | PG 18 | PG 16 | Result |
|---|---|---|---|
| S1: everything through PgBouncer as `app_owner` (schema create, migrate, createQueue, supervise, schedule, workers), default config | PASS | PASS | 100/100 completed in about 2.6 s; 0 violations; 50 rows per tenant; no events |
| S2: as S1 with `useListenNotify: true` (queue created without notify) | PASS | not run | Same; no warning because notify is per queue and was not enabled on the queue |
| S3: schema, migrate and `createQueue` via **direct** connection as `app_owner`; runtime as least-privilege `app_user` via PgBouncer with `createSchema/migrate/supervise/schedule = false`; separate maintenance instance (supervise on) as `app_owner` via PgBouncer; 20 of the 100 jobs enqueued **inside the caller's tenant transaction** with `send(..., {db: {executeSql}})` | PASS | PASS | 100/100; 20/20 transactional enqueues worked on a pooled connection; 0 violations; 0 advisory locks held afterwards |
| P: LISTEN/NOTIFY probe (`useListenNotify: true`, queue `notify: true`, worker poll 30 s) | direct: 8 to 27 ms wakeups. Via PgBouncer: **broken** | via PgBouncer broken | see below |

Representative S1 output (PG 18):
```
boss.start() via PgBouncer as app_owner OK (schema created+migrated through the pooler) in 124ms
states: {"completed":100}  handled=100  rlsViolationsInHandlers=0  handlerErrors=[]
auditRowsPerTenant: aaaa 50 rows/50 distinct, bbbb 50 rows/50 distinct
backend connections: pgboss:0e65ef02/app_owner=4, (app)/app_user=5
advisoryLocksHeldNow=0  listeners=0  events=[]
pgbouncerStats: total_xact_count=1710 total_query_count=9672
```

Findings on the specific concerns:

- **Prepared statements:** no errors. pg-boss sends parameterised, unnamed statements through `pg.Pool.query`. Works with or without `max_prepared_statements`.
- **Advisory locks:** pg-boss uses only `pg_advisory_xact_lock` (transaction scoped) inside explicit multi-statement transactions, so they are pooler-safe. No session-level advisory locks were found in the library (`grep` of `dist/`), and none were held after the runs.
- **Schema creation and migration:** worked through the pooler as `app_owner` (S1) and directly (S3). pg-boss does not *need* a direct connection for this. Direct is still the better practice (see changes) because the migrator role should not be reachable from the pooled app path.
- **Maintenance (`supervise`), scheduling, queue stats:** ran as `app_owner` via PgBouncer with no errors or warnings. In S3 the runtime role `app_user` ran only send/fetch/complete (no DDL); that required `USAGE` on schema `pgboss`, DML on its tables and sequences, and `EXECUTE` on its functions (granted by script; new pg-boss migrations may add objects, so re-grant after every upgrade or use `ALTER DEFAULT PRIVILEGES`).
- **Transactional enqueue:** `send(queue, data, { db })` with the caller's tenant-transaction client works through PgBouncer, which gives the outbox-style "enqueue atomically with the business write" semantics the architecture wants (`enqueue(tx, name, ...)`, section 4).
- **LISTEN/NOTIFY: does not work through transaction pooling.** In pg-boss 12 it is opt-in (`useListenNotify`, default false) and per queue (`createQueue(name, {notify: true})`). When enabled through PgBouncer: no warning at startup; `LISTEN` lands on a server connection that is returned to the pool, so notifications are never delivered; notify-enabled workers then drop to the relaxed 30 s backstop poll. Measured job latency through PgBouncer with a 30 s worker poll: 27 s, 34 s, 51 s (PG 16 run), versus 8 to 27 ms direct. The listener's heartbeat then raises `error: LISTEN/NOTIFY channel registration was lost` (at 40 s and 61 s on the PG 16 run; none within the window on the PG 18 run, so the failure can be completely silent). With the default (`useListenNotify: false`), polling at 0.5 s processed 100 jobs in under 3 s.
- **Connections:** pg-boss's own pool (max 6) plus the app pool were multiplexed onto 4 server connections per (database, user) pair; `SHOW POOLS` showed `sv_idle=4` after the run.

## 5. Findings

| ID | Finding | Severity |
|---|---|---|
| F1 | After any tenant transaction on a pooled server connection, `current_setting('app.tenant_id', true)` returns `''` (empty string), not NULL. The policy as specified in the plan then raises `22P02 invalid input syntax for type uuid: ""` on any later query that has no tenant set. Still fail-closed (no data returned) but it is an error rather than an empty result, and the behaviour depends on the connection's history (fresh backend: 0 rows; used backend: error). Wrap with `NULLIF(..., '')`. | Medium (correctness, not leakage) |
| F2 | Querying a partition directly bypasses the parent policy if the app role has privileges on that partition. Partitions have RLS off by default. Fix by granting the app role privileges on the parent only (verified: select, insert routing work), and as defence in depth enable FORCE RLS plus the same policy on each partition. | High if a partition is ever granted |
| F3 | Session-level `SET app.tenant_id` leaks tenant context across clients through PgBouncer transaction mode (reproduced). Only `set_config(..., true)` inside an explicit transaction is safe. The leak is silent: the second client reads tenant A's rows without error. | High (confirms the rule) |
| F4 | FORCE ROW LEVEL SECURITY makes the table owner and views owned by the owner obey RLS, which also neutralises the "definer view" and owner-role bypass classes. Without FORCE both bypass. Superusers and BYPASSRLS ignore FORCE. | Confirms design |
| F5 | pg-boss works through transaction pooling for send, work, schema creation, migrations, supervision and transactional enqueue. Only LISTEN/NOTIFY is incompatible, and it is off by default. | Confirms design |
| F6 | `ALTER ROLE` / role setup nuance: creating `app_user` NOLOGIN then enabling LOGIN worked as specified. Roles `app_owner` and `app_user` had `rolsuper=false, rolbypassrls=false`. | Info |
| F7 | New partitions created by the owner do not inherit table privileges for `app_user` (verified: after REVOKE, via-parent access kept working with parent-only grants). This is the desired default for F2 and means partition rotation jobs need no grant step. | Info |

## 6. Changes the architecture should make

1. **Change the policy expression (section 5.3 / plan 6.1) to the NULLIF form** and make it the standard generated by the migration helper and checked by the schema lint:
   `USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (same)`.
   Add an isolation test (the b3 test above) asserting that a query on a used pooled connection with no tenant returns 0 rows and that inserts fail with 42501, not 22P02.
2. **Add a partition rule to 5.3 and the lint:** the app role is granted privileges on the partitioned parent only, never on partitions; the partition-creation job creates partitions as the owner/`migrator` role with no grants to the app role; lint fails if any role other than owner has privileges on a child partition. Optionally also enable FORCE RLS and the policy on each partition. Add test g (direct partition read as the app role must fail with 42501) to the CI isolation suite. Include `audit_log`, history and webhook-delivery partitions, which section 8.3 lists as monthly.
3. **Keep the CI "through PgBouncer in transaction mode" pass** (section 8.2 / 5.3). It is cheap and verified. Reuse this spike's `rls_test.mjs` shape: the 600-transaction interleaving test, the outside-tx no-leak assertion, and a negative control that proves the harness would detect a leak (the `pool_size=1` alias trick). Without the negative control the leak test could pass vacuously if the pool ever ran one connection per client.
4. **Set `max_prepared_statements` (e.g. 100) on PgBouncer** in the compose `pooling` profile and in production config, and require PgBouncer >= 1.21. With it at 0, drivers that use named statements break (verified `prepared statement "q1" already exists`). Record PgBouncer 1.26.1 as the tested version.
5. **pg-boss configuration rules (section 7 jobs row and 8.2):**
   - Leave `useListenNotify` at false (the default) and do not create queues with `notify: true` while behind a transaction-mode pooler. If low latency is ever needed, give pg-boss a **separate direct (non-pooled) connection** for LISTEN only; pg-boss 12 uses one connection config for both, so that needs a second pg-boss instance or a direct connection string for the whole worker process. Use `pollingIntervalSeconds` of 1 to 2 for interactive queues.
   - Run schema creation and pg-boss upgrades in the migrator step over a direct connection as `migrator` (S3 pattern), then start runtime instances with `createSchema: false, migrate: false, supervise: false, schedule: false` as the app role, and run one maintenance instance (supervise on) under the owner role. This keeps DDL privileges away from the request path. It is a hardening choice, not a technical requirement: S1 showed everything also works through the pooler as owner.
   - Grant the runtime role `USAGE` on schema `pgboss`, DML on its tables and sequences and `EXECUTE` on its functions, and re-run the grant after each pg-boss upgrade (or use `ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA pgboss`).
   - Use `send(..., { db: { executeSql } })` with the tenant transaction client for transactional enqueue (verified through PgBouncer). The `enqueue(tx, ...)` wrapper in the jobs row is therefore implementable as designed.
6. **State the queue-table exposure in the threat model:** `pgboss.*` tables are not tenant tables and carry no RLS, so `app_user` can read every tenant's job payloads. Keep payloads to ids (`tenantId`, entity ids), no PII or secrets, and keep the worker rule "open tx, `set_config` before any tenant read" (verified: 100/100 jobs, 0 violations).
7. **Document FORCE side effects** in section 8.5: with FORCE the migrator cannot run unscoped backfills or test cleanup (0 rows matched); backfills iterate tenants and set the GUC, or use a one-off superuser path outside the application. The plan's wording "FORCE is set for that role path" is correct and verified.
8. **PostgreSQL major:** both 16 and 18 passed every test. The architecture can stay on 16 for the MVP; moving to 18 needs no change to the RLS design (18 also provides a native `uuidv7()`, not tested in this spike, which would let the "UUIDv7 generated in the app" note in section 8.2 be revisited).
9. **Keep the `identity` schema decision (Appendix A item 2)** but note that those non-RLS lookup tables need the same discipline: grant `app_user` only the minimum, and apply the lint classification "non-tenant" explicitly. (Not tested here.)

## 7. Reproducing

```
docker compose up -d                                  # project atspike, PG 18
cd node && npm i pg pg-boss
TARGET=pgb LABEL=pg18_pgb node rls_test.mjs           # also TARGET=direct
SCEN=s1 node boss_test.mjs                            # s1, s2, s3
MODE=pgb node notify_probe.mjs                        # LISTEN/NOTIFY probe (MODE=direct for comparison)
docker compose down -v
SPIKE_PROJECT=atspike16 PGVER=16 docker compose up -d # repeat on PG 16
```

## 8. Teardown

`docker compose down -v` was run for both projects (`atspike`, `atspike16`). `docker ps -a --filter name=atspike` returned an empty list; no `atspike` volumes or networks remain. The pulled images (`postgres:16`, `postgres:18`, `edoburu/pgbouncer:latest`) were left in the local image cache.

## 9. Limits of this spike

- One PgBouncer version (1.26.1) and one image. RDS Proxy was not tested; its connection pinning on session-level `SET` and prepared statements differs (architecture Appendix A item 8 still requires the staging test).
- Plain passwords and `scram-sha-256` userlist, no TLS, no `auth_query`.
- Load: 600 transactions over 10 clients and 4 server connections; not a performance test.
- Application scoping layers (`TenantRepository`), the `identity` schema and replicas were out of scope.
