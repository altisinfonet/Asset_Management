# Project status

_Last updated: 2026-11-25 (v0.2.6, wave 3 part 2). Detailed story-level status lives in [05_backlog.md](05_backlog.md); this page is the
one-screen summary._

Related pages: [FEATURES.md](FEATURES.md) (every feature and its state) · [API.md](API.md) (API reference) ·
[VERSION.md](VERSION.md) (version history, current 0.2.6) · [AUDIT.md](AUDIT.md) (quality and security audit record).

Legend: ✅ done · 🟡 in progress / partly done · ⏳ not started · 👤 needs the founder

## 1. Overall

| Phase                                   | Status | Notes                                                                                     |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| Research, plan, architecture            | ✅     | `01`–`03` docs; all 28 plan decisions adopted                                             |
| Validation (desk + hands-on)            | ✅     | [04_validation_report.md](04_validation_report.md); real-customer validation happens in the M4 beta |
| Sprint 0 (scaffold, data model, design) | ✅     | Monorepo, API contract, design system, backlog                                            |
| **M1** Tenancy, sign-in, asset registry | ✅     | Accepted by the founder walk-through on 2026-11-19                                        |
| **M2** Custody, labels, import          | 🟡     | Waves 1 and 2 merged; review fixes, managed departments and location editing done (v0.2.4); wave 3 part 1 released as v0.2.5 (import backend and wizard, loaner pools, desk and dashboard, three deferred stories); location scoping for roles released as v0.2.6; isolation harness extension, performance harness, user guides and the import trial to come |
| **M3** Expo mobile app                  | ⏳     |                                                                                           |
| **M4** Self-hosted edition (first real users) | ⏳ |                                                                                         |
| **M5** Snipe-IT importer, reports, webhooks, licences | ⏳ |                                                                                |
| **M6** Cloud SaaS launch                | ⏳     |                                                                                           |

## 2. M1 — done ✅

Sign-in (passwords, two-step verification incl. turn off / new recovery codes, invitations, password reset,
sessions, roles and permissions), tenant isolation proven by tests (route replay, direct and through PgBouncer),
asset registry (categories with custom fields, manufacturers, models, status labels, vendors, assets with
automatic tags, search, bulk edit, archive/restore, clone), web admin, platform services (audit log, outbox,
jobs, encrypted secrets, email), CI and security scanning.

## 3. M2 — custody, labels and import 🟡

### Wave 1 — merged ✅

| Area                                                                  | Status | Stories |
| --------------------------------------------------------------------- | ------ | ------- |
| Locations tree (site › building › room), moves                        | ✅     | LOC-01, LOC-04 · LOC-02 🟡 (default location on model/category not built) |
| People (with or without login)                                        | ✅     | USR-01 · USR-02 🟡 (no link-to-login action yet → USR-03) |
| Check-out / check-in (condition, photos) / transfer, dispose, lost & found | ✅ | LIFE-01…05, LIFE-07 |
| Chain-of-custody history                                              | 🟡     | LIFE-06 (works; minor gaps noted in backlog) |
| USB barcode scanner + scan panel                                      | 🟡     | LIFE-08 (needs a real-scanner test 👤) |
| Files: storage, virus scanning (ClamAV), thumbnails, upload security  | ✅     | FILE-01…04, SEC-02 |
| QR / scan-code lookup                                                 | ✅     | TAG-01 |

### Wave 2 — merged ✅

| Area                                                       | Status | Stories |
| ---------------------------------------------------------- | ------ | ------- |
| Label sheets (PDF, QR + Code128, 6 templates, start position) | ✅  | TAG-02, TAG-03 |
| Accessories and consumables, low-stock alerts              | ✅     | ACC-01…04 |
| Repair log                                                 | ✅     | MNT-01, MNT-02 |
| Notifications (in-app + email, preferences)                | ✅     | NOT-01, NOT-02 |
| Saved views (server-side, shareable), CSV export           | ✅     | REG-01, REG-02 |
| MFA policy shown up front on the Security page             | ✅     | AUTH-01 |
| Test-suite stability fix (connection pool, parallelism)    | ✅     | — |

Wave 2 verified on the merged code: API e2e 566/566 (direct and through PgBouncer), real-stack browser tests 30/30. One unidentified intermittent API test failure was seen in 1 of 5 runs under extra load; watch the first CI runs.

### Fixes after founder review (2026-11-24) ✅

| Fix                                                                                  | Status |
| ------------------------------------------------------------------------------------ | ------ |
| Dashboard: real counts (Ready, Assigned, Not deployable, Overdue) + "Needs attention" panels (overdue check-outs, low stock, open repairs); tiles link to the filtered asset list | ✅ |
| Sidebar: "Accessories and consumables" shortened to "Stock"; tooltips for truncated / collapsed items | ✅ |
| "In repair" state renamed "Not deployable" (it covers every undeployable status, e.g. Broken) | ✅ |
| Demo data: every asset labelled "In repair" now has an open repair (the Repairs page, dashboard and status labels agree); "Broken" assets have none | ✅ |
| Asset form, asset page and bulk edit say so when an asset is not deployable but has no open repair, with a "Log a repair" shortcut (never blocks); a repair logged for an asset already "In repair" takes the status over and returns it to ready when closed | ✅ |

### Founder requests (2026-11-24) ✅

| Request                                                                                  | Status |
| ---------------------------------------------------------------------------------------- | ------ |
| "Location edit for a site: an error at edit time, none later" (LOC-05, ED-16): the error was an address value over its limit (typically a country name instead of the two-letter code) that the dialog could not place on a field. Now named on its field with the fix, limits checked before saving, a "Reload latest" action after a stale save, the address kept when the type changes, address line 2 no longer dropped. The type of a location stays freely editable | ✅ |
| "Free text causes mistakes": managed departments (ORG-01, ORG-02, ED-17): Settings → Departments (create, rename, archive, merge), a department picker on people and assets (also in bulk edit), department column and filter on both lists, optional owning department on assets, existing free text migrated to departments, demo departments seeded | ✅ |

### Deferred wave-1 stories done early (0.2.5) ✅

| What | Stories |
| ---- | ------- |
| Sort the assets list by location, assignee and due date (empty values last, paging exact; ED-22) | REG-03 ✅ |
| Link and unlink a person and a login account from the person page and Settings → Users (ED-22) | USR-03 ✅ |
| Undo toast after a check-out, check-in or transfer, single and bulk (ED-23) | UX-02 ✅ |

### Wave 3 — part 1 done ✅ (v0.2.5, 2026-11-24)

| Area                                                            | Stories |
| --------------------------------------------------------------- | ------- |
| CSV / XLSX import: engine, API, wizard with dry run, Google Admin ChromeOS template, templates, saved mappings, data retention (ED-25) ✅; waiting for the founder's real files (F-09) 👤 | IMP-01…08 done, IMP-09 open |
| Loaner pools: pools, desk, dashboard, quick loan and return by scanning, overdue and due-soon alerts (also by mail to borrowers without a login), loan length order and "next available" by idle time (ED-24), default return date pre-fill ✅ (ADR 0011) | LOAN-01…04, LIFE-09 done |

### Wave 3 — part 2: location scoping done ✅ (v0.2.6, 2026-11-25)

| Area | Stories |
| ---- | ------- |
| Location scoping for roles: a role assignment limited to a location subtree on Settings → Users; outside it everything looks not found (404) and lists, search, scan, counts, the loaner dashboard, exports, imports, labels and notification recipients stay inside it; org-only permissions (users, roles, keys, catalogue, departments, notification rules) are never granted by a scoped assignment; "Scoped to" in the top bar; scoped route replay over every route (ED-26, migration 0150) ✅ | M2-LOC-03 done |

### Wave 3 — part 2: test harnesses

| Area | Stories |
| ---- | ------- |
| Isolation harness extension: every tenant table and every foreign key probed across tenants from the database catalogue, named cross-tenant inserts (assignment, loan, repair, import row, pool membership, attachment), tenant-prefixed object keys and tampered file URLs refused (local and S3), every job type through the payload lint; direct and through PgBouncer. Found and fixed: attachment owners are now checked by the database (migration 0170, ED-28), and the root cause of the intermittent check-in 500 (partition DDL deadlock) ✅ | M2-SEC-01 done |
| Performance harness extension: nightly budgets for check-out, scan resolve, the 500-label PDF, a location-scoped user's list / search / lookups (ED-26) and import throughput and dry run, published as `test-results/*.json` ✅ | M2-OPS-01 done |

### Fixes found while writing the user guides (ED-29) ✅ (unreleased)

| Fix | Status |
| --- | ------ |
| Loaner desk: "Lend next available device" (shows the device the pool picked); a device In repair, Broken or Retired is refused when scanned, naming its status | ✅ |
| Import dry run: rows that need a new category, model, location, department or person are checked like the others (rehearsed and rolled back), so no per-row "checked at commit"; what still waits for the commit is said once | ✅ |
| Google Admin import: org unit -> department (no locations created), Disabled / Deprovisioned -> Retired | ✅ |
| People and Stock fit a 1280 px window; Assets scrolls inside its table with the tag pinned | ✅ |
| "Overdue check-outs" (dashboard, loans included) vs "Overdue loans" (loaner overview); the loan default hint explains the 7-day pool fallback | ✅ |

### Next: wave 3 part 2 (rest)

In this order: SEC-01 (isolation-harness extension), OPS-01 (performance harness), DOC-01 (user guides), IMP-09 (waiting on the founder's sample data, F-09 👤), then the founder acceptance walk-through M2-UX-01 👤.

## 4. Waiting on the founder 👤

**Decisions / sign-offs**

- [ ] ADRs still marked PROPOSED: 0003 (module boundaries & API conventions), 0004 (platform services),
      0005 (asset registry), 0006 (files & scanning), 0007 (labels), 0008 (accessories & consumables),
      0009 (repairs, notifications, views, export), 0011 (loaner pools). ADR 0001 and 0002 are accepted.
- [ ] Product name and primary colour (placeholders "Asset Tracker", blue) — before M3 store testing (F-30).

**Hardware / data for M2 acceptance**

- [ ] Real label stock + printer and a USB barcode scanner for print/scan calibration (F-02, M2-TAG-04).
- [ ] An anonymised real asset spreadsheet and a Google Admin ChromeOS export for the import trial (F-09).

**GitHub**

- [ ] Verify `milan@altisinfonet.in` on the GitHub account so commits are credited.
- [ ] Replace `@OWNER` in `.github/CODEOWNERS`; set branch protection + required checks (see `docs/engineering/ci.md`).
- [ ] Check the first GitHub Actions runs; disable CodeQL if the repo has no GitHub Advanced Security.
- [ ] Review the two open Dependabot PRs (GitHub Actions: likely fine; OpenTelemetry exporter: check, it was pinned on purpose).

**Long lead-time accounts (start early)**

- [ ] D-U-N-S number (F-05) → Apple Developer (F-06) and Google Play organisation account (F-07), needed for M3.
- [ ] Legal entity details, legal documents (F-04, F-11) before M4 real users.
- [ ] Design-partner recruitment, 5–10 partners before the M4 self-hosted beta (F-10).

The full founder task list with timing is in [05_backlog.md](05_backlog.md) (F-01 … F-30).

## 5. Known gaps carried forward

- Label printing die-lines are unverified until the founder's print test (M2-TAG-04).
- Loan and import notifications are wired. The tenant day of the loan alerts is UTC (there is no tenant time zone setting yet, ED-21).
- Finished imports lose their rows, samples and file after 30 days (ED-25): download the error report first. The before-images for a v1.1 rollback go with them.
- API details the web works around (found while integrating the wizard): a draft import's `mapping` is `{}` although the contract lists `columns` as required; `import-wrong-state` / `import-stale-dry-run` / `import-quota-exceeded` carry `state`, `allowed`, `current_digest` as top-level members that the `Problem` schema does not list; a commit's `progress.total` counts every row but `processed` only the rows to write; `.csv` files that Windows reports as `application/vnd.ms-excel` are refused by the attachment type check (the web declares `text/csv`); a saved default of a mapping cannot be cleared; the values endpoint has no entries for location imports.
- Some API-only options have no UI yet: label copies/outlines/logo, force check-in when opening a repair,
  notification delivery log.
- Timeline: will be re-estimated now that M1 and most of M2 show the real pace (decision 22).
