// RLS + PgBouncer(transaction mode) spike. Usage: TARGET=pgb|direct node rls_test.mjs
import pg from 'pg'
import fs from 'node:fs'

const TARGET = process.env.TARGET || 'pgb'
const LABEL = process.env.LABEL || TARGET
const HOST = process.env.HOST || '127.0.0.1'
const PG_PORT = +(process.env.PG_PORT || 55432)
const PGB_PORT = +(process.env.PGB_PORT || 56432)
const PORT = TARGET === 'pgb' ? PGB_PORT : PG_PORT
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const cfg = (user, password, port = PORT, database = 'spike') => ({ host: HOST, port, user, password, database })
const userPool = (max = 10, database = 'spike') => new pg.Pool({ ...cfg('app_user', 'userpw', PORT, database), max })

const results = []
let logs = []
const log = (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '))
async function test(id, name, fn, { only } = {}) {
  logs = []
  if (only && only !== TARGET) { results.push({ id, name, status: 'N/A', out: [`not applicable on ${TARGET}`] }); return }
  let status = 'PASS'
  try { await fn() } catch (e) { status = 'FAIL'; log('ASSERTION/ERROR:', e.message) }
  results.push({ id, name, status, out: logs })
  console.log(`\n[${status}] ${id} ${name}`)
  logs.forEach(l => console.log('   ' + l))
}
const assert = (c, m) => { if (!c) throw new Error('assert failed: ' + m) }

// the one-and-only way the app talks to the DB for tenant data
async function withTenantTx(pool, tenant, fn) {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query("select set_config('app.tenant_id', $1, true)", [tenant])
    const r = await fn(c)
    await c.query('COMMIT')
    return r
  } catch (e) { try { await c.query('ROLLBACK') } catch {} ; throw e } finally { c.release() }
}
const errInfo = e => `${e.code} ${e.message}`

// ---------------------------------------------------------------- environment
const admin = TARGET === 'pgb' ? new pg.Client(cfg('postgres', 'superpw', PGB_PORT, 'pgbouncer')) : null
const sup = new pg.Client(cfg('postgres', 'superpw', PG_PORT))
await sup.connect()
const ver = (await sup.query('show server_version')).rows[0].server_version
let pgbVer = 'n/a'
if (admin) { await admin.connect(); pgbVer = (await admin.query('SHOW VERSION')).rows[0].version; log() }
console.log(`target=${TARGET} postgres=${ver} pgbouncer=${pgbVer} pg(driver)=${(await import('pg/package.json', { with: { type: 'json' } })).default.version}`)

const pool = userPool(10)

await test('a', 'tenant A sees only A rows, tenant B only B rows (set_config(..., true) in tx)', async () => {
  const ra = await withTenantTx(pool, A, c => c.query('select tenant_id, name from asset order by name'))
  const rb = await withTenantTx(pool, B, c => c.query('select tenant_id, name from asset order by name'))
  log(`A: ${ra.rowCount} rows, distinct tenant_ids=${[...new Set(ra.rows.map(r => r.tenant_id))]}`)
  log(`B: ${rb.rowCount} rows, distinct tenant_ids=${[...new Set(rb.rows.map(r => r.tenant_id))]}`)
  assert(ra.rowCount === 5 && ra.rows.every(r => r.tenant_id === A), 'A')
  assert(rb.rowCount === 5 && rb.rows.every(r => r.tenant_id === B), 'B')
})

await test('b', 'unset tenant fails closed (reads + writes)', async () => {
  // b1: brand-new server connection that never had the GUC defined -> setting is NULL -> 0 rows
  const fresh = new pg.Client(cfg('app_user', 'userpw', PG_PORT))   // always DIRECT = guaranteed-fresh backend
  await fresh.connect()
  const r1 = await fresh.query('select count(*)::int n, current_setting($1, true) as guc from asset', ['app.tenant_id'])
  log(`b1 fresh direct backend (GUC never defined): count=${r1.rows[0].n} guc=${JSON.stringify(r1.rows[0].guc)}`)
  assert(r1.rows[0].n === 0, 'fresh backend must see 0 rows')
  let e1 = null
  try { await fresh.query("insert into asset(tenant_id,name) values ($1,'x')", [A]) } catch (e) { e1 = e }
  log(`b1 insert with unset tenant -> ${e1 ? errInfo(e1) : 'SUCCEEDED (BAD)'}`)
  assert(e1 && e1.code === '42501', 'insert must fail with RLS violation')
  await fresh.end()

  // b2: tx on pool without calling set_config at all
  const c = await pool.connect()
  await c.query('BEGIN')
  let n2, e2 = null
  try { n2 = (await c.query('select count(*)::int n from asset')).rows[0].n } catch (e) { e2 = e }
  await c.query('ROLLBACK'); c.release()
  log(`b2 pooled tx, no set_config: ${e2 ? 'ERROR ' + errInfo(e2) : 'count=' + n2}`)
  assert(e2 || n2 === 0, 'must not see rows')
})

await test('b3', 'GOTCHA: after a set_config(...,true) on a connection, later "unset" reads as empty string -> policy as specified raises 22P02 (still fail-closed); NULLIF variant returns 0 rows', async () => {
  // deterministic: pool_size=1 DB alias on pgbouncer (or single direct pool of 1)
  const p1 = TARGET === 'pgb' ? userPool(2, 'spike_one') : new pg.Pool({ ...cfg('app_user', 'userpw'), max: 1 })
  await withTenantTx(p1, A, c => c.query('select 1'))            // GUC now "defined" on the one backend
  const g = await p1.query("select current_setting('app.tenant_id', true) as guc, pg_backend_pid() pid")
  log(`outside any tx, after earlier tenant tx: guc=${JSON.stringify(g.rows[0].guc)} (empty string, not NULL)`)
  let spec = null
  try { const r = await p1.query('select count(*)::int n from asset'); spec = `count=${r.rows[0].n}` } catch (e) { spec = 'ERROR ' + errInfo(e) }
  log(`policy as specified  (current_setting(..., true)::uuid)           -> ${spec}`)
  const nf = await p1.query('select count(*)::int n from asset_nullif')
  log(`NULLIF variant       (NULLIF(current_setting(..., true), '')::uuid) -> count=${nf.rows[0].n}`)
  let ins = null
  try { await p1.query("insert into asset_nullif(tenant_id,name) values ($1,'x')", [A]) } catch (e) { ins = e }
  log(`NULLIF variant insert with unset tenant -> ${ins ? errInfo(ins) : 'SUCCEEDED (BAD)'}`)
  assert(nf.rows[0].n === 0 && ins && ins.code === '42501', 'nullif variant must fail closed with 0 rows / 42501')
  assert(spec.startsWith('ERROR 22P02') || spec === 'count=0', 'spec policy must error or return 0')
  await p1.end()
})

await test('c', 'leak test: 600 interleaved concurrent txs (2 tenants, pool=10, some erroring/rolling back); then outside-tx sees no tenant', async () => {
  const N = 600, pids = new Set(), clientPids = new Map()
  let bad = 0, gucBad = 0, errs = 0, done = 0
  const jobs = Array.from({ length: N }, (_, i) => (async () => {
    const t = i % 2 ? A : B
    const fail = i % 17 === 0
    try {
      await withTenantTx(pool, t, async c => {
        const pid = (await c.query('select pg_backend_pid() p')).rows[0].p; pids.add(pid)
        await new Promise(r => setTimeout(r, Math.random() * 15))
        const r1 = await c.query('select tenant_id from asset')
        const g = (await c.query("select current_setting('app.tenant_id', true) g")).rows[0].g
        await new Promise(r => setTimeout(r, Math.random() * 15))
        const r2 = await c.query('select tenant_id from asset')
        if (g !== t) gucBad++
        bad += [...r1.rows, ...r2.rows].filter(r => r.tenant_id !== t).length
        if (r1.rowCount !== 5 || r2.rowCount !== 5) bad++
        if (fail) await c.query("insert into asset(tenant_id,name) values ($1,'nope')", [t === A ? B : A]) // WITH CHECK failure -> rollback
      })
    } catch (e) { if (fail) errs++; else { bad++; log('unexpected', errInfo(e)) } }
    done++
  })())
  await Promise.all(jobs)
  log(`txs completed=${done}, cross-tenant/row-count violations=${bad}, wrong-GUC-in-tx=${gucBad}, intended failures rolled back=${errs}`)
  log(`distinct server backend PIDs used by the 600 txs: ${pids.size} ${TARGET === 'pgb' ? '(pgbouncer default_pool_size=4; node pool max=10 clients)' : ''}`)
  assert(bad === 0 && gucBad === 0, 'violations')
  // outside any tx, hit every backend several times
  const seen = new Set(), vals = new Set(); let leaked = 0
  await Promise.all(Array.from({ length: 80 }, async () => {
    const r = await pool.query("select pg_backend_pid() p, current_setting('app.tenant_id', true) g")
    seen.add(r.rows[0].p); vals.add(JSON.stringify(r.rows[0].g))
    if (r.rows[0].g === A || r.rows[0].g === B) leaked++
  }))
  log(`80 autocommit queries outside any tx across ${seen.size} backends: observed GUC values=${[...vals]} leaked=${leaked}`)
  assert(leaked === 0, 'GUC leaked outside tx')
  let rowsOutside = null
  try { rowsOutside = (await pool.query('select count(*)::int n from asset_nullif')).rows[0].n } catch (e) { rowsOutside = 'ERR ' + errInfo(e) }
  log(`select from asset_nullif outside any tx -> ${rowsOutside}`)
  assert(rowsOutside === 0, 'outside tx must see 0 rows')
  if (TARGET === 'pgb') {
    const pools = (await admin.query('SHOW POOLS')).rows.filter(r => r.database === 'spike' && r.user === 'app_user')
    log(`SHOW POOLS (spike/app_user): cl_active=${pools[0]?.cl_active} cl_waiting=${pools[0]?.cl_waiting} sv_active=${pools[0]?.sv_active} sv_idle=${pools[0]?.sv_idle} pool_mode=${pools[0]?.pool_mode}`)
  }
})

await test('d', 'NEGATIVE CONTROL: session-level SET app.tenant_id leaks across pooled clients (pool_size=1 alias)', async () => {
  const c1 = new pg.Client(cfg('app_user', 'userpw', PGB_PORT, 'spike_one')); await c1.connect()
  const c2 = new pg.Client(cfg('app_user', 'userpw', PGB_PORT, 'spike_one')); await c2.connect()
  try {
    await c1.query("SET app.tenant_id = '" + A + "'")                          // session-level (WRONG on purpose)
    const p1 = (await c1.query('select pg_backend_pid() p')).rows[0].p
    const r = await c2.query("select pg_backend_pid() p, current_setting('app.tenant_id', true) g, (select count(*)::int from asset) n, (select string_agg(distinct tenant_id::text, ',') from asset) t")
    log(`client1 did session SET to tenant A (backend ${p1}); DIFFERENT client2 now sees backend=${r.rows[0].p} guc=${r.rows[0].g} rows=${r.rows[0].n} tenants=${r.rows[0].t}`)
    assert(r.rows[0].g === A && r.rows[0].n === 5, 'expected leak to be demonstrated')
    log('=> LEAK CONFIRMED: client2 never set a tenant but reads tenant A data. This is why only set_config(..., true) inside a tx is allowed.')
    // contrast: transaction-local setting does not leak
    await c1.query('RESET app.tenant_id')
    await c1.query('BEGIN'); await c1.query("select set_config('app.tenant_id',$1,true)", [A]); await c1.query('COMMIT')
    const r2 = await c2.query("select current_setting('app.tenant_id', true) g")
    log(`contrast: tx-local set_config then COMMIT -> other client sees guc=${JSON.stringify(r2.rows[0].g)}`)
    assert(r2.rows[0].g !== A, 'tx-local must not leak')
  } finally { await c1.query('RESET app.tenant_id').catch(() => {}); await c1.end(); await c2.end() }
}, { only: 'pgb' })

await test('e', 'WITH CHECK blocks insert/update of rows for another tenant; cross-tenant UPDATE/DELETE affect 0 rows', async () => {
  let e1 = null
  try { await withTenantTx(pool, A, c => c.query("insert into asset(tenant_id,name) values ($1,'evil')", [B])) } catch (e) { e1 = e }
  log(`tenant A inserts row with tenant_id=B -> ${e1 ? errInfo(e1) : 'SUCCEEDED (BAD)'}`)
  assert(e1 && e1.code === '42501', 'insert must be blocked')
  let e2 = null
  try { await withTenantTx(pool, A, c => c.query('update asset set tenant_id=$1', [B])) } catch (e) { e2 = e }
  log(`tenant A updates own rows to tenant_id=B -> ${e2 ? errInfo(e2) : 'SUCCEEDED (BAD)'}`)
  assert(e2 && e2.code === '42501', 'update must be blocked')
  const u = await withTenantTx(pool, A, async c => { const x = await c.query('update asset set name=name where tenant_id=$1', [B]); const d = await c.query('delete from asset where tenant_id=$1', [B]); return [x.rowCount, d.rowCount] })
  log(`tenant A update/delete targeting B's rows: rowCount update=${u[0]} delete=${u[1]}`)
  assert(u[0] === 0 && u[1] === 0, 'must touch 0 rows')
  const ok = await withTenantTx(pool, A, async c => { const r = await c.query("insert into asset(tenant_id,name) values ($1,'legit') returning id", [A]); await c.query('delete from asset where id=$1', [r.rows[0].id]); return r.rowCount })
  log(`control: A inserts+deletes own row -> ${ok} row(s) OK`)
})

await test('f', 'security_invoker view respects RLS; default (definer) view over a NON-forced owner table bypasses it', async () => {
  const q = async (v) => (await withTenantTx(pool, A, c => c.query(`select count(*)::int n, count(distinct tenant_id)::int t from ${v}`))).rows[0]
  const inv = await q('asset_v_invoker'), def = await q('asset_v_definer')
  log(`FORCE table  : asset_v_invoker (security_invoker=true) as A: rows=${inv.n} tenants=${inv.t}`)
  log(`FORCE table  : asset_v_definer (default, owner=app_owner) as A: rows=${def.n} tenants=${def.t}   <- FORCE RLS still applies to the view owner`)
  assert(inv.n === 5 && inv.t === 1, 'invoker view filtered')
  assert(def.n === 5, 'definer view over FORCE table is still filtered because owner is subject to FORCE RLS')
  const ni = await q('noforce_v_invoker'), nd = await q('noforce_v_definer')
  log(`NO-FORCE tbl : noforce_v_invoker as A: rows=${ni.n} tenants=${ni.t}`)
  log(`NO-FORCE tbl : noforce_v_definer as A: rows=${nd.n} tenants=${nd.t}   <- BYPASS (owner rights, no FORCE)`)
  assert(ni.n === 5 && ni.t === 1, 'invoker view over noforce filtered')
  assert(nd.n === 10 && nd.t === 2, 'expected definer view to bypass on non-forced table')
})

await test('g', 'partition: RLS via parent vs direct partition access (and privilege-based mitigation)', async () => {
  const own = new pg.Client(cfg('app_owner', 'ownerpw', PG_PORT)); await own.connect()   // DDL direct
  try {
    const one = async (sql) => (await withTenantTx(pool, A, c => c.query(sql))).rows
    const viaParent = await one('select action from audit_log order by id')
    log(`as tenant A, via parent audit_log: ${viaParent.length} rows ${JSON.stringify(viaParent.map(r => r.action))}  (A owns 2 of 4 rows)`)
    assert(viaParent.length === 2, 'parent filtered')
    const rls = (await sup.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname like 'audit_log%' and relkind in ('r','p') order by relname")).rows
    log('relrowsecurity/force per relation: ' + rls.map(r => `${r.relname}=${r.relrowsecurity}/${r.relforcerowsecurity}`).join(', '))
    const direct = await one('select tenant_id, action from audit_log_2026_11'), direct12 = await one('select tenant_id, action from audit_log_2026_12')
    log(`as tenant A, DIRECT audit_log_2026_11 (app_user has table privilege on partition): ${direct.length} rows, tenants=${[...new Set(direct.map(r => r.tenant_id.slice(0, 4)))]}`)
    log(`as tenant A, DIRECT audit_log_2026_12: ${direct12.length} rows, tenants=${[...new Set(direct12.map(r => r.tenant_id.slice(0, 4)))]}`)
    const directLeak = direct.some(r => r.tenant_id === B) || direct12.some(r => r.tenant_id === B)
    log(`=> direct partition access ${directLeak ? 'BYPASSES parent policy (leak) when app_user has privileges on the partition' : 'is filtered'}`)
    assert(directLeak, 'expected leak via direct partition access')
    // mitigation 1: no privileges on partitions
    await own.query('REVOKE ALL ON audit_log_2026_11, audit_log_2026_12, audit_log_default FROM app_user')
    let denied = null
    try { await one('select * from audit_log_2026_11') } catch (e) { denied = e }
    log(`mitigation: REVOKE on partitions -> direct partition read: ${denied ? errInfo(denied) : 'STILL READABLE (BAD)'}`)
    const viaParent2 = await one('select action from audit_log order by id')
    const ins = await withTenantTx(pool, A, c => c.query("insert into audit_log(tenant_id, at, action) values ($1, '2026-12-15', 'routed-insert') returning id", [A]))
    const cleanup = await sup.query("delete from audit_log where action='routed-insert'")
    log(`mitigation: via parent still works with only parent privileges: select=${viaParent2.length} rows, insert routed to partition ok (${ins.rowCount} row, cleanup via superuser: ${cleanup.rowCount})`)
    assert(denied && denied.code === '42501' && viaParent2.length === 2 && ins.rowCount === 1, 'mitigation should hold')
    // mitigation 2 (defence in depth): ENABLE+FORCE+policy on each partition too
    await own.query('GRANT SELECT ON audit_log_2026_11 TO app_user')
    await own.query('ALTER TABLE audit_log_2026_11 ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_log_2026_11 FORCE ROW LEVEL SECURITY')
    await own.query("CREATE POLICY tenant_isolation ON audit_log_2026_11 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)")
    const d2 = await one('select tenant_id from audit_log_2026_11')
    log(`mitigation 2: policy on the partition itself + privilege granted -> direct read as A: ${d2.length} rows, only A=${d2.every(r => r.tenant_id === A)}`)
    assert(d2.length === 2 && d2.every(r => r.tenant_id === A), 'partition-level policy filters')
    // restore
    await own.query('DROP POLICY tenant_isolation ON audit_log_2026_11; ALTER TABLE audit_log_2026_11 NO FORCE ROW LEVEL SECURITY; ALTER TABLE audit_log_2026_11 DISABLE ROW LEVEL SECURITY')
  } finally {
    await own.query('GRANT SELECT, INSERT, UPDATE, DELETE ON audit_log_2026_11, audit_log_2026_12, audit_log_default TO app_user').catch(() => {})
    await own.end()
  }
})

await test('h', 'app_owner: without FORCE bypasses RLS; with FORCE is restricted; superuser bypasses even FORCE', async () => {
  const own = new pg.Client(cfg('app_owner', 'ownerpw', PG_PORT)); await own.connect()
  try {
    const cnt = async (cl, t) => (await cl.query(`select count(*)::int n from ${t}`)).rows[0].n
    const nf = await cnt(own, 'asset_noforce'), f = await cnt(own, 'asset')
    log(`app_owner, no tenant set: asset_noforce (ENABLE only) -> ${nf} rows (BYPASS); asset (FORCE) -> ${f} rows`)
    assert(nf === 10 && f === 0, 'owner semantics')
    await own.query('BEGIN'); await own.query("select set_config('app.tenant_id',$1,true)", [A])
    const fa = await cnt(own, 'asset'), nfa = await cnt(own, 'asset_noforce')
    log(`app_owner with tenant A set: asset (FORCE) -> ${fa} rows; asset_noforce -> ${nfa} rows`)
    await own.query('ALTER TABLE asset_noforce FORCE ROW LEVEL SECURITY')            // DDL is transactional
    const after = await cnt(own, 'asset_noforce')
    log(`after ALTER TABLE asset_noforce FORCE ROW LEVEL SECURITY (same tx, rolled back afterwards): ${after} rows`)
    await own.query('ROLLBACK')
    assert(fa === 5 && nfa === 10 && after === 5, 'force semantics')
    const su = await cnt(sup, 'asset')
    const attrs = (await sup.query("select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('app_owner','app_user','postgres') order by 1")).rows
    log(`superuser postgres on FORCE table with no tenant: ${su} rows (superuser/BYPASSRLS ignore FORCE). roles: ${attrs.map(r => `${r.rolname}(super=${r.rolsuper},bypassrls=${r.rolbypassrls})`).join(' ')}`)
    assert(su === 10, 'superuser bypass')
  } finally { await own.end() }
})

await test('i', 'extra: named prepared statements + parameter binding survive transaction pooling (max_prepared_statements=100)', async () => {
  const cl = await Promise.all(Array.from({ length: 6 }, async () => { const c = new pg.Client(cfg('app_user', 'userpw')); await c.connect(); return c }))
  const sqlText = 'select count(*)::int n from asset where name like $1'
  const res = []
  for (let round = 0; round < 5; round++) await Promise.all(cl.map(async (c, i) => {
    await c.query('BEGIN'); await c.query("select set_config('app.tenant_id',$1,true)", [i % 2 ? A : B])
    const r = await c.query({ name: 'cnt_by_name', text: sqlText, values: ['asset-%'] })
    await c.query('COMMIT'); res.push(r.rows[0].n)
  }))
  log(`30 executions of one named prepared statement over 6 clients/4 backends: all counts=${[...new Set(res)]}`)
  if (TARGET === 'pgb') { const s = (await admin.query('SHOW CONFIG')).rows.find(r => r.key === 'max_prepared_statements'); log(`pgbouncer max_prepared_statements=${s.value}`) }
  assert(res.every(n => n === 5), 'named prepared statement results')
  await Promise.all(cl.map(c => c.end()))
})

await pool.end(); await sup.end(); if (admin) await admin.end()
const summary = { target: TARGET, label: LABEL, postgres: ver, pgbouncer: pgbVer, results }
fs.writeFileSync(`results_${LABEL}.json`, JSON.stringify(summary, null, 2))
console.log('\nSUMMARY ' + LABEL + ': ' + results.map(r => `${r.id}=${r.status}`).join(' '))
process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0)
