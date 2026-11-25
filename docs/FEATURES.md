# Features

Every user-visible feature of the Asset Tracker, by area, with its state today, the milestone it belongs to and the backlog
stories behind it. Planned work from M2 wave 3 to M6 is included so this page shows the whole path.

**Status legend:** ✅ available (built, tested, merged) · 🟡 partial or in progress (the gap is stated) · ⏳ planned (not started).
**Milestones:** M1 tenancy, sign-in and asset registry (done) · M2 custody, labels and import (waves 1 and 2 done, wave 3
next) · M3 mobile app · M4 self-hosted edition (first real users) · M5 Snipe-IT importer, reports, webhooks, licences ·
M6 Cloud SaaS launch. Stories are in [05_backlog.md](05_backlog.md) (`M<n>-<AREA>-<nn>`; the table shows the short form, for
example `AUTH-02` is `M1-AUTH-02`). The release each feature arrived in is in [VERSION.md](VERSION.md); the API behind it is in
[API.md](API.md). Current version: **0.2.6**.

This page is maintained by hand: update the status here whenever a story changes state (see
[`engineering/contributing.md`](engineering/contributing.md)).

## At a glance

| Area                                          | State                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| Sign-in and security                          | ✅ passwords, two-step verification, sessions, invitations; SSO planned (M4/M6) |
| Users and roles                               | ✅ five built-in roles; ✅ location scoping (0.2.6); ⏳ custom roles planned       |
| Asset registry                                | ✅ complete for M1; list sorts incl. location, assignee, due date               |
| Locations                                     | ✅ tree, moves and editing (type, parent, address)                              |
| People                                        | ✅ with or without login; managed departments                                   |
| Custody                                       | ✅ check-out, check-in, transfer, dispose, lost and found, history              |
| Files                                         | ✅ uploads with virus scanning and thumbnails                                   |
| Scanning and labels                           | ✅ labels and USB scanner; 🟡 print calibration needs the founder's hardware    |
| Stock                                         | ✅ accessories and consumables with low-stock alerts                            |
| Repairs                                       | ✅                                                                              |
| Notifications                                 | ✅ in-app and e-mail                                                            |
| Views and export                              | ✅ shared saved views, CSV export                                               |
| Dashboard                                     | ✅ counts and needs-attention panels; fuller dashboard planned (M5)             |
| Import                                        | ✅ wizard, engine and API (M2 wave 3, unreleased)                               |
| Loaner pool                                   | ✅ pools, desk, dashboard, alerts (M2 wave 3, unreleased)                       |
| Mobile app                                    | ⏳ M3                                                                           |
| Self-hosted edition                           | ⏳ M4 (a development Compose stack exists today)                                |
| Reports, webhooks, licences, audit log screen | ⏳ M5                                                                           |
| Cloud SaaS                                    | ⏳ M6                                                                           |

---

## 1. Sign-in and security

| Feature                             | What it does                                                                                                                                                                                                                                                                    | Status | Milestone | Stories               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | --------------------- |
| Email and password sign-in          | Argon2id password storage, 12 to 128 character rule, rejects breached passwords, throttling and lockout after repeated failures                                                                                                                                                 |   ✅   |    M1     | AUTH-02               |
| Browser sessions                    | Cookie sessions with idle (30 min) and absolute (12 h) timeouts, CSRF protection, list and end your own sessions                                                                                                                                                                |   ✅   |    M1     | AUTH-03               |
| Two-step verification (TOTP)        | Authenticator-app codes, ten one-time recovery codes, replay protection; turn off and regenerate codes with a password check                                                                                                                                                    |   ✅   |    M1     | AUTH-04               |
| Organisation MFA policy             | The organisation setting (off, administrators or everyone) is enforced: affected users must enrol before anything else and cannot turn MFA off; the policy is shown on the Security page. There is no screen or API to change the setting yet (it lives in the tenant settings) |   🟡   |  M1, M2   | AUTH-04, M2-AUTH-01   |
| Invitations and password reset      | Invite a user by e-mail with a single-use link; "forgot password" by e-mail that never reveals whether an account exists                                                                                                                                                        |   ✅   |    M1     | AUTH-05               |
| Sign-in screens                     | Login, MFA, enrolment, invitation accept, forgot and reset password                                                                                                                                                                                                             |   ✅   |    M1     | WEB-03                |
| Tenant isolation                    | Every tenant's data is separated in the database itself (row-level security), proven by tests direct and through the pooler                                                                                                                                                     |   ✅   |    M1     | TEN-01..09            |
| Passkeys / WebAuthn                 | Passwordless second factor                                                                                                                                                                                                                                                      |   ⏳   |   v1.1    | parked                |
| Built-in OIDC login (self-hosted)   | Sign in with Google, Microsoft or a generic OIDC provider                                                                                                                                                                                                                       |   ⏳   |    M4     | M4-SHA-01             |
| SAML single sign-on and SCIM        | Paid add-on for the Cloud edition through an SSO vendor                                                                                                                                                                                                                         |   ⏳   |    M6     | M6-SSO-01..03         |
| Mobile sign-in (OIDC + PKCE tokens) | Short-lived access token and rotating refresh token for the phone app                                                                                                                                                                                                           |   ⏳   |    M3     | M3-AUTH-01, M3-MOB-04 |

## 2. Users and roles

| Feature                              | What it does                                                                                                                                                                     | Status | Milestone | Stories         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | --------------- |
| Five built-in roles                  | Administrator, Asset manager, Technician, Auditor, Viewer, each a fixed bundle of permissions ([table](API.md#4-permissions-model))                                              |   ✅   |    M1     | AUTH-01         |
| User management                      | Invite, change role, disable, archive, resend or revoke an invitation, reset someone's MFA, end their sessions; cannot demote the last administrator or grant more than you hold |   ✅   |    M1     | AUTH-07, WEB-09 |
| Users, roles and invitations screens | Settings > Users in the web app                                                                                                                                                  |   ✅   |    M1     | WEB-09          |
| Role-aware navigation                | Menu entries and pages the signed-in user cannot open are hidden; the API enforces every request regardless                                                                      |   ✅   |    M1     | WEB-04          |
| Location scoping for roles           | Limit a role assignment to a location subtree (for example one school) on Settings > Users; outside it records look like they do not exist (404), lists, search, counts, exports and imports stay inside it; "Scoped to" in the top bar (ED-26). Shipped in 0.2.6; the Users screen changes the role and scope of an existing assignment but cannot yet add or remove one |   ✅ 0.2.6   | M2 wave 3 | M2-LOC-03       |
| Custom roles                         | Build your own permission bundles                                                                                                                                                |   ⏳   |    v2     | parked          |

## 3. Asset registry

| Feature                              | What it does                                                                                                                           | Status | Milestone | Stories                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | ---------------------- |
| Categories and custom fields         | Asset, accessory and consumable categories with typed custom fields (builder in Settings)                                              |   ✅   |    M1     | REG-01, REG-04, WEB-05 |
| Manufacturers and models             | Make and model catalogue, with a picture                                                                                               |   ✅   |    M1     | REG-02, WEB-06         |
| Status labels                        | Your own status names mapped to fixed state types (ready, deployed, pending, not deployable, archived, lost)                           |   ✅   |    M1     | REG-03, WEB-06         |
| Vendors                              | Suppliers and repair vendors                                                                                                           |   ✅   |    M1     | REG-11, WEB-06         |
| Assets                               | Create, view, edit with conflict detection (stale edits are refused and refreshed), purchase, warranty and custom data                 |   ✅   |    M1     | REG-05, WEB-08         |
| Automatic asset tags                 | Per-organisation tag template with counters per prefix; tags are never reused                                                          |   ✅   |    M1     | REG-06, WEB-06         |
| List, filter, sort and search        | Filters on status, category, model, location (with sub-locations), assignee, overdue, warranty and more; search by tag, serial or name |   ✅   |  M1, M2   | REG-07, REG-08, WEB-07 |
| Command palette and global search    | Ctrl+K search across assets, models, categories, people and locations, with keyboard navigation                                        |   ✅   |    M1     | WEB-04                 |
| Clone and bulk operations            | Clone an asset; bulk edit, archive, restore and move up to 100 assets with a result per item                                           |   ✅   |  M1, M2   | REG-09, REG-10         |
| Archive and restore                  | Soft delete with usage checks; disposal is a separate lifecycle action                                                                 |   ✅   |    M1     | REG-10                 |
| Sort by location, assignee, due date | The Location, Assigned to and Due back columns sort through the server; assets with no value stay last in both directions, paging stays exact |   ✅ 0.2.5   |    M2     | M2-REG-03 (ED-22)      |
| Warranty expiry alerts               | Notify before an asset's warranty ends                                                                                                 |   ⏳   |    M5     | M5-LIC-03              |
| Straight-line depreciation           | Value over time per asset (Should)                                                                                                     |   ⏳   |    M5     | M5-RPT-04              |
| Software licence records and seats   | Licences with seats, assignment, expiry and renewal alerts                                                                             |   ⏳   |    M5     | M5-LIC-01..04          |

## 4. Locations

| Feature                  | What it does                                                                                                                                |     Status     | Milestone | Stories                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | :------------: | :-------: | --------------------------------------------------------------- |
| Location tree            | Site, building, room (up to ten levels), create, rename, move (the whole subtree follows), archive with guard counts, asset counts per node |       ✅       |    M2     | LOC-01, LOC-04                                                  |
| Asset location and moves | Set a location on an asset, move one or many assets, filter the list by location including sub-locations; history records each move         |       🟡       |    M2     | LOC-02 (a default location on a model or category is not built) |
| **Location editing**     | Rename, change type (freely), move, edit the address; field-level errors (e.g. a two-letter country code), "Reload latest" after a stale save | ✅ 0.2.4 |    M2     | M2-LOC-05 (ED-16)                                               |
| Per-location stock       | Consumable quantities per location (today one home location per item)                                                                       |       ⏳       |   later   | none                                                            |

## 5. People

| Feature                                 | What it does                                                                                                                                        |     Status     | Milestone  | Stories                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | :------------: | :--------: | ------------------------------------------------------------------ |
| People (assignable)                     | Employees, students, contractors, with or without a login; unique e-mail and employee id; every login account gets one person automatically         |       ✅       |     M2     | USR-01                                                             |
| People screens                          | List, detail with assets held and a history tab, create, edit, archive (with a forced path and a reason when they still hold assets), person picker |       🟡       |     M2     | USR-02, M2-USR-03 |
| Link a person and a login               | Administrators link an existing person to a login account (and unlink it) from the person page or Settings → Users, with the consequence stated first; the login's own placeholder person is archived, nothing the person holds changes |  ✅ 0.2.5  |     M2     | M2-USR-03 (ED-22)                                                  |
| **Managed departments**                 | Settings → Departments (create, rename, archive, merge); picker on people and assets incl. bulk edit; column and filter on both lists; owning department on assets; in CSV exports | ✅ 0.2.4 |     M2     | M2-ORG-01, M2-ORG-02 (ED-17)                                       |
| Directory sync (Entra ID, Google, SCIM) | Keep people in step with a directory                                                                                                                |       ⏳       | v1.1 to M6 | parked, M6-SSO-02                                                  |

## 6. Custody (check-out, check-in, transfer)

| Feature                           | What it does                                                                                                                                                                                          | Status | Milestone | Stories                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | ----------------------------------------------------------------------------- |
| Check-out                         | Hand an asset to a person, a location or another asset with a due date, a note, photos and a status after; only ready assets can go out; double check-out is impossible even with concurrent requests |   ✅   |    M2     | LIFE-01, LIFE-02                                                              |
| Check-in                          | Return with condition (good, fair, poor, damaged), photos, status and location after                                                                                                                  |   ✅   |    M2     | LIFE-03                                                                       |
| Transfer                          | Move custody from one holder to another in one step                                                                                                                                                   |   ✅   |    M2     | LIFE-04                                                                       |
| Dispose, lost and found           | Retire with a reason and date; mark lost (closes the custody) and found; restore a disposed asset                                                                                                     |   ✅   |    M2     | LIFE-05                                                                       |
| Custody dialogs                   | Check-out, check-in and transfer from the asset page, the list (bulk) and the person page, with conflict refresh                                                                                      |   ✅   |    M2     | LIFE-07                                                                       |
| Chain-of-custody history          | Timeline per asset and per person with who did what, when                                                                                                                                             |   🟡   |    M2     | LIFE-06 (works; repair and attachment events and location scoping come later) |
| Overdue tracking                  | Assignments past their due date are flagged, filterable and shown on the dashboard                                                                                                                    |   ✅   |    M2     | LIFE-02                                                                       |
| Default return date               | The organisation default number of days for the expected return (Settings / Loaners > Pools > Loan defaults): the check-out and transfer dialogs pre-fill it, a check-out without a date stays open-ended; a loaner pool without its own loan length uses it too (then 7 days) | ✅ 0.2.5 | M2 wave 3 | M2-LIFE-09, ED-24 |
| Undo toast after a custody action | After check-out, check-in or transfer (one asset or many) the toast offers Undo for 10 seconds; it performs the inverse action on the server, refuses when the asset changed meanwhile, and the history shows both |   ✅ 0.2.5   |    M2     | M2-UX-02 (ED-23)                                                              |
| Loaner pool                       | Pools of spare devices with an optional default loan length (else the organisation default, else 7 days), a maximum loan length, a limit per person and eligible kinds; quick loan of several devices per borrower by scanning (badge or email, tag or label), the next available device is the one idle the longest, quick return by scanning with per-scan results, extending a loan; overdue and due-soon mail also reaches borrowers without a login when the pool allows it (default: not students). School mapping: student ID = the person's employee ref, homeroom = department or room, device / cart number = asset tag or a custom field (see [getting started](getting-started.md)); demo data: a Chromebook cart per tenant | ✅ 0.2.5 | M2 wave 3 | LOAN-01, LOAN-03, ED-20, ED-21, ED-24 |
| Loaner desk                       | One screen for the counter: scan the device, scan or find the borrower, the pool's due date is filled in, Enter lends; the borrower stays for the next device; bulk return by scanning. Works with a USB scanner from anywhere on the page, with large touch targets, sound optional, and named errors (not in a pool, already on loan, borrower at the limit) | ✅ 0.2.5 | M2 wave 3 | M2-LOAN-02                            |
| Loaner dashboard and pools        | Cards per pool (available, on loan, overdue, due today), overdue loans with the borrower and how to reach them (and a way to extend them), recent activity, a page per pool, creating and editing pools, and the organisation's loan defaults (Loaners menu; linked from the dashboard's overdue card) | ✅ 0.2.5 | M2 wave 3 | M2-LOAN-04                            |
| Stocktake                         | Count a location or category with a scanner: found, missing, unexpected                                                                                                                               |   ⏳   |    M3     | M3-STK-01..03                                                                 |
| End-user acceptance / e-signature | The borrower confirms receipt                                                                                                                                                                         |   ⏳   |   v1.1    | parked                                                                        |

## 7. Files and attachments

| Feature                 | What it does                                                                                                                                                                | Status | Milestone | Stories |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | ------- |
| Upload and download     | Attach photos and documents to assets, models, assignments and more; direct upload to S3-compatible storage (MinIO in development) or local disk; size cap per organisation |   ✅   |    M2     | FILE-01 |
| Virus scanning          | Every upload is scanned by ClamAV before it can be downloaded; infected files are blocked and the uploader is notified                                                      |   ✅   |    M2     | FILE-02 |
| Thumbnails and pictures | Thumbnails for images, a primary picture on assets and models, optional EXIF stripping                                                                                      |   ✅   |    M2     | FILE-03 |
| Attachments panel       | Reusable upload and list component with progress, scan state and delete confirmation                                                                                        |   ✅   |    M2     | FILE-04 |
| Upload security         | File type checked against content, SVG and HTML refused, signed download links                                                                                              |   ✅   |    M2     | SEC-02  |

## 8. Scanning and labels

| Feature                            | What it does                                                                                                                                                                     | Status | Milestone | Stories                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | ------------------------------------------------------ |
| QR and scan-code lookup            | Each asset has an opaque public code; a scanned QR (`/s/<code>`), label code, asset tag or exact serial opens the asset; unknown codes reveal nothing                            |   ✅   |    M2     | TAG-01                                                 |
| USB barcode scanner and scan panel | Keyboard-wedge scanner or manual entry resolves a code anywhere in the app, with a batch mode                                                                                    |   🟡   |    M2     | LIFE-08 (needs a test with the founder's real scanner) |
| Label sheets (PDF)                 | Choose assets (selection or the current filter), a template, a start position, QR and/or Code128 and fields; generated in the background with a download link and a notification |   ✅   |    M2     | TAG-02, TAG-03                                         |
| Six label templates                | Fixed templates including Avery 5163 and A4 24-up, with calibration offsets                                                                                                      |   ✅   |    M2     | TAG-02                                                 |
| Print and scan calibration         | Verify the templates against real label stock and scanners (die-line geometry is unverified until then)                                                                          | ⏳ 👤  |    M2     | M2-TAG-04                                              |
| Label copies, outlines and logo    | Available in the API, no screen yet                                                                                                                                              |   🟡   |    M2     | TAG-03                                                 |
| Camera scanning in the browser     | QR and barcodes with a ZXing fallback for iOS Safari (Should)                                                                                                                    |   ⏳   |    M3     | M3-WEB-01                                              |
| Camera scanning on the phone       | QR, Code128 and DataMatrix in the Expo app, with a manual-entry fallback                                                                                                         |   ⏳   |    M3     | M3-SCAN-01, M3-SCAN-02                                 |

## 9. Stock (accessories and consumables)

| Feature              | What it does                                                                                                            | Status | Milestone | Stories |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | ------- |
| Accessories          | Items like cables and docks tracked by quantity: check out to people, partial returns, derived availability, scan codes |   ✅   |    M2     | ACC-01  |
| Consumables          | Items that are used up: receive, issue, return, adjust (with a note) on an append-only ledger with a running balance    |   ✅   |    M2     | ACC-02  |
| Minimum-stock alerts | Notify the stock managers once when an item crosses its minimum, re-armed on restock                                    |   ✅   |    M2     | ACC-03  |
| Stock screens        | Stock list with a low-stock filter, detail page, check-out and check-in with quantities, movement history, holders      |   ✅   |    M2     | ACC-04  |

## 10. Repairs

| Feature                               | What it does                                                                                                                                                                                                           | Status | Milestone | Stories                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | ----------------------- |
| Repair log                            | Open, update, complete or cancel a repair with vendor, cost and notes; the asset is moved to a not-deployable status and restored on completion; a repair logged for an already not-deployable asset adopts its status |   ✅   |    M2     | MNT-01                  |
| Repair screens                        | Open-repairs list, Repairs tab on the asset with the cost total, open and complete dialogs                                                                                                                             |   ✅   |    M2     | MNT-02                  |
| No-open-repair hint                   | The asset form, page and bulk edit say when an asset is not deployable but has no open repair, with a "Log a repair" shortcut                                                                                          |   ✅   |    M2     | post-review fix (0.2.3) |
| Force check-in when opening a repair  | Available in the API, no screen yet                                                                                                                                                                                    |   🟡   |    M2     | MNT-02                  |
| Maintenance schedules and work orders | Preventive maintenance                                                                                                                                                                                                 |   ⏳   |    v2     | parked                  |

## 11. Notifications

| Feature                | What it does                                                                                                           | Status | Milestone | Stories         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | --------------- |
| In-app notifications   | Bell with unread count, list, mark read and mark all read                                                              |   ✅   |    M2     | NOT-01, NOT-02  |
| E-mail and digests     | Instant or daily-digest e-mail per user; per-user preferences (Account > Notifications)                                |   ✅   |    M2     | NOT-01, NOT-02  |
| Notification rules     | Administrators choose who is notified for which event (Settings > Notifications)                                       |   ✅   |    M2     | NOT-02          |
| Events covered         | Infected upload, asset checked out, export ready, import finished, low stock (consumables and accessories), label batch ready or failed |   ✅   |    M2     | NOT-01          |
| Loan events            | Overdue loans (daily while out, the text escalates after a week and two weeks) and due-soon reminders for loaner loans reach the borrower with a login and the pool owner or managers |   ✅   | M2 wave 3 | LOAN-03         |
| Import finished        | The person who ran an import is told when it is done, with the counts                                                  |   ✅   | M2 wave 3 | IMP-05          |
| Delivery log screen    | Available in the API, no screen yet                                                                                    |   🟡   |    M2     | NOT-02          |
| Slack and Teams        | Chat notifications                                                                                                     |   ⏳   |   v1.1    | parked          |
| Mobile push            | Phone push notifications (Cloud only)                                                                                  |   ⏳   |    M6     | M6-MOBL-03      |

## 12. Views and export

| Feature                 | What it does                                                                                                                                                      | Status | Milestone | Stories              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | -------------------- |
| Saved views             | Save filters, columns and sort on the assets list; rename, delete, share with the whole organisation (needs `view:share`)                                         |   ✅   |    M2     | REG-01               |
| CSV export              | Export assets, people or locations from their lists as a background job with a short-lived download link and a notification                                       |   ✅   |    M2     | REG-02               |
| Full tenant data export | Everything as CSV plus JSON and attachments, for self-hosted portability                                                                                          |   ⏳   |    M4     | M4-SHA-02            |
| Standard reports        | Ten reports (inventory, by location, by assignee, aging, warranty expiry, licence expiry, checkout history, stocktake variance, cost, loaner/overdue) with export |   ⏳   |    M5     | M5-RPT-01, M5-RPT-02 |

## 13. Dashboard

| Feature        | What it does                                                                                                                                                                     | Status | Milestone | Stories                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | ----------------------- |
| Dashboard      | Real counts for Ready, Assigned, Not deployable and Overdue (each opens the filtered asset list) and "Needs attention" panels for overdue check-outs, low stock and open repairs |   ✅   |    M2     | post-review fix (0.2.3) |
| Full dashboard | Counts by status, category and location, expiring items, recent activity, role- and scope-aware widgets                                                                          |   ⏳   |    M5     | M5-RPT-03               |

## 14. Web app experience

| Feature                  | What it does                                                                                                                 | Status | Milestone | Stories                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | ---------------------- |
| Application shell        | Sidebar with tooltips, command palette, keyboard shortcuts (`?` lists them), light, dark and system theme, responsive layout |   ✅   |    M1     | WEB-01, WEB-02, WEB-04 |
| Accessibility checks     | Automated axe checks in light and dark for every screen                                                                      |   ✅   |  M1, M2   | WEB-02                 |
| Language                 | All text goes through translation keys; English only today                                                                   |   🟡   |    M1     | WEB-01                 |
| Founder acceptance of M2 | Walk-through of the M2 build on the running stack                                                                            | ⏳ 👤  |    M2     | M2-UX-01               |

## 15. Import

| Feature                                | What it does                                                                                                                                                                                      | Status | Milestone | Stories            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | ------------------ |
| Import engine and API                  | Upload a CSV or XLSX (UTF-8, UTF-16, Windows-1252; any delimiter; 100,000 rows), see the columns profiled, map them, run a dry run that changes nothing, commit in batches, cancel, resume after a crash | ✅ 0.2.5 |  M2 wave 3 | IMP-01..05         |
| Column and value mapping               | Suggested mapping from header names, custom fields, value mapping for statuses, categories, models, locations, people and departments, create-or-must-exist per kind, dates and numbers with a chosen format, saved mapping templates | ✅ 0.2.5 |  M2 wave 3 | IMP-03             |
| Dry run and error report               | Every row validated by the same code as the API and classified create, update, skip or error with the field and the message; downloadable error CSV (formula-safe) to fix and upload again      | ✅ 0.2.5 |  M2 wave 3 | IMP-04             |
| Safe updates                           | Match by asset tag, serial or external id; skip, update or report existing records; a record edited after the dry run is not overwritten; the replaced values are stored (for undo)              | ✅ 0.2.5 |  M2 wave 3 | IMP-05             |
| Google Admin ChromeOS template         | One-click mapping for a Google Admin device export (serial, asset ID, status, model, OS version, last sync, user, org unit, MAC addresses); Chromebook category and fields created; re-import updates by serial | ✅ 0.2.5 |  M2 wave 3 | M2-IMP-06          |
| Generic templates                      | Downloadable CSV or XLSX templates with example rows and a data dictionary for assets, people, locations and departments; parent locations are created from paths                                | ✅ 0.2.5 |  M2 wave 3 | M2-IMP-07          |
| Import wizard screens                  | Choose type and file (CSV or XLSX), review the column mapping and the values, dry-run preview with filters, commit with progress and cancel, results and the error report, saved mappings, templates to download; an import list to resume | ✅ 0.2.5 | M2 wave 3 | IMP-08             |
| Import data retention                  | The rows, sample cells and the uploaded file of a finished import are removed after 30 days (`IMPORT_ROW_RETENTION_DAYS`); the counts, summary and audit trail stay | ✅ 0.2.5 | M2 wave 3 | ED-25              |
| Import test corpus and real-data trial | Messy fixtures in CI and an anonymised real file from the founder (the Google export sample today is synthetic)                                                                                   | ⏳ 👤  | M2 wave 3 | M2-IMP-09          |
| Snipe-IT importer                      | Import from a running Snipe-IT instance (URL and token) with history                                                                                                                              |   ⏳   |    M5     | M5-SNIPE-01..05    |
| Import undo                            | Roll back an import (before-images are recorded for it)                                                                                                                                           |   ⏳   |   v1.1    | parked             |

## 16. Platform and operations

| Feature                                                  | What it does                                                                                                      | Status | Milestone | Stories                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | :----: | :-------: | --------------------------------------------------------------- |
| Audit log (recording)                                    | Every state-changing action is written to an append-only audit log in the same transaction ([AUDIT.md](AUDIT.md)) |   ✅   |    M1     | PLAT-04                                                         |
| Audit log screen and export                              | Browse, filter and export the audit log; retention by plan tier                                                   |   ⏳   |    M5     | M5-AUD-01, M5-AUD-02                                            |
| API and API keys                                         | A documented REST API ([API.md](API.md)); scoped, expiring, revocable API keys created through the API            |   🟡   |    M1     | PLAT-02, PLAT-03; key screens and last-used tracking: M5-API-01 |
| General rate limits                                      | Per-tenant request limits by plan with `RateLimit-*` headers (sign-in throttling exists today)                    |   ⏳   |    M5     | M5-API-02                                                       |
| Webhooks                                                 | Signed, retried event delivery with a delivery log and replay                                                     |   ⏳   |    M5     | M5-HOOK-01..03                                                  |
| Background jobs and outbox                               | Reliable jobs and events behind labels, exports, scans, mail and notifications                                    |   ✅   |    M1     | PLAT-05..07                                                     |
| Encrypted secrets and e-mail                             | Envelope encryption for secrets (such as MFA seeds); outgoing mail through SMTP (Mailpit in development)          |   ✅   |    M1     | PLAT-08, PLAT-09                                                |
| Logging, metrics and health                              | Structured logs with secret redaction, metrics on an internal port, liveness and readiness probes                 |   ✅   |    M1     | OPS-01                                                          |
| Performance budgets                                      | Asset list, search and tag lookup within budget on 2 x 50,000 assets, checked nightly                             |   ✅   |    M1     | CI-05, REG-07, REG-08                                           |
| Security scanning                                        | Dependency audit, secret scan, image scan, SBOM and code scanning on every change                                 |   ✅   |    M1     | CI-03                                                           |
| Isolation suite extension and performance harness for M2 | More route coverage and custody/import budgets                                                                    |   ⏳   | M2 wave 3 | M2-SEC-01, M2-OPS-01                                            |
| User guides                                              | End-user documentation drafts                                                                                     |   ⏳   | M2 wave 3 | M2-DOC-01                                                       |

## 17. Self-hosted edition

| Feature                                              | What it does                                                                                                                                                                  | Status | Milestone | Stories                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------: | --------------------------------------------------------------------- |
| Development stack                                    | `docker compose up` runs Postgres 18, PgBouncer, API, worker, scheduler, mail catcher, MinIO and ClamAV and seeds two demo organisations; for development, not for production |   🟡   |    M1     | REPO-02..05 (no production bundle; read-only root filesystem not set) |
| Production Compose bundle                            | Versioned bundle with a reverse proxy and TLS, bundled or external database and storage, first-run setup, operator scripts                                                    |   ⏳   |    M4     | M4-BND-01..06                                                         |
| Licence system                                       | Offline-verified signed licence with asset bands and enforcement states, licence screen                                                                                       |   ⏳   |    M4     | M4-LIC-01..04                                                         |
| Release pipeline and upgrades                        | Signed images, fresh-install and upgrade tests, licence-gated registry                                                                                                        |   ⏳   |    M4     | M4-REL-01..06                                                         |
| Operator documentation, security review, partner kit | Install, upgrade, backup guides; security review before real users; design-partner onboarding                                                                                 |   ⏳   |    M4     | M4-SHA-03..06                                                         |
| Retention role                                       | Audit retention, tenant offboarding purge and data-subject deletion through a dedicated database role                                                                         |   ⏳   |    M4     | M4-DB-01, M4-DB-02                                                    |

## 18. Mobile app

| Feature                                      | What it does                                                                                                                                                       | Status | Milestone | Stories                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----: | :-------: | --------------------------------------------- |
| Expo app (iOS and Android)                   | Scan a label, see the asset, check out, check in or transfer, photograph, log a repair; online-first with a retry queue that replays with the same Idempotency-Key |   ⏳   |    M3     | M3-MOB-01..05, M3-SCAN-01..02, M3-FLOW-01..06 |
| Server setup by QR code                      | Point the app at a self-hosted server by scanning a setup QR                                                                                                       |   ⏳   |    M3     | M3-MOB-03                                     |
| Stocktake on the phone and web               | Count sessions with found, missing and unexpected results                                                                                                          |   ⏳   |    M3     | M3-STK-01..03                                 |
| Device test matrix, store readiness, updates | Real-device tests, store review readiness, over-the-air updates                                                                                                    |   ⏳   |    M3     | M3-QA-01..04                                  |
| Store submission                             | App Store and Google Play release                                                                                                                                  |   ⏳   |    M6     | M6-MOBL-01, M6-MOBL-02                        |

## 19. Cloud SaaS

| Feature                                | What it does                                                                                                      | Status | Milestone | Stories                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | :----: | :-------: | ------------------------------- |
| Cloud infrastructure                   | AWS baseline, data tier, application tier and delivery pipeline                                                   |   ⏳   |    M6     | M6-INF-01..05                   |
| Self-serve signup and tenant lifecycle | Sign up, onboarding wizard, suspend, export, delete; quotas and a support console                                 |   ⏳   |    M6     | M6-TOPS-01..04                  |
| Billing and entitlements               | Stripe checkout, plans (Free 250, Starter 500, Pro 2,500 assets, Enterprise), active-asset meter, dunning and tax |   ⏳   |    M6     | M6-BILL-01..04                  |
| Monitoring, backups, capacity          | Observability, alerting, status page, timed restore drill, load test                                              |   ⏳   |    M6     | M6-MON-01..04                   |
| Security and compliance                | Isolation verification on the real stack, external penetration test, WAF and hardening, compliance pack           |   ⏳   |    M6     | M6-SEC-01..04                   |
| Public docs, pricing, launch           | Public documentation, support process, launch readiness review and founder acceptance                             |   ⏳   |    M6     | M6-GTM-01..02, M6-LAUNCH-01..02 |

## Not scheduled

Parked beyond M6 in the backlog (section 11): discovery agent and installed-software inventory, offline-first mobile app, Helm
chart and air-gapped install, Vault or KMS key adapter, contracts, work orders and PM schedules, rules and approvals, no-code
report builder, multi-company UI, custom roles, AI features, ITSM connectors, label template editor.
