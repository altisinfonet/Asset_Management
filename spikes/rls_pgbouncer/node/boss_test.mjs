// pg-boss through PgBouncer (transaction mode) with tenant-carrying jobs. Usage: SCEN=s1|s2|s3 node boss_test.mjs
import pg from 'pg'
import { PgBoss } from 'pg-boss'
import fs from 'node:fs'

const HOST = '127.0.0.1', PG_PORT = 55432, PGB_PORT = 56432
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const SCEN = process.env.SCEN || 's1'
const NJOBS = 100
const QUEUE = 'tenant-work'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const cfg = (user, password, port) => ({ host: HOST, port, user, password, database: 'spike' })

const sup = new pg.Client({ ...cfg('postgres', 'superpw', PG_PORT) }); await sup.connect()
const admin = new pg.Client({ ...cfg('postgres', 'superpw', PGB_PORT), database: 'pgbouncer' }); await admin.connect()
const ver = (await sup.query('show server_version')).rows[0].server_version
console.log(`scenario=${SCEN} postgres=${ver} pg-boss=${JSON.parse(fs.readFileSync('node_modules/pg-boss/package.json')).version}`)

// reset state
await sup.query('DROP SCHEMA IF EXISTS pgboss CASCADE')
await sup.query("DELETE FROM audit_log WHERE action LIKE 'job:%'")

const events = []   // warnings + errors from every boss instance
function watch(boss, tag) {
  boss.on('error', e => events.push(`[${tag}] error: ${e.message}`))
  boss.on('warning', w => events.push(`[${tag}] warning: ${w.message}${w.data?.type ? ' (' + w.data.type + ')' : ''}`))
}

const tpool = new pg.Pool({ ...cfg('app_user', 'userpw', PGB_PORT), max: 8 })   // the application's tenant pool, via PgBouncer
async function withTenantTx(tenant, fn) {
  const c = await tpool.connect()
  try { await c.query('BEGIN'); await c.query("select set_config('app.tenant_id',$1,true)", [tenant]); const r = await fn(c); await c.query('COMMIT'); return r }
  catch (e) { try { await c.query('ROLLBACK') } catch {} throw e } finally { c.release() }
}

const stats = { handled: 0, violations: 0, tenantSeen: { [A]: 0, [B]: 0 }, handlerErrors: [] }
async function handler(jobs) {
  await Promise.all(jobs.map(async job => {
    const { tenantId, n } = job.data
    try {
      await withTenantTx(tenantId, async c => {
        const rows = (await c.query('select tenant_id from asset')).rows
        if (rows.length !== 5 || rows.some(r => r.tenant_id !== tenantId)) stats.violations++
        await c.query("insert into audit_log(tenant_id, action) values ($1, $2)", [tenantId, `job:${n}`])
      })
      stats.handled++; stats.tenantSeen[tenantId]++
    } catch (e) { stats.handlerErrors.push(`${tenantId.slice(0, 4)}#${n}: ${e.code} ${e.message}`); throw e }
  }))
}

const out = { scenario: SCEN, postgres: ver, notes: [] }
let main, maint
const t0 = Date.now()
try {
  if (SCEN === 's1' || SCEN === 's2') {
    // EVERYTHING through PgBouncer: schema creation, migrations, queue creation, maintenance, workers; DDL role = app_owner
    main = new PgBoss({ ...cfg('app_owner', 'ownerpw', PGB_PORT), max: 6, pollingIntervalSeconds: 0.5, useListenNotify: SCEN === 's2' })
    watch(main, 'boss')
    await main.start()
    out.notes.push(`boss.start() via PgBouncer as app_owner OK (schema created+migrated through the pooler) in ${Date.now() - t0}ms`)
    await main.createQueue(QUEUE)
    await main.work(QUEUE, { batchSize: 10, localConcurrency: 3, pollingIntervalSeconds: 0.5 }, handler)
    for (let i = 0; i < NJOBS; i++) await main.send(QUEUE, { tenantId: i % 2 ? A : B, n: i })
  } else if (SCEN === 's3') {
    // schema + queue via DIRECT connection as app_owner (the "migrator" step) ...
    const direct = new PgBoss({ ...cfg('app_owner', 'ownerpw', PG_PORT), max: 2 })
    watch(direct, 'direct-migrator')
    await direct.start(); await direct.createQueue(QUEUE); await direct.stop({ graceful: true, wait: true })
    out.notes.push('schema created + migrated + queue created via DIRECT connection as app_owner, then stopped')
    // runtime role grants (queue tables are NOT tenant tables; no RLS on them)
    for (const s of ['GRANT USAGE ON SCHEMA pgboss TO app_user', 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO app_user',
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO app_user', 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO app_user']) await sup.query(s)
    // ... runtime = least-privilege app_user via PgBouncer, no DDL/migrations/maintenance
    main = new PgBoss({ ...cfg('app_user', 'userpw', PGB_PORT), max: 6, pollingIntervalSeconds: 0.5, createSchema: false, migrate: false, supervise: false, schedule: false })
    watch(main, 'runtime(app_user)')
    await main.start()
    out.notes.push('runtime boss.start() via PgBouncer as app_user (createSchema/migrate/supervise/schedule = false) OK')
    // maintenance instance (expiry, retention deletes, queue stats) as app_owner via PgBouncer
    maint = new PgBoss({ ...cfg('app_owner', 'ownerpw', PGB_PORT), max: 2, createSchema: false, migrate: false, supervise: true, schedule: false })
    watch(maint, 'maintenance(app_owner)')
    await maint.start()
    out.notes.push('maintenance boss (supervise=true) via PgBouncer as app_owner started OK')
    await main.work(QUEUE, { batchSize: 10, localConcurrency: 3, pollingIntervalSeconds: 0.5 }, handler)
    // 20 jobs enqueued INSIDE the tenant transaction (transactional enqueue / outbox style) using the app's own tx client
    let txSent = 0
    for (let i = 0; i < 20; i++) {
      const tenantId = i % 2 ? A : B
      await withTenantTx(tenantId, async c => {
        await c.query("select 1")
        const id = await main.send(QUEUE, { tenantId, n: i }, { db: { executeSql: (text, values) => c.query(text, values) } })
        if (id) txSent++
      })
    }
    out.notes.push(`${txSent}/20 jobs enqueued inside the caller's tenant transaction via {db:{executeSql}} on a PgBouncer connection`)
    for (let i = 20; i < NJOBS; i++) await main.send(QUEUE, { tenantId: i % 2 ? A : B, n: i })
  }
  // wait for completion
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    const r = await sup.query("select state, count(*)::int n from pgboss.job where name=$1 group by 1", [QUEUE])
    const completed = r.rows.find(x => x.state === 'completed')?.n || 0
    if (completed >= NJOBS) break
    await sleep(500)
  }
  out.elapsedMs = Date.now() - t0
  const states = (await sup.query("select state, count(*)::int n from pgboss.job where name=$1 group by 1 order by 1", [QUEUE])).rows
  out.states = Object.fromEntries(states.map(r => [r.state, r.n]))
  const audit = (await sup.query("select tenant_id, count(*)::int n, count(distinct action)::int d from audit_log where action like 'job:%' group by 1 order by 1")).rows
  out.auditRowsPerTenant = Object.fromEntries(audit.map(r => [r.tenant_id.slice(0, 4), `${r.n} rows/${r.d} distinct`]))
  out.handled = stats.handled; out.rlsViolationsInHandlers = stats.violations; out.handlerErrors = stats.handlerErrors.slice(0, 5)
  // evidence from the databases
  const conns = (await sup.query("select application_name, usename, count(*)::int n from pg_stat_activity where datname='spike' and backend_type='client backend' and pid<>pg_backend_pid() group by 1,2 order by 1,2")).rows
  out.backendConnections = conns.map(r => `${r.application_name || '(none)'}/${r.usename}=${r.n}`).join(', ')
  out.advisoryLocksHeldNow = (await sup.query("select count(*)::int n from pg_locks where locktype='advisory'")).rows[0].n
  out.listeners = (await sup.query("select count(*)::int n from pg_stat_activity where query ilike 'LISTEN%' and pid<>pg_backend_pid()")).rows[0].n
  const pools = (await admin.query('SHOW POOLS')).rows.filter(r => r.database === 'spike')
  out.pgbouncerPools = pools.map(r => `${r.database}/${r.user}: cl_active=${r.cl_active} sv_active=${r.sv_active} sv_idle=${r.sv_idle}`)
  const st = (await admin.query('SHOW STATS')).rows.find(r => r.database === 'spike')
  out.pgbouncerStats = `total_xact_count=${st.total_xact_count} total_query_count=${st.total_query_count}`
  if (maint) { await sleep(3000) }
} catch (e) {
  out.fatal = `${e.code || ''} ${e.message}`; console.error(e)
} finally {
  out.events = events
  for (const b of [main, maint]) { try { await b?.stop({ graceful: true, wait: true, timeout: 10000 }) } catch (e) { out.events.push('stop error: ' + e.message) } }
  await tpool.end().catch(() => {}); await sup.end(); await admin.end()
}
out.pass = !out.fatal && out.states?.completed === NJOBS && out.handled === NJOBS && out.rlsViolationsInHandlers === 0
console.log(JSON.stringify(out, null, 2))
fs.writeFileSync(`boss_${SCEN}_${process.env.LABEL || 'pg18'}.json`, JSON.stringify(out, null, 2))
console.log(`RESULT ${SCEN}: ${out.pass ? 'PASS' : 'FAIL'}`)
process.exit(0)
