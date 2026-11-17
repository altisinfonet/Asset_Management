import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './index.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  it('parses a health response and builds the URL from baseUrl', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      json({ status: 'ok', checks: { db: { status: 'ok' } }, uptimeSeconds: 1 }),
    );
    const client = createApiClient({ baseUrl: 'http://api.test/', fetch: fetchMock });
    const health = await client.getHealth();
    expect(health.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/v1/health', expect.anything());
  });

  it('returns a degraded health body for 503', async () => {
    const client = createApiClient({
      fetch: async () =>
        json({ status: 'degraded', checks: { db: { status: 'error' } }, uptimeSeconds: 1 }, 503),
    });
    expect((await client.getHealth()).status).toBe('degraded');
  });

  it('throws ApiError on other failures', async () => {
    const client = createApiClient({ fetch: async () => json({ message: 'nope' }, 500) });
    await expect(client.getVersion()).rejects.toBeInstanceOf(ApiError);
  });
});
