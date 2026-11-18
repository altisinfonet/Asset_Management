import { describe, expect, it, vi } from 'vitest';
import { ApiError, createTypedClient, getHealth, getVersion } from './index.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const clientFor = (respond: (request: Request) => Response) =>
  createTypedClient({
    baseUrl: 'http://api.test/',
    fetch: vi.fn(async (input: RequestInfo | URL) => respond(input as Request)) as typeof fetch,
  });

describe('health and version helpers', () => {
  it('reads a health response from the baseUrl', async () => {
    let url = '';
    const client = clientFor((request) => {
      url = request.url;
      return json({ status: 'ok', checks: { db: { status: 'ok' } }, uptimeSeconds: 1 });
    });
    expect((await getHealth(client)).status).toBe('ok');
    expect(url).toBe('http://api.test/v1/health');
  });

  it('returns a degraded health body for 503', async () => {
    const client = clientFor(() =>
      json({ status: 'degraded', checks: { db: { status: 'error' } }, uptimeSeconds: 1 }, 503),
    );
    expect((await getHealth(client)).status).toBe('degraded');
  });

  it('throws ApiError on other failures', async () => {
    const client = clientFor(() => json({ message: 'nope' }, 500));
    await expect(getVersion(client)).rejects.toBeInstanceOf(ApiError);
    await expect(getHealth(client)).rejects.toBeInstanceOf(ApiError);
    const unrelated503 = clientFor(() => json({ title: 'proxy down' }, 503));
    await expect(getHealth(unrelated503)).rejects.toBeInstanceOf(ApiError);
  });

  it('reads the version', async () => {
    const client = clientFor(() => json({ name: 'api', version: '1', commit: 'abc', role: 'api' }));
    expect((await getVersion(client)).role).toBe('api');
  });
});
