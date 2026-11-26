# Version history

What changed, release by release. Newest first. Format follows [Keep a Changelog](https://keepachangelog.com/):
each release lists **Added**, **Changed**, **Fixed** and **Security**. For what each feature does see
[FEATURES.md](FEATURES.md); for how it was verified see [AUDIT.md](AUDIT.md); for the API see [API.md](API.md).

**Current version: 0.2.8** (milestone M2, close-out before the founder walk-through). Tag `v0.2.8`; see the entry below for the commit.

## Versioning scheme

`0.<milestone>.<release>`, while the product is pre-1.0 (no external users yet; the first real users arrive with the
self-hosted edition in M4).

| Part          | Meaning                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`           | Major: stays 0 until the first stable release (planned after M6). The API itself is versioned separately (`/v1`).                                                                     |
| `<milestone>` | The delivery milestone from the backlog: `1` = M1 ... `6` = M6.                                                                                                                       |
| `<release>`   | Counts releases inside the milestone: one number per merged wave or per batch of fixes. M1 shipped as a single release, `0.1.0`. M2 started at `.1` (wave 1), so `0.2.0` is not used. |

Examples: `0.1.0` = M1; `0.2.1` = M2 wave 1; `0.2.2` = M2 wave 2; `0.2.3` = fixes after the founder review. Planned: `0.2.4` =
M2 wave 3 (import, loaners, location scoping), `0.3.x` = M3 mobile app, `0.4.x` = M4 self-hosted edition (first real users).
A release is a merge to `main` that passed the verification in [`engineering/contributing.md`](engineering/contributing.md);
its entry here names that commit, and the commit is tagged `v<version>` (annotated tag).

### Where the version is defined

Since 2026-11-24 the version is set in every workspace `package.json` (root, `apps/api`, `apps/web` and the three packages),
all kept equal; **`apps/api/package.json` is the source of truth**. `GET /v1/version` returns `config.APP_VERSION` when that
environment variable is set and otherwise the `version` of `apps/api/package.json`, plus the commit from `GIT_SHA`. The OpenAPI
contract has its own version, `info.version` in `engineering/tools/gen.mjs` (`1.0.0-m2`), which tracks the API contract, not
releases.

**Releasing a version:** bump all six `package.json` versions together, add the entry below, merge to `main`, then tag that
commit (`git tag -a v0.2.4 -m "0.2.4: …"`) and push the tag.

**Tags:** `v0.1.0` (`6634c54`), `v0.2.1` (`916b15c`) and `v0.2.2` (`2f7c467`) were added afterwards on their release merges;
their `package.json` files still say `0.0.0` because versions were only introduced with 0.2.3. `v0.2.3` points at the commit
that set the versions (the release content itself is `2d9a14b` plus that commit).

---

## 0.2.8 - 2026-11-26 - M2 close-out before the founder walk-through

The gaps found while preparing the founder acceptance walk-through (M2-UX-01) are closed: web screens for what the API
already did (lost, found and dispose; bulk move), a real Settings landing page, and the guide and doc differences. Also
released: the import test corpus (branch `imp-09-corpus`, M2-IMP-09 first criterion, ED-31) and the walk-through checklist
(branch `m2-acceptance`, `docs/acceptance/m2-walkthrough.md`, 45 steps, updated for this release). Branch `m2-closeout` =
`main` (`d1f826c`) plus no-fast-forward merges of both branches, the fixes and these docs; the release commit is tagged
`v0.2.8`. One contract change (`Person.is_login_placeholder` and the unlink 409, ED-33), no migration. Verification: [AUDIT.md](AUDIT.md) B.32.

### Added

- **Lost, found and dispose on screen** (M2-LIFE-05, ED-32): on the asset page **Mark as lost or stolen** (also while the
  asset is checked out: the window says the check-out ends, and it does), **Mark as found** (a ready status and "Where is
  it now?") and **Dispose** (reason, date, note; the asset is archived and its page says "Disposed of on ...: <reason>").
  A refusal stays in the window; "N accessory units are still checked out to this asset. Check them in on the Stock page
  first." replaces the raw usage counts of that 409 (also when archiving).
- **Bulk dispose**: **Dispose of N assets** in the asset list's bulk bar, one request per asset with a result per asset;
  checked-out assets in the selection are left out with a message.
- **Bulk move**: **Location** in the bulk **Edit** (`POST /v1/assets/bulk-move`), with a note for each asset's history;
  "No location" clears it. A user limited to a site picks only places inside it and cannot clear the location (ED-26).
- **Settings > Organisation** replaces the "Organisation is not built yet" placeholder: the organisation's name, plan and
  currency (shown; no API changes them yet), the check-out defaults (also on the loaner pools page) and the file settings
  (largest upload in MB, never above the plan, and EXIF removal from photos).
- **Import test corpus** (M2-IMP-09): 17 messy files checked in under `apps/api/test/importer/fixtures/corpus`
  (UTF-8 with a BOM, UTF-16 LE "Unicode text", Windows-1252, mixed line endings, semicolons with European decimals and
  dates, quoted delimiters and line breaks, an unclosed quote, title and merged header rows in CSV and XLSX, trailing
  empty columns and rows, header spacing and case, duplicate serials and tags, blank required cells, values over the
  length limits, a cell over the reader cap, XLSX dates, text numbers, formulas, error cells and hidden sheets, formula
  injection), each run through upload, analysis, mapping, dry run and commit in every API e2e run; a generated 100,000-row
  messy file in the nightly perf job (2,000 rows in every e2e run).
- **Founder walk-through checklist** (M2-UX-01): `docs/acceptance/m2-walkthrough.md`, 45 steps with the exit-criteria
  map, the hardware and real-file steps marked; steps 2, 4, 5, 13, 18, 38, 39 and 44 updated for this release.

### Changed

- **A lost or retired status picked by hand** in the asset form or the bulk edit shows a note that it does not close the
  check-out or archive the asset, with **Mark as lost instead** / **Dispose instead** in the form. Saving it is still
  allowed (the API is unchanged, ED-32).
- **Theme**: the System / Light / Dark switch in the sidebar footer (0.2.7, GitHub PR #15) is removed with its test and
  its `theme.systemShort` message; the top bar's **Theme** menu (and the command palette) is the only theme control. The
  design system, the guides index, FEATURES, STATUS and walk-through step 2 say so; the guide screenshot that showed the
  sidebar footer (`06-scoped-assets.png`) is re-shot.
- **Import row errors for a value over its field's length** read "Too long: at most 200 characters." instead of
  "Too big: expected string to have <=200 characters" (same field and code, ED-31).

### Fixed

- **Unlinking a login no longer piles up empty records** (ED-33, founder report): the login's own automatic person record
  (made for a new login, or left by an unlink) cannot be unlinked any more: `DELETE /v1/people/{id}/link-user` answers
  `409 conflict` ("This is the automatic record of the login ...; there is nothing to unlink. ..."), the person page shows
  that sentence instead of **Unlink login**, and the Users menu has no **Unlink person** for it. `Person` has the new
  read-only `is_login_placeholder`; such records carry a **Login's own record** badge on the person page and in the People
  list. After an unlink the message says "<person> keeps their assets and history. The login <email> now has its own
  empty record." with **Open the new record** on the person page. Empty duplicates made before stay; archive them.
- **Open PDF** on a finished label sheet shows the PDF in a new tab (the sheet is fetched into an `application/pdf` blob
  URL) instead of saving it like **Download PDF**.
- **Docs**: guide 1 names the fields `category, model` for row 8 of the error report; guide 2 says an Administrator or an
  Asset manager can run the first Google import (both hold `catalog:manage` and `department:manage`; a site-limited role
  cannot); `docs/getting-started.md` and FEATURES say **Use** and **Save count** for consumables and the user menu >
  **Notification settings** path.

---

## 0.2.7 - 2026-11-25 - M2 wave 3 part 2 completed: access changes, guides, console-style dashboard

Wave 3 part 2 completed (M2-USR-04, M2-SEC-01, M2-OPS-01, M2-DOC-01, ED-27 to ED-30) on top of two pull requests merged on
GitHub after 0.2.6: **#15** (console-style dashboard and teal palette for the System, Light and Dark themes) and **#16**
(CI: dependency audit and mock web e2e run again). Release branch `release-0.2.7` = GitHub `main` (`37ae471`) plus a
no-fast-forward merge of the wave 3 part 2 and LAN branches, follow-ups and these docs; the release commit is tagged
`v0.2.7`.

### Added

- **Console-style dashboard** (GitHub PR #15): five count tiles (All assets, Ready, Assigned, Not deployable, Overdue
  check-outs) with a coloured top edge and their share of all assets, an "Assets by status" chart and a "Utilisation"
  meter, and under **Needs attention** the overdue check-outs as a table (asset, holder, due, status) next to Low stock
  and Open repairs. The overdue card keeps the 0.2.7 wording: a line under its title says what it counts (every
  checked-out asset past its return date, loans included) and its second link is "Overdue loans only".
- **Theme switch in the sidebar footer** (GitHub PR #15): System, Light and Dark, also in the command palette ("Switch
  theme"). The palette is teal in all three themes; the design tokens (`docs/design/tokens.json`, `packages/ui-tokens`)
  and `docs/design/design_system.md` describe it, and the contrast tests cover the new pairs.

- **Isolation harness extension** (M2-SEC-01, ED-28): the route replay now also probes, from the database catalogue,
  every tenant table (the other tenant sees none of the rows, the owner sees all) and every foreign key between tenant
  tables (a reference into another tenant is refused with 23503; a control proves an unenforced key would be reported);
  explicit cross-tenant inserts for assignments, loans, loan alerts, repairs, import rows, pool memberships and
  attachments; object keys tenant-prefixed by a CHECK on every key column, and tampered label PDF, export file and import
  upload URLs refused on the local and S3 drivers; the e2e job queue applies the job payload lint and the real producer
  of every catalogued queue (16) runs through it. All of it runs direct and through PgBouncer.
- **Performance harness extension** (M2-OPS-01): nightly budgets for the 500-label PDF (< 30 s at p95) and for a
  location-scoped user's asset list, search, tag lookup and scan resolve on the 50,000-asset tenant (ED-26 predicate);
  `perf.yml` publishes `apps/api/test-results/*.json` with a job summary (`scripts/ci/perf-summary.mjs`).
- **Add and remove access on Settings > Users** (M2-USR-04, ED-27): in the access dialog ("Change role and access") an
  administrator adds a role assignment (role plus whole organisation or limited to a location) and removes one at a time
  after a confirmation. New API operations `POST /v1/users/{id}/role-assignments` and
  `DELETE /v1/users/{id}/role-assignments/{assignment_id}` (`If-Match`, answer with the updated user and its new ETag).
  The ED-26 rules hold (nobody grants wider than they hold; a location-scoped assignment never gives the org-only
  permissions); each change signs the user out of every device (not you, when you edit yourself) and is audited as
  `user.role_assigned` / `user.role_removed`. Refused with `409` (nothing changes): removing a user's only assignment
  (disable or archive the user instead), removing the last active administrator's administrator assignment, removing your
  own last administrator access, the same role and scope twice, and more than 20 assignments. `PATCH /v1/users/{id}` still
  replaces the whole set. No migration.
- **Pending logins on the Users tab** (ED-27): a login whose invitation is not accepted yet is listed with a "Pending"
  badge and has access, link to a person, resend and revoke there (not devices, two-step reset or deactivate). A pending
  login can be linked to a person.
- **Login picker shows who is who**: "Link to a login" lists the email and the roles under each name (and "pending
  invitation"), so two accounts with the same name can be told apart; search matches the email too.
- **Open the app from another device on your network (development only, ED-30):** `SESSION_COOKIE_SECURE=false` makes
  the API issue the session cookie as `at_session` without `Secure` (instead of `__Host-at_session; Secure`), so sign-in
  sticks over plain HTTP from `http://<LAN-IP>:3001`; before, a browser dropped the `Secure` cookie on any address but
  `localhost`. The default is unchanged (`true`); the API refuses `false` when `NODE_ENV=production` and warns at
  start-up when it is off. `docker-compose.yml` passes `SESSION_COOKIE_SECURE`, `WEB_BASE_URL` (mail links) and
  `S3_PUBLIC_ENDPOINT` from `.env`; the Next dev server reads `DEV_ALLOWED_ORIGINS` (`allowedDevOrigins`; the static
  export is not affected). New "Open the app from another device on your network" sections in
  `docs/getting-started.md` and the developer guide (with the Windows firewall command). No contract change, no migration.
- Docs: user guides (drafts) for administrators in `docs/guides/` (import, Google Admin, labels, loaner day, repairs, location scoping, people and logins, K-12 mapping) with screenshots generated by `docs/guides/tools/shoot.mjs` (M2-DOC-01).

### Changed

- **Palette:** the primary colour moves from blue to teal across the three themes (GitHub PR #15); the guide screenshots
  were re-shot with it (59 pictures).
- **ADMIN_DATABASE_URL** is described the same way in the README, the developer guide, `.env.example` and the contributing
  guide: a full e2e run (CI, the merge check) sets it; without it the isolation catalogue probes and one schema-lint
  fixture skip.
- Schema lint rule 8 requires `tenant_id` to be paired with `tenant_id` in a composite foreign key (migration 0170).
- **Google Admin import:** the org unit path becomes the **department** ("/Students/Grade 5" -> "Students / Grade 5", an
  existing department of that name or of the last part is used, else it is created; every unit is an entry of the value
  mapping), no location is created from it; **Disabled** and **Deprovisioned** devices import as **Retired** instead of
  "In repair". Creating the departments needs `department:manage`.
- **Import dry run:** rows that need a category, model, location, department or person created by the import are now
  checked like every other row (the references are created inside a savepoint that is rolled back), so they no longer
  say "the rest of the checks run when it is committed" each, and the commit finds no new failures there. What still
  waits for the commit (a location below a parent the same import creates) is counted once:
  `summary.validated_at_commit`, shown once on the review step.
- **Loaner desk:** "Lend next available device" lends the device the pool picks and shows its tag; a device whose
  status cannot be lent (In repair, Broken, Retired...) is refused when it is scanned, naming the status.
- **Labels:** the dashboard tile is "Overdue check-outs" (loans included, with a line saying so), the loaner overview
  "Overdue loans"; the hint of the organisation's loan default explains the 7-day fallback of pools.
- **Lists at 1280 px:** People and Stock fit a laptop window (Kind and Category give way below 1440 px, long location
  paths end in an ellipsis with the full path as tooltip); Assets keeps the columns its user chose and scrolls inside
  its table with the tag pinned. `DataTable` columns gained `hideBelow: 'wide'` and `maxWidth`.

- **User guides follow the merged changes** (M2-DOC-01, AUDIT B.28): add and remove access, pending logins and the login
  picker (guides 6, 7), the next available device, the refusal at scan and the overdue labels (guides 4, 5), Google
  Admin departments and Retired devices and the dry-run summary line (guides 1, 2); 59 screenshots re-shot.
- **Mock browser suite uses a quarter of the cores outside CI** (`workers: '25%'`): the default oversubscribed the CPU and
  starved a renderer for ~6 s, the root cause of the intermittent 5 s `expect` timeouts (AUDIT B.28).

### Fixed

- **CI** (GitHub PR #16): `scripts/ci/audit.mjs` passed `pnpm audit --json` as one command string without a shell, so on
  Linux the dependency audit failed with "did not return JSON"; with the audit running again, `effect` (dev only, via
  `@prisma/config`) is overridden to 3.22.4 for GHSA-7589-6fvf-x4pw and the expired `picomatch` allow-list entry is
  removed; the optional mock web e2e job builds the web app's workspace packages first.
- **Isolation e2e without the superuser URL:** the tenant visibility probe of the route replay failed with a SCRAM error
  when `ADMIN_DATABASE_URL` was unset; it now skips like the foreign key probe.
- **Attachment owner checked by the database** (ED-28, migration 0170): an attachment row could name a record of another
  tenant as its owner when written outside the API (the API already refused it). A trigger now refuses it with 23503.
- **Intermittent 500 on a check-in during partition rotation** (the "deadlock flake" of AUDIT B.13 / B.22; ED-28,
  ED-29): creating or dropping an `asset_history` partition locked `asset_history` and then `app.asset` /
  `app.assignment`, the reverse of a custody write, and the deadlock detector sometimes cancelled the custody request.
  Partition DDL is now always the side that yields, in two layers: `app.ensure_partitions` takes every lock it needs
  first and with `NOWAIT` (migration 0180), so it never waits while holding a lock; `ensurePartitions` runs it in its own
  transaction with a 200 ms `lock_timeout` and retries `lock_not_available` (55P03, from either layer) and
  `deadlock_detected` (40P01) with a growing pause.

### Known

Recorded in AUDIT.md section C, not fixed in this release: `ensurePartitions` can use up its 10 NOWAIT attempts under
sustained writes (rerun `migrate` or the monthly job); `assertAnotherAdmin` counts administrators without a row lock, so
two concurrent removals of two different administrators could leave none (older than this release); two e2e flakes (the
TOTP time-step test and the 5 s scan wait in `custody-files.spec.ts`).

### Verification

See [AUDIT.md](AUDIT.md) B.24 to B.29 (the work) and B.30 (release).

## 0.2.6 - 2026-11-25 - M2 wave 3 part 2: location scoping of role assignments

M2 wave 3, part 2: location scoping of role assignments (M2-LOC-03, ED-26). Merge commit message "Merge M2-LOC-03: location scoping of role assignments"; the release commit is tagged `v0.2.6`.

### Added

- **Location scoping for roles** (M2-LOC-03, ED-26): on Settings > Users a role can be given for the whole organisation or
  "Limited to a location" (the location and everything below it), when inviting and with "Change role and access". A
  scoped principal sees and changes only records inside its subtree(s): assets, accessories and consumables by their
  location, people by their home location, loaner pools by their home location, and the repairs, loans, custody records,
  history and attachments that belong to them. Outside the scope a record behaves like one that does not exist (404,
  absent from lists, search, scan resolve and counts, `422 not-found` when named as a target). Records without a location
  are outside every scope, and a scoped user's writes must keep records inside it (`422 required`). Exports, imports and
  label batches of a scoped user are their own, and exports and imports carry the scope to the worker. Notification
  recipients are filtered by scope. The scope is computed per permission, and an org-wide grant of the same permission
  lifts it. A scoped assignment never grants the org-only permissions (users, roles, API keys, audit log, catalogue,
  departments, notification rules).
- `GET /v1/auth/me` returns `location_scope` (null for org-wide users); the web top bar shows "Scoped to: ...".
- Migration 0150: `export_job` / `import_job` `location_scoped` + `location_scope`.
- Tests: the scoped surfaces end to end (`apps/api/test/scoping`), a **scoped route replay** that replays every route as a
  location administrator against another site's records (`apps/api/test/isolation/scope-replay.e2e.test.ts`), web unit,
  mock and axe tests for the scope UI, and a real-stack spec (an administrator scopes a technician to one site).

### Changed

- The forms for assets, people, stock, pools and locations require a location for a scoped user. Settings navigation
  lists only the sections the role can open (Notification rules no longer shows for the Asset manager, who got a 403
  page there).
- Granting a role checks the scope as well as the permissions: nobody grants a permission wider than they hold it.

### Fixed

- Three bugs found and fixed in the implementer's own review of the scoping work: (1) the scope came from the route's
  permission only, so a bundle holding `export:run`, `import:run` or `search:read` org-wide but the data permission at a
  location could export, import or find records outside the scope (scopes are now intersected with the records' own
  permission); (2) a user with an org-wide `user:manage` and a location-scoped role could grant that role org-wide,
  including to themselves (a grant now needs each permission held as widely as granted); (3) a loan return sent the
  device to the pool's home even when that place lay outside the caller's scope (it now stays where it is).
- Test-only: the schema-lint fixture for foreign keys referenced the live `app.asset` table, so it held a SHARE ROW
  EXCLUSIVE lock there until its rollback. Check-ins of parallel test files deadlocked against it and answered 500 (seen
  in a pooled run). The fixture now references a table of its own transaction. This is very likely the "intermittent
  failure" of B.13. `E2E_LOG_LEVEL=error` shows the server side of a 500 in an e2e run.

### Security

Independent security review of the scoping work (AUDIT B.22), all fixed or decided before release:

- **Existence oracles closed:** the saved-view reference check gave no warning for an out-of-scope location or person but
  `not-found` for an unknown id; the import default location accepted an out-of-scope id (200) where an unknown id was
  `422`, and the import value mapping by id resolved out-of-scope locations and people (their names showed in the dry-run
  preview). All three now behave exactly like an unknown id.
- **Prisma spread overwrote the id filter:** a `where` of the form `{ id: x, ...locationScopeWhere(trx, 'id') }` lets the
  spread replace the `id` match, so any in-scope location matched. Those filters are now `AND: [...]`.
- **Scan actions scoped:** scan resolve's `allowed_actions` follows the scope of each action's permission.
- **Accepted boundary (decided by the founder):** an in-scope asset names an out-of-scope holder (id and name in
  `current_assignment`, history, custody list, CSV export), and filtering by that holder id returns those in-scope assets;
  the person record itself stays `404`. ED-26 states it and a test asserts it. ED-26 also documents the ancestor path in
  `/auth/me` and that a location filter on an ancestor of the scope root returns the in-scope descendants.

### Verification

See [AUDIT.md](AUDIT.md) B.22 (implementation and review) and B.23 (release).

## 0.2.5 - 2026-11-24 - M2 wave 3 part 1: imports, loaners, deferred items

M2 wave 3, part 1: the import backend and wizard (M2-IMP-01..08), loaner pools, desk and dashboard (M2-LOAN-01..04, M2-LIFE-09) and three deferred stories (M2-REG-03, M2-USR-03, M2-UX-02).

### Added

- **CSV and XLSX import with a mandatory dry run** (M2-IMP-01..07, ADR 0010, ED-18, ED-19): create an import, upload the file through
  the attachments API (it passes the virus scan first), analyse it (format, encoding UTF-8 / UTF-16 / Windows-1252, delimiter, header
  row, per-column profile, 50 sample rows, suggested mapping), edit the mapping, options and value mapping, dry-run (every row
  validated by the same code as the API, nothing written), commit in batches (one transaction each, resumable after a crash,
  cancellable), download the error report. Entity types: assets, people, locations (paths such as `Site > Building > Room`; missing
  parents are created) and departments. Missing categories, manufacturers, models, vendors, locations, departments and people can be
  created by the import. API: tag Imports, 19 operations (`/v1/imports`, `/v1/import-templates`), problem codes
  `import-wrong-state`, `import-quota-exceeded`, `import-stale-dry-run`; migration 0110 (`import_job`, `import_row`,
  `import_template`); worker queues `import.analyze`, `import.step`, `import.sweep`; configuration `IMPORT_MAX_ROWS` (100,000),
  `IMPORT_BATCH_ROWS` (1,000), `IMPORT_MAX_CONCURRENT` (2).
- **Google Admin ChromeOS preset** and **generic templates** (downloadable CSV / XLSX with a data dictionary): `GET /v1/imports/presets`.
  Creating an import from the Google preset creates the Chromebook category and its custom fields.
- **Saved mapping templates** per organisation, applied to a file by header text.
- The importer reads the `'` an export puts before cells that look like formulas, so exported files import to the original values;
  the error report is formula-safe.
- Notification `import.completed` (bell and e-mail) with the counts.
- Dependencies `yauzl`, `saxes` (XLSX reading) and `fflate` (template workbooks).
- **Loaner pools** (M2-LOAN-01, ED-20, ADR 0011): pools of spare devices with a default and a maximum loan length, a limit of
  loans per person, eligible kinds of people, a home location (returned devices go back there) and an owner; membership of
  assets (one pool per asset, single and bulk add and remove); live counts per pool (members, available, out, overdue, due
  today). Asset list filters `loaner_pool_id` and `in_loaner_pool` (the first used to answer `400`).
- **Quick loans by scanning** (API of M2-LOAN-02): `POST /v1/loaner-pools/{id}/quick-checkout` lends several devices to one
  borrower found by email or badge (`employee_ref`), `POST /v1/loans/return` takes many devices back, both with a result per
  scan; `POST /v1/loaner-pools/{id}/checkout` lends one device (a given one, or the next available). Loan lists
  (`GET /v1/loans`, `GET /v1/loans/{id}`), the overdue list (`GET /v1/loans/overdue`, now implemented) and extending a loan
  (`POST /v1/loans/{id}/extend`, logged in audit and history).
- **Loaner dashboard** (API of M2-LOAN-04): `GET /v1/loaners/dashboard`, per-pool and total counts and the latest activity.
- **Overdue and due-soon alerts** (M2-LOAN-03, ED-21): a daily job per tenant raises each alert once per loan and state
  (a ledger table makes a second run silent); the borrower (when they have a login) and the pool owner or managers are
  notified in-app and by e-mail, with a text that escalates; per-user opt-out through the notification preferences.
- **Custody settings** (M2-LIFE-09): `GET` / `PUT /v1/settings/custody` with the default number of days for the expected return
  (a pre-fill for the dialogs; ordinary check-outs stay open-ended, a loaner pool without its own loan length takes it, ED-24) and the reminder lead time of due-soon alerts.
- Demo data: a Chromebook cart per demo tenant with ten devices, five on loan, two of them overdue (the demo tenants now have
  210 assets).
- Migration `0120` (pools, members, alert ledger, the loan foreign key), queue `loan.alerts`, problem codes
  `loan-limit-reached` and `loaner-pool-inactive`; the 10 loaner operations that were contract-only are implemented, 8 new ones and the 2 custody settings operations are added (203 operations in all with the deferred stories).
- **Sort the asset list by location, assignee and due date** (M2-REG-03, ED-22): the Location, Assigned to and Due back
  columns of the Assets table sort through the server (`?sort=location|assignee|due`, also `-`). An asset with no value (no
  location, in stock, no expected return) is listed last in both directions and paging never skips or repeats a row.
- **Link and unlink a person and a login account** (M2-USR-03, ED-22): `POST` / `DELETE /v1/people/{id}/link-user`
  (Administrators, audited), buttons on the person page and in Settings → Users (new Person column), confirmation dialogs
  that say what happens. `User.person_id` is now filled (`/v1/users`, `/v1/auth/me`). Three new problem codes:
  `person-already-linked`, `login-already-linked`, `login-person-in-use`.
- **Undo toast after a custody action** (M2-UX-02, ED-23): the success toast of a check-out, check-in or transfer (single or
  bulk) offers Undo for 10 seconds. `POST /v1/assets/{id}/undo-custody` performs the inverse action in one transaction
  (never a delete), guarded by `If-Match`, the newest history event and a five-minute window; a new history event
  `custody_undone` (migration `0130`). New problem codes `undo-expired`, `undo-asset-changed`, `undo-not-possible`.
  F8 moves keyboard focus to the notifications (listed in the shortcuts help).
- **Import wizard** (M2-IMP-08): Assets > Import and Settings > Imports. Choose the kind of data (assets, people, locations,
  departments, or a Google Admin ChromeOS export), download a CSV or Excel template with its data dictionary, upload a CSV or
  XLSX file (virus-scanned first), check the column suggestions (profile, confidence, date formats, saved mappings), decide
  the values that match nothing, see the dry run (nothing is saved) with filters and the error report, then import with
  progress and cancel; an import can be resumed from the list after a reload. Built against the real import API and tested
  with a mock that mirrors it exactly, with axe in light and dark.
- **Loaner desk, dashboard and pools** (M2-LOAN-02, M2-LOAN-04): Loaners menu: the desk (scan devices, scan or find the
  borrower, the due date is filled in, Enter lends; bulk return by scanning), the dashboard (cards per pool, overdue loans
  with the borrower, extend a loan, recent activity) and the pool settings with the organisation's loan defaults. The
  check-out and transfer dialogs pre-fill the organisation's default return date (M2-LIFE-09).
- **Loan length and mail rules for loaner pools** (founder decisions of 2026-11-24, ED-24, migration `0140`): the due date
  of a loan is the date typed, else the pool's loan length (now optional), else the organisation's default return days,
  else 7 days, never beyond the pool's maximum (`LoanerPool.effective_default_loan_days` shows the result);
  "next available" lends the device idle the longest (never-lent first, ties by tag); the new pool option
  `email_borrowers_without_login` (automatic: everybody except students; always; never) sends due-soon and overdue mail to
  borrowers who have an address but no login; overdue loans always also go to the owner or the loaner managers. The school
  vocabulary needs no new fields (student ID = employee ref, homeroom = department or room, device number = asset tag):
  see getting-started.md.
- **Import data retention** (ED-25, migration `0141`): the rows, sample cells, value map and uploaded file of a finished
  import are removed after `IMPORT_ROW_RETENTION_DAYS` (default 30) by the scheduled sweep; the job, its counts, summary and
  audit trail stay (`ImportJob.data_purged_at`). The sweep's six-hour give-up on a stuck import is now tested with an
  injected clock.
- The registry, custody, search and import performance suites record their numbers in the ordinary test run and enforce
  the real budgets only when `PERF` is set (the nightly perf job sets it and now runs them).
### Changed

- The contract-only placeholders of the first drafts for imports (`ImportJob` states `dry_run_queued`..., source `snipe_it`) are
  replaced by the built design; the Snipe-IT source returns with M5.
- Uploads of kind `import_file` may be UTF-16 (with a byte order mark) or Windows-1252 CSV; other attachments are unchanged.
- Creating an asset answers with the row it just wrote instead of reading it back (three queries fewer; also faster over the API);
  the tag numbering template is read once per transaction. `people`, `locations` and `departments` create / update take an optional
  audit metadata argument.
- `GET /v1/loans/overdue` lists the asset check-outs past due with the holder, asset tag and name and the pool name
  (new members `asset_tag`, `asset_name`, `holder_name`, `pool_name`).
- The scan lookup of `GET /v1/scan/resolve` is shared with the loaner flows (no behaviour change).
- The history payloads of check-out, check-in and a transfer out of stock now also carry the ids of the statuses
  (`status.from_id` / `to_id`), what an undo restores.


### Fixed

- The Google Admin ChromeOS import committed only 22 of 48 rows: a row undone by its savepoint left the model it had created
  in the reference cache and the following rows hit a foreign key error. The resolvers are now dropped after an undone row.
- The dry run reported "create" for a row whose asset tag another asset already had (matching on serial); it is now an error
  in the dry run.
- Test-only: the isolation tests' schema lint check no longer fails when the schema-lint test's temporary far-future
  partitions exist at that moment in a parallel file.
- Tooling: `docs/engineering/tools/gen.mjs` and `gen-api-md.mjs` run from a plain checkout (`yaml` is a pinned root
  devDependency); the commands are in contributing.md.

### Verification

Independent verification of the merged code: 21/21 turbo tasks, API unit 635, API e2e direct 699/699 and pooled 699/699 on
the rerun (one flake in the first pooled run, fixed in this release), real-stack browser suite 64 passed, contract and
drift checks clean. See [AUDIT.md](AUDIT.md) B.21.

---

## 0.2.4 - 2026-11-24 - managed departments and location edit fixes (M2)

`main` at `000b648` (merge "location edit fixes and managed departments"), version bump in the following commit. Both were
founder requests from the review on 2026-11-24.

### Added

- **Managed departments** (M2-ORG-01, M2-ORG-02, ED-17): Settings → Departments (create, rename, archive, merge by
  reassigning), a department picker on people and assets (also in bulk edit), department column and filter on the People and
  Assets lists, an optional owning department on assets, department name in CSV exports, demo departments (IT, Science,
  Mathematics, Administration, Library, Facilities). API: `/v1/departments` (5 operations), `department_id` on people and
  assets, permissions `department:read` (all roles) and `department:manage` (asset manager; administrators have all).
- Migration `0100`: existing free-text departments become managed departments (one per distinct value per organisation,
  ignoring case and spacing; the most used spelling wins), and people are linked without changing their version.

### Changed

- **Breaking for API clients:** people are written with `department_id`; the free-text `department` field on writes and the
  `?department=` filter are removed (422 if sent). The old column is kept read-only for one release.
- `address.country` on a location must be a two-letter code (stored upper-case).

### Fixed

- **Location edit** (M2-LOC-05, ED-16): an address value over its limit (typically a country name instead of the two-letter
  code) returned a validation error the dialog could not place on a field, so only a generic banner appeared. Errors are now
  shown on the field, limits are checked before saving, a stale save offers "Reload latest", the address is kept when the
  type changes, and address line 2 is no longer dropped. A location's type stays freely editable.

### Verification

Clean build 21/21; API e2e 588/588 through PgBouncer (588/588 direct reported by the change); real-stack browser tests 54/54;
mock browser tests 559/559 (reported). See [AUDIT.md](AUDIT.md) B.16.

---

## 0.2.3 - 2026-11-24 - fixes after the founder review (M2)

`main` at `2d9a14b` (merge "repair/status consistency"). Founder review of the M2 wave 2 build, answered in two batches.

### Added

- **Dashboard with real numbers**: tiles for Ready, Assigned, Not deployable and Overdue, and "Needs attention" panels
  (overdue check-outs, low stock, open repairs). Each tile opens the asset list already filtered (`af19b0a`).
- **No-open-repair hint**: the asset form, the asset page and bulk edit say so when an asset is not deployable but has no
  open repair, with a "Log a repair" shortcut. It never blocks the save (`042dd6b`).
- Demo data: every demo asset labelled "In repair" now has an open repair, so the Repairs page, the dashboard and the status
  labels agree; "Broken" demo assets have none (`f43b108`).
- Contributing rules (`1c0a543`): git rules, contract workflow, migrations, verification checklist and the list of maintained
  docs.
- This documentation set: [API.md](API.md), [FEATURES.md](FEATURES.md), [VERSION.md](VERSION.md), [AUDIT.md](AUDIT.md) and
  the generator [`engineering/tools/gen-api-md.mjs`](engineering/tools/gen-api-md.mjs) (`a5357fd`); version numbers set in
  every `package.json` and release tags added (`e117ca8`).

### Changed

- The "In repair" state is renamed **"Not deployable"** (it covers every status that blocks check-out, for example Broken),
  on the dashboard tile and in the web app (`c05bb9d`).
- The sidebar entry "Accessories and consumables" is shortened to **"Stock"**; truncated or collapsed items get tooltips.
- A repair logged for an asset that is already in an undeployable status takes that status over and returns the asset to
  ready when the repair is closed (`9c02507`).

### Fixed

- Unit and browser tests that failed intermittently on a loaded machine: slow API unit tests (the session-level `SET` scan
  skipped the generated Prisma client, 5 s to 36 ms; PDF decoding tests got a 60 s budget; default unit timeout 15 s)
  (`c583591`), the bulk-edit toast assertion made exact (`a147719`), the real-stack dashboard tile pattern (backslashes were
  lost) (`e5bd3e8`).

---

## 0.2.2 - 2026-11-19 - M2 wave 2: labels, stock, repairs, notifications, views, export

`main` at `2f7c467` (merge "M2 wave 2"). Database migrations `0070` to `0094`; contract tags Accessories, Consumables,
Repairs, Labels, Notifications, Views and Exports; ADRs 0007, 0008 and 0009 (proposed).

### Added

- **Label sheets** (TAG-02, TAG-03): PDF labels with QR and Code128, six fixed templates (the three asked for plus Avery 5163,
  A4 24-up and a 50 x 25 mm page), start position, calibration offsets, asynchronous batches with a download link; 500 labels
  render in about 2 seconds.
- **Accessories and consumables** (ACC-01..04): quantity-tracked stock with check-out and partial returns, an append-only
  stock ledger, derived availability, low-stock alerts, and the Stock screens.
- **Repair log** (MNT-01, MNT-02): open, update, complete and cancel repairs, cost totals per asset, status restore.
- **Notifications** (NOT-01, NOT-02): bell with unread count, list, preferences, administrator rules, daily digest, e-mail.
- **Saved views** shared server-side (REG-01) and **CSV export** of assets, people and locations (REG-02).
- **MFA policy** shown up front on the Security page (AUTH-01).

### Changed

- The web app moved from mocks to the real wave 2 API shapes (`6deb8da`); notification rules screen and repair totals from
  the API (`d46a7be`).

### Fixed

- An asset that still holds accessory units can no longer be archived or disposed of: `409` with the usage counts (`f820c6c`).
- The API end-to-end suite no longer starves the database under load: bounded parallelism, PgBouncer pool 16, Postgres
  `max_connections` 300, partition DDL retries (`d920186`).
- Flaky tests: seed test seeds its own tenants (`d6a308f`), web `findBy`/`waitFor` wait up to 5 s (`46becfa`), toast counts
  (`953544e`), responsive dialog sub-pixel check (`b650623`).
- The real-stack browser test never reuses a leftover static server, which could be proxying to another API (`155c592`).

### Security

- Secret scanner false positives (a label template key, a fake storage key, a fixture idempotency key) are allow-listed
  narrowly rather than weakening the scan (`14ceb94`, `7f53ccb`).

Verified on the merged code: API end-to-end 566 of 566 (direct and through PgBouncer), real-stack browser tests 30 of 30
([STATUS.md](STATUS.md)). One unexplained intermittent API test failure was seen once in five runs under extra load: see
[AUDIT.md](AUDIT.md).

---

## 0.2.1 - 2026-11-19 - M2 wave 1: locations, people, custody, files, scanning

`main` at `916b15c` (merge "M2 wave 1"). Migrations `0040` to `0060`; contract tags Locations, People, Custody, Attachments.

### Added

- **Locations** tree (site, building, room; up to ten levels), moves, `asset_count`, archive guard (LOC-01, LOC-04).
- **People** with or without a login, one person per login account (USR-01, USR-02).
- **Custody**: check-out, check-in with condition and photos, transfer, dispose, mark lost and found, and the chain-of-custody
  history (LIFE-01..07). 50 concurrent check-outs of one asset give exactly one success.
- **Files**: storage adapters (S3 or MinIO, local disk), presigned uploads, ClamAV virus scanning, thumbnails, attachments
  panel (FILE-01..04).
- **Scan codes and scanner**: public codes on assets, `GET /v1/scan/resolve`, the `/s/<code>` link, the keyboard-wedge scan
  panel and manual entry (TAG-01, LIFE-08).

### Changed

- `packages/api-client` never records or replays ETags for `POST` action paths (`29025cb`); the attachment list accepts the
  `asset_model` owner type (`d82a514`).

### Fixed

- Web scan guard so typing shortcuts and pickers are not hijacked by the scanner burst (`b43d383`).

### Security

- Upload hardening (SEC-02): the file type is checked against the declared type, SVG and HTML are refused, signed file
  tokens for local storage, downloads only for clean unchanged files; a throttle on scan-resolve enumeration.

---

## 0.1.0 - 2026-11-18 - M1: tenancy, sign-in, asset registry

`main` at `6634c54` (merge "M1 wave 3"); delivered in four merge steps on 2026-11-17 and 2026-11-18 (wave 1 `d4126e0` and
`fa86857`, wave 2a `a258a69` and `1544b4d`, wave 2b `8b80882`, wave 3 `6634c54`). Accepted by the founder walk-through on
2026-11-19 (`c682619`). Migrations `0001` to `0030`.

### Added

- **Tenancy**: shared database with row-level security on every tenant table, PgBouncer in transaction mode, two database
  roles that cannot bypass RLS, schema lint, two-tenant isolation suite (direct and pooled) with a negative control.
- **Sign-in and access**: email and password (argon2id, breached-password check), browser sessions, TOTP two-step
  verification with recovery codes, invitations, password reset, API keys, five built-in roles, user management (AUTH-01..08).
- **Platform services**: audit log, transactional outbox, background jobs (pg-boss 12), encrypted secrets, e-mail
  (Mailpit in development), logging, metrics and probes.
- **Asset registry**: categories with custom fields, manufacturers, models, status labels, vendors, assets with automatic tags,
  search, exact tag and serial lookup, clone, bulk edit, archive and restore (REG-01..11).
- **Web admin**: sign-in screens, navigation, command palette, registry screens, users and roles.
- **Engineering**: OpenAPI 3.1 contract generated by `gen.mjs`, generated typed client, CI with PostgreSQL 16 and 18 matrix,
  security scanning, image build and Compose smoke test, nightly performance budgets on 2 x 50,000 assets.

### Changed

- Kysely replaced by Prisma 7 over raw SQL migrations; ADR 0001 accepted (`97bb70f`).

### Fixed

- Registry review findings: a regular-expression denial-of-service guard on search, NUL and date inputs that caused `500`,
  filters, edits of archived assets (`4fd487d`).
- Founder walk-through findings: cramped inline role selects and a stray tab-list scrollbar (`d36a5e2`); no way to turn off
  two-step verification or regenerate recovery codes (`3d30054`).

### Security

- `TRUST_PROXY` defaults to `false`: a forged `X-Forwarded-For` is ignored unless the operator names the proxies (`70e7be0`).
- The bundled `npm` was removed from the runtime image, which removed the six Trivy exceptions: the image scan passes with
  none (`7078baf`).
- Tenant policy uses the `NULLIF(current_setting(...), '')` form and the application role has no grants on partitions, both
  findings of the RLS spike ([AUDIT.md](AUDIT.md)).

---

## 0.0.0 - 2026-11-17 - research, validation and Sprint 0

Before any release. Commits `60da59c` (research, product plan, architecture, validation), `1f1b88b` (Sprint 0: monorepo
scaffold, data model, API contract, design, backlog) and `ba8dc0d` (engineering decisions ED-01 to ED-13).

### Added

- Product plan, system architecture, four validation reports and the milestone backlog (M1 to M6).
- The PostgreSQL schema (tested on 16, 17 and 18) and the first OpenAPI contract.
- The Turborepo and pnpm monorepo with `apps/api`, `apps/web` and three shared packages.
