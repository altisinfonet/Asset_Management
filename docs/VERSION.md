# Version history

What changed, release by release. Newest first. Format follows [Keep a Changelog](https://keepachangelog.com/):
each release lists **Added**, **Changed**, **Fixed** and **Security**. For what each feature does see
[FEATURES.md](FEATURES.md); for how it was verified see [AUDIT.md](AUDIT.md); for the API see [API.md](API.md).

**Current version: 0.2.3** (milestone M2, after the founder review of 2026-11-24). Last released commit on `main`: `2d9a14b`
(`1c0a543`, which only adds the contributing rules, follows it).

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

## Unreleased

Work in progress on top of 0.2.3. Nothing here is on `main` yet.

### Added

- **Managed departments** (founder request, in progress). Today a department is a free-text field on a person. The change is to
  manage departments as a maintained list. Scope and acceptance are not yet written in the backlog.
- This documentation set: [API.md](API.md), [FEATURES.md](FEATURES.md), [VERSION.md](VERSION.md), [AUDIT.md](AUDIT.md), and the
  generator [`engineering/tools/gen-api-md.mjs`](engineering/tools/gen-api-md.mjs).

### Fixed

- **Location edit** (founder-reported defect, fix in progress). Details are not yet recorded in the repository; this entry
  is updated when the fix merges.

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
- Contributing rules (`1c0a543`, on `main` right after the release): git rules, contract workflow, migrations, verification
  checklist and the list of maintained docs.

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
