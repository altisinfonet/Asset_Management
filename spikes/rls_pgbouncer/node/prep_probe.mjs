import pg from 'pg'
const admin = new pg.Client({ host: '127.0.0.1', port: 56432, user: 'postgres', password: 'superpw', database: 'pgbouncer' }); await admin.connect()
async function run(label) {
  const cl = await Promise.all(Array.from({ length: 8 }, async () => { const c = new pg.Client({ host: '127.0.0.1', port: 56432, user: 'app_user', password: 'userpw', database: 'spike' }); await c.connect(); return c }))
  const errs = new Set(); let ok = 0
  for (let r = 0; r < 6; r++) await Promise.all(cl.map(async c => { try { await c.query({ name: 'q1', text: 'select 1 as x where $1::int > 0', values: [1] }); ok++ } catch (e) { errs.add(e.message) } }))
  console.log(label, 'ok=' + ok + '/48', 'errors=' + JSON.stringify([...errs]))
  await Promise.all(cl.map(c => c.end().catch(() => {})))
}
await run('max_prepared_statements=100:')
try { await admin.query('SET max_prepared_statements = 0'); console.log((await admin.query('SHOW CONFIG')).rows.find(r => r.key === 'max_prepared_statements').value) } catch (e) { console.log('SET failed', e.message) }
await run('max_prepared_statements=0:')
await admin.query('SET max_prepared_statements = 100').catch(() => {})
await admin.end()
