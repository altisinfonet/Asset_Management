import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, dbEnabled } from '../auth/support.js';
import {
  type App,
  type TenantFixture,
  createTenant,
  createUser,
  newTenancy,
  seedBasics,
  startRegistryApp,
} from '../registry/support.js';

/**
 * M2-TAG-01: public code and scan resolve. The QR carries `<PUBLIC_URL>/s/<label_code>`; the code is
 * opaque (128 random bits, unique per tenant), resolve accepts the code, the whole label URL or the
 * Code128 tag, reveals nothing without a credential, and a signed-in caller that keeps missing is
 * throttled (enumeration resistance).
 */
describe.skipIf(!dbEnabled)('scan codes and resolve (M2-TAG-01)', () => {
  const tenancy = newTenancy();
  let app: App;
  let A: TenantFixture;
  let B: TenantFixture;
  let assets: Array<{ id: string; asset_tag: string; label_code: string }> = [];

  beforeAll(async () => {
    ({ app } = await startRegistryApp({ SCAN_RESOLVE_MAX_MISSES: '10' }));
    A = await createTenant(app, tenancy, 'scana');
    B = await createTenant(app, tenancy, 'scanb');
    const { category } = await seedBasics(A.admin);
    for (let i = 0; i < 12; i++) {
      assets.push((await A.admin.post('/v1/assets', { category_id: category.id })).body);
    }
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
  });

  it('every asset gets an opaque, unique, URL-safe public code at creation', () => {
    const codes = assets.map((a) => a.label_code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const a of assets) {
      expect(a.label_code).toMatch(/^[0-9a-f]{32}$/); // 128 random bits, URL-safe
      // not derived from anything an outsider can see
      expect(a.label_code).not.toContain(a.id.replace(/-/g, '').slice(-12));
      expect(a.label_code.toLowerCase()).not.toContain(a.asset_tag.toLowerCase());
    }
  });

  it('resolves the bare code, the label URL (/s/<code>, with query or trailing slash) and the tag', async () => {
    const a = assets[0]!;
    const url = (code: string) => `/v1/scan/resolve?code=${encodeURIComponent(code)}`;
    for (const code of [
      a.label_code,
      `/s/${a.label_code}`,
      `https://app.example.org/s/${a.label_code}`,
      `https://app.example.org/s/${a.label_code}?utm_source=qr`,
      `https://app.example.org/s/${a.label_code}/`,
      `  ${a.label_code}  `,
      a.asset_tag,
      a.asset_tag.toLowerCase(),
    ]) {
      const res = await A.admin.get(url(code));
      expect(res.status, code).toBe(200);
      expect(res.body.asset.id).toBe(a.id);
      expect(res.body.entity_type).toBe('asset');
      expect(res.body.allowed_actions).toContain('update');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers.etag).toMatch(/^W\//);
    }
    expect((await A.admin.get(url(a.label_code))).body.match_type).toBe('label_code');
    expect((await A.admin.get(url(a.asset_tag))).body.match_type).toBe('asset_tag');
  });

  it('answers 401 without a credential, identically for existing and unknown codes (nothing is revealed)', async () => {
    const anon = new Client(app);
    const known = await anon.get(`/v1/scan/resolve?code=${assets[0]!.label_code}`, {
      cookie: false,
    });
    const unknown = await anon.get(`/v1/scan/resolve?code=${randomUUID().replace(/-/g, '')}`, {
      cookie: false,
    });
    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    const strip = (b: Record<string, unknown>) => ({
      ...b,
      request_id: undefined,
      instance: undefined,
    });
    expect(strip(known.body)).toEqual(strip(unknown.body));
    expect(known.raw).not.toContain(assets[0]!.asset_tag);
  });

  it('a code of another tenant, an unknown code and a malformed code are the same 404', async () => {
    const mine = assets[1]!;
    const answers = [
      await B.admin.get(`/v1/scan/resolve?code=${mine.label_code}`),
      await B.admin.get(
        `/v1/scan/resolve?code=${encodeURIComponent(`https://x.example/s/${mine.label_code}`)}`,
      ),
      await B.admin.get(`/v1/scan/resolve?code=${mine.asset_tag}`),
      await B.admin.get(`/v1/scan/resolve?code=${randomUUID().replace(/-/g, '')}`),
    ];
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not-found');
      expect(res.raw).not.toContain(mine.id);
    }
    expect(new Set(answers.map((r) => r.body.detail)).size).toBe(1);
  });

  it('a caller whose lookups keep missing is throttled for the rest of the window; hits never count', async () => {
    const scanner = await createUser(app, A, 'technician');
    const hit = `/v1/scan/resolve?code=${assets[2]!.label_code}`;
    // plenty of hits: not counted
    for (let i = 0; i < 8; i++) expect((await scanner.client.get(hit)).status).toBe(200);
    // ten misses are answered 404 ...
    for (let i = 0; i < 10; i++) {
      expect((await scanner.client.get(`/v1/scan/resolve?code=miss-${i}`)).status).toBe(404);
    }
    // ... then the caller is blocked before any lookup, whatever the code
    for (const url of [`/v1/scan/resolve?code=miss-x`, hit]) {
      const blocked = await scanner.client.get(url);
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('too-many-requests');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    }
    // another user of the same tenant, and the other tenant, are unaffected
    const other = await createUser(app, A, 'viewer');
    expect((await other.client.get(hit)).status).toBe(200);
    expect((await A.admin.get(hit)).status).toBe(200);
    expect((await B.admin.get('/v1/scan/resolve?code=nope')).status).toBe(404);
  });
});
