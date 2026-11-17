#!/usr/bin/env node
// @ts-check
/**
 * Tiny static file server for the Next.js static export (`out/`), used by the routing e2e tests
 * and for local smoke checks. It reproduces what the production edges must do:
 *
 *   1. exact file                     /_next/static/a.js           -> out/_next/static/a.js
 *   2. directory index                /assets/view  /assets/view/  -> out/assets/view/index.html
 *   3. `.html` sibling                /assets/view                 -> out/assets/view.html
 *   4. SPA fallback for unknown paths /s/AB12CD                    -> out/404.html (status 200)
 *
 * Modes (CloudFront function, Caddy and `serve` differ slightly):
 *   --fallback=404      (default) unknown paths get the exported `404.html` (client resolves the URL)
 *   --fallback=index    unknown paths get `index.html` (what `serve -s` does)
 *   --fallback=none     unknown paths get `404.html` with status 404 (a plain static host)
 *   --redirect-slash    redirect `/dir` to `/dir/` like Caddy `file_server` (query string preserved)
 *
 * Usage: node scripts/serve-static.mjs [outDir] [--port=4173] [--fallback=404|index|none]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
});

/** @param {string} p */
async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {{ root: string, fallback?: '404' | 'index' | 'none', redirectSlash?: boolean }} options
 */
export function createStaticServer({ root, fallback = '404', redirectSlash = false }) {
  const absRoot = path.resolve(root);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      const rel = path.normalize(pathname).replace(/^([/\\])+/, '');
      const target = path.join(absRoot, rel);
      if (!target.startsWith(absRoot)) {
        res.writeHead(403).end('forbidden');
        return;
      }

      /** @type {string | undefined} */
      let file;
      const hasExt = path.extname(pathname) !== '';
      if (hasExt && (await isFile(target))) file = target;
      else if (!hasExt) {
        const dirIndex = path.join(target, 'index.html');
        if (await isFile(dirIndex)) {
          if (redirectSlash && !pathname.endsWith('/')) {
            res.writeHead(308, { location: `${pathname}/${url.search}` }).end();
            return;
          }
          file = dirIndex;
        } else if (await isFile(`${target}.html`)) {
          file = `${target}.html`;
        }
      }

      let status = 200;
      if (!file) {
        if (hasExt) {
          // A missing asset is a real 404, never the SPA shell (would hide broken chunk URLs).
          res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
          return;
        }
        file = path.join(absRoot, fallback === 'index' ? 'index.html' : '404.html');
        status = fallback === 'none' ? 404 : 200;
      }

      const body = await readFile(file);
      res.writeHead(status, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': file.includes(`${path.sep}_next${path.sep}static`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (/** @type {string} */ name, /** @type {string} */ dflt) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
  const root = args.find((a) => !a.startsWith('--')) ?? 'out';
  const port = Number(flag('port', '4173'));
  const fallback = /** @type {'404' | 'index' | 'none'} */ (flag('fallback', '404'));
  const server = createStaticServer({
    root,
    fallback,
    redirectSlash: args.includes('--redirect-slash'),
  });
  server.listen(port, () => {
    console.log(`serving ${path.resolve(root)} on http://localhost:${port} (fallback=${fallback})`);
  });
}
