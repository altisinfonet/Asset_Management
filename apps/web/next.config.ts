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
  };

  if (phase === PHASE_DEVELOPMENT_SERVER) {
    const apiUrl = process.env.API_PROXY_URL ?? 'http://localhost:3000';
    return {
      ...base,
      // Keep the exact /v1/health path; trailing-slash redirects would break the API.
      skipTrailingSlashRedirect: true,
      async rewrites() {
        return [{ source: '/v1/:path*', destination: `${apiUrl}/v1/:path*` }];
      },
    };
  }

  return { ...base, output: 'export' };
}
