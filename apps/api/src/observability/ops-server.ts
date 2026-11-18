import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { renderMetrics } from './metrics.js';

/**
 * The internal operations server (M1-OPS-01, M1-PLAT-07). A plain `node:http` server on its own port
 * (`OPS_PORT`, default 9464), SEPARATE from the public API listener, and not published by the
 * compose files or the reverse proxy: only the orchestrator and the Prometheus scraper reach it.
 *
 *   GET /metrics   Prometheus text exposition (every role)
 *   GET /healthz   liveness (worker, scheduler: a fresh heartbeat; the api answers on its own port)
 *   GET /readyz    readiness (database reachable, pg-boss started)
 *   + role-specific routes, e.g. the dead-letter admin listing of the worker (`routes`)
 *
 * No authentication by design: the port is network-internal, exactly like a `/metrics` scrape
 * target. Routes registered here must therefore be read-only and ids-only; anything that changes
 * state belongs behind the authenticated API.
 */

export type OpsHandler = (req: IncomingMessage, url: URL) => Promise<OpsResponse> | OpsResponse;

export interface OpsResponse {
  status?: number;
  body: unknown;
}

export interface OpsServerOptions {
  /** `healthz`: process liveness. Throwing or returning false answers 503. */
  live?: () => Promise<boolean> | boolean;
  /** `readyz`: dependencies. Returns a JSON-able body; `ok:false` answers 503. */
  ready?: () => Promise<{ ok: boolean } & Record<string, unknown>>;
  /** Extra GET routes by exact path. */
  routes?: Record<string, OpsHandler>;
}

export interface RunningOpsServer {
  readonly port: number;
  close(): Promise<void>;
}

export async function startOpsServer(
  { host, port }: { host: string; port: number },
  options: OpsServerOptions = {},
): Promise<RunningOpsServer> {
  const server = createServer((req, res) => {
    void handle(req, res, options).catch((err: unknown) => {
      send(res, 500, { status: 'error', error: err instanceof Error ? err.message : 'unknown' });
    });
  });
  await listen(server, host, port);
  const address = server.address();
  return {
    port: typeof address === 'object' && address ? address.port : port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, options: OpsServerOptions) {
  const url = new URL(req.url ?? '/', 'http://ops.local');
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return send(res, 405, { status: 'method_not_allowed' });

  switch (url.pathname) {
    case '/metrics': {
      const { contentType, body } = await renderMetrics();
      res.writeHead(200, { 'content-type': contentType });
      return void res.end(body);
    }
    case '/healthz': {
      const live = options.live ? await Promise.resolve(options.live()).catch(() => false) : true;
      return send(res, live ? 200 : 503, { status: live ? 'ok' : 'unhealthy' });
    }
    case '/readyz': {
      if (!options.ready) return send(res, 200, { status: 'ready' });
      const result = await options.ready().catch((err: unknown) => ({
        ok: false,
        error: err instanceof Error ? err.message : 'unknown',
      }));
      return send(res, result.ok ? 200 : 503, {
        status: result.ok ? 'ready' : 'not_ready',
        ...result,
      });
    }
    default: {
      const route = options.routes?.[url.pathname];
      if (!route) return send(res, 404, { status: 'not_found' });
      const out = await route(req, url);
      return send(res, out.status ?? 200, out.body);
    }
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}
