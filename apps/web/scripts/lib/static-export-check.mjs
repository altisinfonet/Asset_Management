// @ts-check
/**
 * Static-export feature check (M1-WEB-10, architecture section 3).
 *
 * The web app ships as a static export (S3 + CloudFront, or baked into the Caddy image), so the
 * build must fail when a feature that needs a Node runtime or edge config sneaks in:
 *
 *   - proxy.ts / middleware.ts                 (Proxy is unsupported with `output: 'export'`)
 *   - rewrites / redirects / headers           (production config; the dev-only /v1 proxy is allowed)
 *   - Server Actions ('use server')
 *   - cookies()/headers()/draftMode()          (`next/headers`) and `next/server`
 *   - route handlers, unless GET + `dynamic = 'force-static'`
 *   - dynamic route segments without `generateStaticParams` (or with `dynamicParams = true`)
 *   - `next/image` with the default loader     (`images.unoptimized` or a custom loader is required)
 *   - the mock API (MSW) leaking into the production build: the service worker file in `public/`,
 *     `NEXT_PUBLIC_API_MOCKS=1` during `next build`, or mock/msw code inside `out/`
 *
 * Pure functions here are unit-tested (src/lib/static-export-check.test.ts); the CLI is
 * scripts/check-static-export.mjs.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** @typedef {{ rule: string, file?: string, message: string }} Violation */

/** Strings that only exist in the mock layer (src/mocks, msw); none may appear in `out/`. */
const MOCK_MARKERS = ['mockServiceWorker', '@mswjs', 'msw/browser', 'at-mock-state'];
const TEXT_EXT = /\.(?:[cm]?js|html|json|txt|map|css)$/;

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const PAGE_FILE = /^page\.[cm]?[jt]sx?$/;
const LAYOUT_FILE = /^layout\.[cm]?[jt]sx?$/;
const ROUTE_FILE = /^route\.[cm]?[jt]sx?$/;
const DYNAMIC_SEGMENT = /^\[.+\]$/;

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'out') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Strip comments so a mention in a comment is not a violation. */
function stripComments(/** @type {string} */ source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * Scan the app's source tree.
 * @param {string} appRoot absolute path of apps/web
 * @returns {{ violations: Violation[], usesNextImage: boolean }}
 */
export function scanSource(appRoot) {
  /** @type {Violation[]} */
  const violations = [];
  let usesNextImage = false;
  const rel = (/** @type {string} */ f) => path.relative(appRoot, f).split(path.sep).join('/');

  // 1. proxy / middleware files
  for (const base of [appRoot, path.join(appRoot, 'src')]) {
    for (const stem of ['middleware', 'proxy']) {
      for (const ext of ['ts', 'js', 'mjs', 'cjs', 'tsx', 'jsx']) {
        const f = path.join(base, `${stem}.${ext}`);
        if (existsSync(f)) {
          violations.push({
            rule: 'middleware-proxy',
            file: rel(f),
            message: `${stem}.${ext} is not supported with output: 'export'`,
          });
        }
      }
    }
  }

  const worker = path.join(appRoot, 'public', 'mockServiceWorker.js');
  if (existsSync(worker)) {
    violations.push({
      rule: 'mock-service-worker-in-public',
      file: 'public/mockServiceWorker.js',
      message:
        'the MSW service worker in public/ would be copied into out/; delete it (dev:mock removes it on exit, build:mock never writes it there)',
    });
  }

  const srcDir = path.join(appRoot, 'src');
  // Test files are never bundled into the export.
  const files = walk(srcDir).filter(
    (f) => SOURCE_EXT.test(f) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f),
  );

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const code = stripComments(text);
    const name = path.basename(file);

    if (/(^|\n)\s*['"]use server['"]/.test(code)) {
      violations.push({
        rule: 'server-action',
        file: rel(file),
        message: "'use server' (Server Actions) is not supported with output: 'export'",
      });
    }
    if (/\bfrom\s+['"]next\/headers['"]|require\(\s*['"]next\/headers['"]\s*\)/.test(code)) {
      violations.push({
        rule: 'cookies-headers-api',
        file: rel(file),
        message: 'next/headers (cookies(), headers(), draftMode()) needs a server runtime',
      });
    }
    if (/\bfrom\s+['"]next\/server['"]|require\(\s*['"]next\/server['"]\s*\)/.test(code)) {
      violations.push({
        rule: 'next-server',
        file: rel(file),
        message:
          'next/server (NextRequest/NextResponse) is only for handlers/proxy, which are not exported',
      });
    }
    if (/\bfrom\s+['"]next\/image['"]|require\(\s*['"]next\/image['"]\s*\)/.test(code)) {
      usesNextImage = true;
    }

    if (ROUTE_FILE.test(name) && file.startsWith(path.join(srcDir, 'app'))) {
      const forced = /export\s+const\s+dynamic\s*=\s*['"]force-static['"]/.test(code);
      const otherMethods =
        /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE|OPTIONS)\b|export\s+const\s+(POST|PUT|PATCH|DELETE|OPTIONS)\b/.test(
          code,
        );
      if (!forced || otherMethods) {
        violations.push({
          rule: 'route-handler',
          file: rel(file),
          message:
            "route handlers are only allowed as GET with `export const dynamic = 'force-static'`",
        });
      }
    }
  }

  // 4. dynamic route segments
  const appDir = path.join(srcDir, 'app');
  for (const file of walk(appDir)) {
    const name = path.basename(file);
    if (!PAGE_FILE.test(name)) continue;
    const dir = path.dirname(file);
    const segments = path.relative(appDir, dir).split(path.sep).filter(Boolean);
    const firstDynamic = segments.findIndex((s) => DYNAMIC_SEGMENT.test(s));
    if (firstDynamic === -1) continue;

    // The page, or a layout from the first dynamic segment down, must export generateStaticParams.
    const candidates = [file];
    for (let i = firstDynamic; i <= segments.length; i++) {
      const segDir = path.join(appDir, ...segments.slice(0, i));
      if (existsSync(segDir)) {
        for (const f of readdirSync(segDir)) {
          if (LAYOUT_FILE.test(f)) candidates.push(path.join(segDir, f));
        }
      }
    }
    const texts = candidates.map((f) => stripComments(readFileSync(f, 'utf8')));
    const hasParams = texts.some((t) =>
      /export\s+(?:async\s+)?function\s+generateStaticParams\b|export\s+const\s+generateStaticParams\b/.test(
        t,
      ),
    );
    const dynamicParamsTrue = texts.some((t) =>
      /export\s+const\s+dynamicParams\s*=\s*true\b/.test(t),
    );
    if (!hasParams) {
      violations.push({
        rule: 'dynamic-route-without-params',
        file: rel(file),
        message: `dynamic route /${segments.join('/')} has no generateStaticParams(); use a query-string route (ADR-0002)`,
      });
    }
    if (dynamicParamsTrue) {
      violations.push({
        rule: 'dynamic-params-true',
        file: rel(file),
        message: 'dynamicParams = true is not supported with output: export',
      });
    }
  }

  return { violations, usesNextImage };
}

/**
 * The production build must not enable the mock API.
 * @param {Record<string, string | undefined>} env
 * @returns {Violation[]}
 */
export function checkMockEnv(env) {
  if (env.NEXT_PUBLIC_API_MOCKS === '1' && !env.AT_EXPORT_DIR) {
    return [
      {
        rule: 'mock-api-in-production-build',
        message:
          'NEXT_PUBLIC_API_MOCKS=1 would compile the mock API into out/; use `pnpm build:mock` (writes out-mock/) for mocked builds',
      },
    ];
  }
  return [];
}

/**
 * Scan an export directory for the mock layer: the service worker file or its marker strings.
 * @param {string} dir
 * @returns {Violation[]}
 */
export function scanForMockCode(dir) {
  /** @type {Violation[]} */
  const violations = [];
  for (const file of walk(dir)) {
    const rel = path.relative(dir, file).split(path.sep).join('/');
    if (path.basename(file) === 'mockServiceWorker.js') {
      violations.push({
        rule: 'mock-code-in-export',
        file: rel,
        message: 'MSW service worker found',
      });
      continue;
    }
    if (!TEXT_EXT.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    const hit = MOCK_MARKERS.find((marker) => text.includes(marker));
    if (hit) {
      violations.push({
        rule: 'mock-code-in-export',
        file: rel,
        message: `contains "${hit}": mock/msw code must never ship in the static export`,
      });
    }
  }
  return violations;
}

/**
 * Evaluate the *production build* configuration the way `next build` sees it.
 * The dev-only /v1 rewrite lives in the development-server phase and is deliberately not checked.
 * @param {string} appRoot
 * @param {boolean} usesNextImage
 * @returns {Promise<Violation[]>}
 */
export async function checkConfig(appRoot, usesNextImage) {
  /** @type {Violation[]} */
  const violations = [];
  const require = createRequire(path.join(appRoot, 'package.json'));
  const loadConfig = require('next/dist/server/config.js').default;
  const config = await loadConfig('phase-production-build', appRoot);

  if (config.output !== 'export') {
    violations.push({
      rule: 'output-export',
      file: 'next.config.ts',
      message: `output must be 'export' for the production build (got ${JSON.stringify(config.output)})`,
    });
  }
  for (const key of /** @type {const} */ (['rewrites', 'redirects', 'headers'])) {
    if (typeof config[key] === 'function') {
      violations.push({
        rule: key,
        file: 'next.config.ts',
        message: `${key}() in the production config is not supported with output: 'export'; configure it at the edge (CloudFront/Caddy)`,
      });
    }
  }
  if (usesNextImage) {
    const images = config.images ?? {};
    const customLoader = images.loader === 'custom' && !!images.loaderFile;
    if (!images.unoptimized && !customLoader) {
      violations.push({
        rule: 'next-image-default-loader',
        file: 'next.config.ts',
        message:
          'next/image is used but images.unoptimized is not true and no custom loader is set',
      });
    }
  }
  return violations;
}

/**
 * Post-build assertions on `.next` and `out/`.
 * @param {string} appRoot
 * @returns {Violation[]}
 */
export function checkBuilt(appRoot) {
  /** @type {Violation[]} */
  const violations = [];
  const out = path.join(appRoot, 'out');
  for (const f of ['index.html', '404.html']) {
    if (!existsSync(path.join(out, f))) {
      violations.push({
        rule: 'export-missing',
        file: `out/${f}`,
        message: `out/${f} was not produced`,
      });
    }
  }

  violations.push(...scanForMockCode(out));

  const routesManifest = path.join(appRoot, '.next', 'routes-manifest.json');
  if (existsSync(routesManifest)) {
    const manifest = JSON.parse(readFileSync(routesManifest, 'utf8'));
    for (const key of ['redirects', 'headers']) {
      // Next adds its own `internal: true` trailing-slash redirects; only user config counts.
      const user = Array.isArray(manifest[key])
        ? manifest[key].filter((/** @type {{ internal?: boolean }} */ r) => !r.internal)
        : [];
      if (user.length > 0) {
        violations.push({
          rule: key,
          file: '.next/routes-manifest.json',
          message: `build emitted ${user.length} ${key}, which a static host cannot serve`,
        });
      }
    }
    const rewrites = manifest.rewrites;
    const rewriteCount = Array.isArray(rewrites)
      ? rewrites.length
      : Object.values(rewrites ?? {}).reduce(
          (n, list) => n + (Array.isArray(list) ? list.length : 0),
          0,
        );
    if (rewriteCount > 0) {
      violations.push({
        rule: 'rewrites',
        file: '.next/routes-manifest.json',
        message: `build emitted ${rewriteCount} rewrites, which a static host cannot serve`,
      });
    }
  }
  for (const f of ['middleware-manifest.json', 'middleware.js', 'proxy.js']) {
    const p = path.join(appRoot, '.next', 'server', f);
    if (existsSync(p)) {
      const empty =
        f === 'middleware-manifest.json' &&
        Object.keys(JSON.parse(readFileSync(p, 'utf8')).middleware ?? {}).length === 0;
      if (!empty) {
        violations.push({
          rule: 'middleware-proxy',
          file: `.next/server/${f}`,
          message: 'build produced a middleware/proxy bundle',
        });
      }
    }
  }
  return violations;
}
