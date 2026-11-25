import path from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/**
 * Production is a static export (`out/`), served by S3 + CloudFront (or Caddy self-hosted) with
 * `/v1` routed to the API at the edge, so no API URL is baked in.
 *
 * `rewrites()` is not allowed with `output: 'export'`, so the dev-only `/v1` proxy exists only
 * in the dev-server phase; `next build` never sees it (CI also fails on rewrites in the build).
 */
export default function config(phase: string): NextConfig {
  const base: NextConfig = {
    reactStrictMode: true,
    images: { unoptimized: true },
    trailingSlash: true,
    turbopack: { root: path.resolve(__dirname, '../..') },
    // The mock API (MSW) is compiled in only for `dev:mock` and `build:mock`. Always defining the
    // flag makes it a build-time constant, so the production build drops the mock import as dead
    // code (verified by the `--built` check: no msw or mock code in out/).
    env: { NEXT_PUBLIC_API_MOCKS: process.env.NEXT_PUBLIC_API_MOCKS === '1' ? '1' : '0' },
    // `build:mock` writes its export to out-mock/ so it never overwrites the production `out/`.
    ...(process.env.AT_EXPORT_DIR ? { distDir: process.env.AT_EXPORT_DIR } : {}),
  };

  if (phase === PHASE_DEVELOPMENT_SERVER) {
    const apiUrl = process.env.API_PROXY_URL ?? 'http://localhost:3000';
    // Opening the dev server from another device (http://<LAN-IP>:3001): Next blocks cross-origin dev
    // resources (its assets, HMR websocket) from hosts it does not know. DEV_ALLOWED_ORIGINS is a comma list
    // of hostnames or IPs, e.g. "192.168.1.101,my-laptop.local". Dev-server phase only; the export never sees it.
    const allowedDevOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    return {
      ...base,
      ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
      // Keep the exact /v1/health path; trailing-slash redirects would break the API.
      skipTrailingSlashRedirect: true,
      async rewrites() {
        return [{ source: '/v1/:path*', destination: `${apiUrl}/v1/:path*` }];
      },
    };
  }

  return { ...base, output: 'export' };
}
