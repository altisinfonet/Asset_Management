// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkMockEnv,
  scanForMockCode,
  scanSource,
} from '../../scripts/lib/static-export-check.mjs';

let root: string;

function write(rel: string, content: string) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function rules() {
  return scanSource(root).violations.map((v) => v.rule);
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'static-check-'));
  write('src/app/page.tsx', 'export default function P() { return null; }\n');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('static-export source scan', () => {
  it('accepts a clean app, including a generateStaticParams route and a force-static GET handler', () => {
    write(
      'src/app/settings/[section]/page.tsx',
      'export const dynamicParams = false;\nexport function generateStaticParams() { return [{ section: "a" }]; }\nexport default function P() { return null; }\n',
    );
    write(
      'src/app/health/route.ts',
      "export const dynamic = 'force-static';\nexport function GET() { return new Response('ok'); }\n",
    );
    expect(rules()).toEqual([]);
  });

  it.each([
    ['src/proxy.ts', 'export function proxy() {}\n', 'middleware-proxy'],
    ['src/middleware.ts', 'export function middleware() {}\n', 'middleware-proxy'],
    ['middleware.js', 'export function middleware() {}\n', 'middleware-proxy'],
    ['src/app/actions.ts', "'use server';\nexport async function save() {}\n", 'server-action'],
    [
      'src/app/cookie.ts',
      "import { cookies } from 'next/headers';\nexport const c = cookies;\n",
      'cookies-headers-api',
    ],
    [
      'src/app/req.ts',
      "import { NextResponse } from 'next/server';\nexport const r = NextResponse;\n",
      'next-server',
    ],
    [
      'src/app/api/x/route.ts',
      'export async function GET() { return new Response("x"); }\n',
      'route-handler',
    ],
    [
      'src/app/api/y/route.ts',
      "export const dynamic = 'force-static';\nexport async function POST() { return new Response('x'); }\n",
      'route-handler',
    ],
    [
      'src/app/assets/[id]/page.tsx',
      'export default function P() { return null; }\n',
      'dynamic-route-without-params',
    ],
    [
      'src/app/docs/[[...path]]/page.tsx',
      'export default function P() { return null; }\n',
      'dynamic-route-without-params',
    ],
    [
      'src/app/things/[id]/page.tsx',
      'export const dynamicParams = true;\nexport function generateStaticParams() { return []; }\nexport default function P() { return null; }\n',
      'dynamic-params-true',
    ],
  ])('flags %s', (file, content, rule) => {
    write(file, content);
    expect(rules()).toContain(rule);
  });

  it('ignores forbidden strings that only appear in comments', () => {
    write(
      'src/app/note.ts',
      "// 'use server' is not allowed; do not import from 'next/headers'\nexport const x = 1;\n",
    );
    expect(rules()).toEqual([]);
  });

  it('records next/image usage so the config check can require an unoptimized or custom loader', () => {
    write('src/app/img.tsx', "import Image from 'next/image';\nexport const I = Image;\n");
    expect(scanSource(root).usesNextImage).toBe(true);
  });
});

describe('mock API must not reach the production export', () => {
  it('flags the MSW service worker left in public/', () => {
    write('public/mockServiceWorker.js', '// msw');
    expect(rules()).toContain('mock-service-worker-in-public');
  });

  it('flags NEXT_PUBLIC_API_MOCKS=1 on a production build, but allows build:mock (AT_EXPORT_DIR set)', () => {
    expect(checkMockEnv({ NEXT_PUBLIC_API_MOCKS: '1' }).map((v) => v.rule)).toEqual([
      'mock-api-in-production-build',
    ]);
    expect(checkMockEnv({ NEXT_PUBLIC_API_MOCKS: '1', AT_EXPORT_DIR: 'out-mock' })).toEqual([]);
    expect(checkMockEnv({})).toEqual([]);
  });

  it('finds the worker file and mock marker strings inside an export directory', () => {
    write('out/index.html', '<html></html>');
    write('out/_next/static/chunks/app.js', 'console.log("clean")');
    expect(scanForMockCode(path.join(root, 'out'))).toEqual([]);

    write('out/mockServiceWorker.js', 'worker');
    write('out/_next/static/chunks/mocks.js', 'localStorage.getItem("at-mock-state")');
    write('out/_next/static/chunks/lib.js', 'import "@mswjs/interceptors"');
    const found = scanForMockCode(path.join(root, 'out')).map((v) => v.file);
    expect(found.sort()).toEqual([
      '_next/static/chunks/lib.js',
      '_next/static/chunks/mocks.js',
      'mockServiceWorker.js',
    ]);
  });
});
