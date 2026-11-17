# ADR-0002: Web routing under Next.js static export (query-string detail routes)

- Status: accepted (M1-WEB-10 spike, 2026-11-17)
- Deciders: Claude (frontend), founder informed
- Relates to: architecture section 3 ("web as a Next.js static export"), technical validation item 6, backlog M1-WEB-10 / M1-WEB-01

## Context

The web app is a Next.js 16.4 App Router app built with `output: 'export'` and served as plain files (S3 + CloudFront in Cloud, the Caddy image in Self-hosted). There is no Node runtime, so no SSR, no `rewrites`/`redirects`/`headers`, no Proxy (middleware), no Server Actions, no cookies API and no default image optimisation. Detail pages (`/assets/<id>`) are the problem: the id is only known at runtime, and a static export can only emit pages for params known at build time.

Two options were evaluated:

- **A. Query-string detail routes**: every route is a real prerendered page; the id is a query parameter (`/assets/view?id=<uuid>`) read on the client with `useSearchParams()` inside `<Suspense>`.
- **B. Optional catch-all shell**: one page `app/[[...path]]/page.tsx` with `generateStaticParams` returning the empty path, a client-side router inside it, and the host serving that shell for every unknown path.

## Decision

**Option A: query-string detail routes**, plus a **404 fallback** at the edge for unknown paths, with a client-side resolver in `app/not-found.tsx` for QR deep links (`/s/<code>` redirects to `/assets/view?code=<code>`).

Rules applied by M1-WEB-01 and every later screen:

1. Detail and edit pages are fixed paths with a query string: `/assets/view?id=`, `/assets/edit?id=`, `/locations/view?id=`, and so on. Tab and drawer state also lives in the query string.
2. Finite, build-time-known sets (for example `/settings/[section]`) may use `generateStaticParams` with `dynamicParams = false`. Unbounded ids never do.
3. Pages that read `useSearchParams()` wrap the reader in `<Suspense>` (required for export; the fallback is what is prerendered).
4. `trailingSlash: true` (already configured): every page is `<route>/index.html`, which is the one layout both CloudFront (with a viewer-request function) and Caddy (`try_files`) can serve with no redirect rules.
5. QR labels encode `https://<host>/s/<code>`. That URL is permanent once printed, so the edge fallback described below is a hard requirement of every deployment, covered by the e2e suite.

## Evidence

Everything below was run in this repo (Chrome 157 driven by Playwright 1.65; `apps/web/e2e/routing.spec.ts`, 8 cases kept forever: direct load, hard reload, with and without trailing slash, missing id, client navigation + back + forward + reload, `/settings/<section>` direct load and reload, `/s/<code>` resolution, unknown path, unknown settings section).

| Target / fallback mode | Result |
|---|---|
| `next dev` | 8/8 pass |
| static `out/`, unknown paths served `404.html` with status 200 (CloudFront custom error response with 200, Caddy rewrite) | 8/8 pass |
| static `out/`, unknown paths served `404.html` with status **404** (plain static host, CloudFront with the response code left at 404) | 8/8 pass |
| static `out/` with Caddy-style `/dir` to `/dir/` 308 redirect (query string preserved) | 8/8 pass |
| static `out/`, unknown paths served **`index.html`** (what `serve -s` does) | 5/8: all query-string and prerendered routes pass; the 3 cases that depend on unknown paths (`/s/<code>`, unknown page, unknown settings section) fail, because the dashboard HTML is hydrated at a URL it was not rendered for |

`curl` against the static server: `/assets/view/?id=<uuid>` and `/assets/view?id=<uuid>` both return 200 with the prerendered `assets/view/index.html` (5629 B); `/settings/users` returns the prerendered settings page; `/s/AB12CD34` and `/no/such/page` return 200 with `404.html`; a missing `/_next/static/*.js` returns a real 404 (the SPA fallback must never answer asset requests).

Build note: on Windows, Next 16.4.6 writes the per-segment prefetch files (`__next.<segment>.__PAGE__.txt`) into nested directories instead of flat files (it joins segment paths with `path.relative`, which uses backslashes), so the client's prefetch requests return 404 and Next silently falls back to a normal navigation. Pages, deep links and refresh are unaffected. Release builds come from Linux (CI, Docker), where the flat files are emitted; treat a Windows `out/` as a dev artefact.

Key conclusions:

- A query-string route needs **no fallback at all**: the path is a real file, so refresh, deep links and bookmarks work on any static host, in the same way in `next dev` and the export. This is the property that makes it the safer default.
- The only paths that need a fallback are the ones that can never be enumerated (QR codes, typos, old links). They are served `404.html`, which Next already exports from `app/not-found.tsx`. That page is a client component: it reads the real URL with `usePathname()` and redirects `/s/<code>`.
- The fallback target must be `404.html`, **not** `index.html`: serving the dashboard HTML at an arbitrary URL is not a supported hydration case (row 5 above).

### Option B evidence (rejected)

Reproduce with `spikes/web-routing/` (a catch-all page at `/spike/[[...path]]`, shell served for every `/spike/**` miss, real browser):

| Action | Observed |
|---|---|
| Deep link `/spike/assets/abc-123` | renders, but React logs **hydration error #418** on every load (the HTML was rendered for `/spike`, the URL is different) |
| `useParams()` | `{}` for every URL; only `usePathname()` carries the real path, so the app must run its own router (TanStack Router or similar) inside the shell |
| `<Link>` click and `router.push` to another id | Next requests the RSC payload (`/spike/assets/xyz-789/index.txt`, `__next._tree.txt`), gets **404**, and falls back to a **full page load** (every navigation re-downloads and re-hydrates the app) |
| reload, back | work (they are full loads), with the same #418 error in the console |

So the catch-all shell works only by giving up Next.js routing, prefetching and soft navigation, while still logging hydration errors, and it needs a shell-specific rewrite rule at each edge. The technical validation (item 6) flagged the same placeholder approach as fragile; the spike confirms it.

## Consequences

- Positive: refresh and deep links work identically in dev, in the export and on every host; no per-edge routing rules except the generic 404 fallback; Next prefetch and soft navigation keep working; routes stay type-checkable and lintable.
- Negative: URLs have a query string (`/assets/view?id=...`) instead of a path. Mitigation: the app exposes helpers (`routes.assetView(id)`) so URLs are built in one place, and a path-style URL can be added later at the edge without touching the app.
- A CI check (`apps/web/scripts/check-static-export.mjs`, wired into `pnpm build`, unit-tested) fails the web build on: `proxy`/`middleware` files, `rewrites`/`redirects`/`headers` in the production config (the dev-only `/v1` proxy is evaluated in the development phase and allowed), `'use server'`, `next/headers`, `next/server`, route handlers other than GET with `dynamic = 'force-static'`, dynamic segments without `generateStaticParams` (or with `dynamicParams = true`), and `next/image` without `images.unoptimized` or a custom loader. After the build it also asserts `out/index.html` and `out/404.html` exist and that the build emitted no user redirects/rewrites/headers or middleware bundle.

## Edge requirements (for M4 Caddy and M6 CloudFront)

Both edges must: serve `<route>/index.html` for `/route` and `/route/`; serve `404.html` for any other extension-less path; **never** apply that fallback to paths with a file extension (missing chunks must stay 404); cache `_next/static/*` immutable and HTML `no-cache`; set security headers themselves (Next cannot).

Caddy (self-hosted image; `/v1` stays a reverse proxy):

```caddyfile
{$SITE_ADDRESS} {
	root * /srv/web
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		Content-Security-Policy "<build-time script hashes, see architecture section 9>"
	}
	@static path /_next/static/*
	header @static Cache-Control "public, max-age=31536000, immutable"
	handle /v1/* {
		reverse_proxy api:3000
	}
	handle {
		try_files {path} {path}/index.html
		file_server
	}
	handle_errors {
		@notfound expression {err.status_code} == 404
		handle @notfound {
			rewrite * /404.html
			file_server
		}
	}
}
```

(`handle_errors` keeps the 404 status; the browser still renders and hydrates the exported not-found page, verified by the "status 404" row above. Use `rewrite` plus status 200 instead if QR scans must not look like errors in access logs.)

CloudFront (S3 REST origin with OAC, `/v1/*` to the ALB):

- Viewer-request function on the default behaviour: if the URI ends with `/`, append `index.html`; else if the last path segment has no `.`, append `/index.html`. The query string is not part of the URI, so `?id=` is untouched.
- Custom error responses for 403 and 404 (S3 with OAC answers 403 for missing keys): response page path `/404.html`, **response code 404** (keeps missing chunks honest; 200 also works for pages, per the table, but would hide a broken chunk URL as an HTML document).
- Response-headers policy carries CSP, HSTS, frame-ancestors and referrer policy; `_next/static/*` gets a long-cache behaviour, HTML behaviours use `no-cache`; old releases' hashed assets are retained so open tabs can still lazy-load chunks.

## Alternatives considered

- Catch-all shell with a client router: rejected (evidence above).
- `/assets/<id>` with a single placeholder page and an edge rewrite: not a documented Next pattern and `useParams()` returns the placeholder (technical validation item 6); also needs a per-edge rewrite.
- Hash routing (`/#/assets/<id>`): works everywhere but defeats Next routing and breaks QR/URL hygiene.
- Dropping `output: 'export'` for a Node server: contradicts architecture section 3 (no process to run in Cloud; identical bundle for Self-hosted).
