// Does pg-boss useListenNotify give low-latency wakeups through PgBouncer transaction mode vs direct?
import pg from 'pg'
import { PgBoss } from 'pg-boss'
const MODE = process.env.MODE || 'pgb'                 // pgb | direct
const port = MODE === 'pgb' ? 56432 : 55432
const sleep = ms => new Promise(r => setTimeout(r, ms))
const sup = new pg.Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password: 'superpw', database: 'spike' }); await sup.connect()
await sup.query('DROP SCHEMA IF EXISTS pgboss CASCADE')
const events = []
const boss = new PgBoss({ host: '127.0.0.1', port, user: 'app_owner', password: 'ownerpw', database: 'spike', max: 4, useListenNotify: true })
boss.on('error', e => events.push(`${((Date.now() - t0) / 1000).toFixed(1)}s error: ${e.message}`))
boss.on('warning', w => events.push(`${((Date.now() - t0) / 1000).toFixed(1)}s warning: ${w.message}`))
const t0 = Date.now()
await boss.start(); await boss.createQueue('probe', { notify: true })
const sent = {}; const latencies = {}
await boss.work('probe', { pollingIntervalSeconds: 30 }, async jobs => { for (const j of jobs) latencies[j.data.i] = Date.now() - sent[j.data.i] })
await sleep(3000)
const lis0 = (await sup.query("select count(*)::int n from pg_listening_channels()")).rows[0].n
for (let i = 0; i < 3; i++) { sent[i] = Date.now(); await boss.send('probe', { i }); await sleep(4000) }
await sleep(14000)  // let the 10s listener heartbeat fire
for (let i = 0; i < 2; i++) { sent[10 + i] = Date.now(); await boss.send('probe', { i: 10 + i }); await sleep(4000) }
await sleep(32000)
console.log(JSON.stringify({ mode: MODE, workerPollingSeconds: 30, jobLatenciesMsByJob: latencies, sentCount: Object.keys(sent).length, events: events.slice(0, 8), eventCount: events.length }))
await boss.stop({ graceful: true, wait: true, timeout: 10000 }).catch(() => {}); await sup.end(); process.exit(0)
