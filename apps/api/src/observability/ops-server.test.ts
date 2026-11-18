import { afterEach, describe, expect, it } from 'vitest';
import { httpRequests, onScrape, setQueueDepth } from './metrics.js';
import { type RunningOpsServer, startOpsServer } from './ops-server.js';

let server: RunningOpsServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const get = (path: string) => fetch(`http://127.0.0.1:${server!.port}${path}`);

describe('ops server (M1-OPS-01)', () => {
  it('serves Prometheus metrics: RED series, process metrics, queue depth, scrape hooks', async () => {
    server = await startOpsServer({ host: '127.0.0.1', port: 0 });
    httpRequests.inc({ method: 'GET', route: '/v1/assets/:id', status: '200' });
    setQueueDepth('mail.send', { ready: 2, deferred: 0, active: 1, failed: 0 });
    let scraped = 0;
    const off = onScrape(() => void scraped++);
    const res = await get('/metrics');
    off();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toMatch(/http_requests_total\{[^}]*route="\/v1\/assets\/:id"[^}]*\} 1/);
    expect(body).toContain('jobs_queue_depth{queue="mail.send",state="ready"');
    expect(body).toContain('process_cpu_user_seconds_total');
    expect(scraped).toBe(1);
  });

  it('never uses tenant_id as a metric label', async () => {
    server = await startOpsServer({ host: '127.0.0.1', port: 0 });
    expect(await (await get('/metrics')).text()).not.toMatch(/tenant_id/);
  });

  it('healthz / readyz reflect the provided checks; unknown paths 404; writes are refused', async () => {
    let live = true;
    server = await startOpsServer(
      { host: '127.0.0.1', port: 0 },
      {
        live: () => live,
        ready: async () => ({ ok: live, queues: ['mail.send'] }),
        routes: { '/admin/x': () => ({ body: { data: [] } }) },
      },
    );
    expect((await get('/healthz')).status).toBe(200);
    const ready = await get('/readyz');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: 'ready', queues: ['mail.send'] });
    expect(await (await get('/admin/x')).json()).toEqual({ data: [] });
    expect((await get('/nope')).status).toBe(404);
    expect(
      (await fetch(`http://127.0.0.1:${server.port}/metrics`, { method: 'POST' })).status,
    ).toBe(405);
    live = false;
    expect((await get('/healthz')).status).toBe(503);
    expect((await get('/readyz')).status).toBe(503);
  });
});
