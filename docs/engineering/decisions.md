# Engineering decisions (ED log)

Status: ACCEPTED by the founder on 2026-11-17. Scope: the data model, schema and API contract in this folder (`data_model.md`, `schema.sql`, `openapi.yaml`). These decisions resolve the open questions that were listed in section 11 of `data_model.md`; each entry says what changed, or what is only recorded for a later milestone.

Milestone = the milestone in which the decision takes effect (M1 tenancy/identity/registry, M2 custody, M3 stocktake and mobile, M4 first real users, M5 integrations).

| ED | Title | Milestone | Effect now |
|---|---|---|---|
| ED-01 | `person` is separate from `user_account` | M2 | recorded (already modelled) |
| ED-02 | State type `undeployable` | M1 | recorded (already modelled) |
| ED-03 | Stocktake belongs to M3 | M3 | note in `data_model.md` |
| ED-04 | Mobile auth: OIDC + PKCE, short-lived access token, rotating refresh token | M3 | note in `data_model.md`, no OpenAPI change |
| ED-05 | Separate narrow DB role and pool for `identity` lookups before M4 | M1 now, M4 change | note in `data_model.md` |
| ED-06 | Audit retention, offboarding and DSAR deletion through a dedicated retention role | M4 | note in `data_model.md` |
| ED-07 | Location scoping via `ancestor_ids` in the repository layer; RLS stays tenant-only | M2 | recorded (already modelled) |
| ED-08 | Database-side `uuidv7()` defaults removed; schema runs on PostgreSQL 16, 17 and 18 | M1 | `schema.sql` changed |
| ED-09 | `asset_history` partitioned monthly from day one | M2 | `schema.sql` changed |
| ED-10 | Import and integration credentials in an encrypted `integration_connection` table | M5 | note in `data_model.md` |
| ED-11 | Accessory partial returns via `quantity_returned` | M2 | `schema.sql` and `openapi.yaml` changed |
| ED-12 | Asset tags are never reused | M1 | recorded (already modelled) |
| ED-13 | Check-out, check-in and transfer return the updated asset and the assignment | M2 | `openapi.yaml` changed |
| ED-14 | Auth contract completion (2026-11-18) | M1 | `openapi.yaml` changed |
| ED-15 | Locations, people and custody as built (M2 wave 1) | M2 | `openapi.yaml` changed, migrations 0040-0041 |
| ED-16 | Editing a location: `kind` is free, address limits are named on their field (founder report 2026-11-24) | M2 | `openapi.yaml` changed (`Address.country` pattern) |
| ED-17 | Managed departments replace the free-text department (founder request 2026-11-24) | M2 | `openapi.yaml`, `data_model.md`, `schema.sql` changed, migration 0100 |
| ED-18 | The import as built: one row per file row, one worker job per batch, a dry run that runs the real validators (M2-IMP) | M2 | `openapi.yaml` (Imports replaced), `data_model.md`, `schema.sql` changed, migration 0110, ADR 0010 |
| ED-19 | What an import keeps, who may read it, and how files round-trip | M2 | permissions, `import_row` content, formula guard, retention note |

## ED-01. `person` is separate from `user_account`

- **Decision.** The assignee of a custody period is a `person` (employee, student, contractor, external), which may have no login. `user_account` holds only login-capable accounts; a person optionally links to one (`person.user_id`, unique). `assignment.person_id` targets a person, never a user. One person row is auto-created for each user.
- **Rationale.** The education case has thousands of students who never log in; forcing them into the authentication tables would bloat them and blur the security boundary. Directory sync (SCIM, Entra/Google in v1.1/v2) naturally writes people, not accounts.
- **Consequences.** Departs from the plan's `ASSIGNMENT.user_id` and `USER_ACCOUNT.can_login` (data_model.md section 8). Offboarding works on people (`GET /v1/people/{id}/assignments`). Disabling a user does not touch the person's custody.
- **Milestone.** M2 (tables `app.person`, `app.assignment`). Already in `schema.sql`.

## ED-02. State type `undeployable`

- **Decision.** `status_label.state_type` is one of `deployable`, `deployed`, `pending`, `undeployable`, `archived`, `lost`. `undeployable` is added to the plan's five types; "In repair" and "Broken" are seeded labels of that type.
- **Rationale.** A broken or in-repair asset must not be checkable out, but it is not archived (still owned, still in the registry) and not pending (not waiting for an event). Without the type the lifecycle module would need a second flag.
- **Consequences.** Only `deployable` assets can be checked out; opening a repair moves an asset to an `undeployable` label and completing it restores `restore_status_id`. The plan's list of state types is superseded.
- **Milestone.** M1 (`app.status_label`). Already in `schema.sql`.

## ED-03. Stocktake belongs to M3

- **Decision.** Stocktake (physical audit: a counting session over a location or category, scanned items, found/missing/unexpected outcomes) is delivered in M3 together with the Expo scanning flows. It is not part of M1 or M2.
- **Rationale.** The stocktake workflow is driven by the mobile scanner; building the tables before the client exists would freeze a shape nobody has exercised.
- **Consequences.** No stocktake tables, endpoints or permissions in this folder. `data_model.md` carries a short "Planned M3" note listing the entities. Plan 5.2 still counts stocktake as an MVP Must; it ships with M3, not M2.
- **Milestone.** M3.

## ED-04. Mobile authentication: OIDC with PKCE, short-lived access token, rotating refresh token

- **Decision.** The Expo app authenticates with the OIDC authorization-code flow with PKCE and holds a short-lived access token plus a rotating refresh token (each refresh returns a new refresh token and invalidates the old one; replay of a used refresh token revokes the whole token family). The token endpoints are added in M3. Device-scoped API keys are not used for people.
- **Rationale.** Matches architecture section 9, keeps long-lived secrets out of the app binary, and gives per-device revocation. API keys stay for integrations and scripts.
- **Consequences.** The contract today has only the session cookie and API-key bearer auth; no OpenAPI change is made now. M3 will add token and refresh endpoints and an identity table for hashed refresh tokens (see the "Planned M3 endpoints" note in `data_model.md`).
- **Milestone.** M3.

## ED-05. Narrow DB role and pool for `identity` lookups before M4

- **Decision.** In M1 the runtime role `app_user` reads and writes the `identity` tables (no RLS, hashes and ids only) through the same pool as tenant queries. Before M4 (first real users) a narrow second role (working name `app_auth`) with its own connection pool takes over every `identity` access, and `app_user` loses its grants on `identity`.
- **Rationale.** With one role, a SQL-injection bug in a tenant query could read `identity.credential` and `identity.session` for all tenants. A second role closes that at the cost of a second pool; deferring it to M4 avoids the work while only test data exists.
- **Consequences.** The auth module must be the only code that touches `identity`, so the later split is a configuration change plus grant changes, not a refactor. Tracked as a hard gate for M4. See the tenancy section of `data_model.md`.
- **Milestone.** M1 (accepted exposure), changed in M4.

## ED-06. Audit retention, offboarding and DSAR deletion through a retention role

- **Decision.** `app_user` stays append-only on `audit_log` (and `asset_history`). Retention by plan tier, tenant offboarding purge and DSAR deletion run through a dedicated DB role (working name `app_retention`) that holds `DELETE` on those tables, is subject to RLS (it sets the tenant per run) and whose actions are themselves written to the audit log. Introduced in M4.
- **Rationale.** Keeps the append-only guarantee for the request path while still allowing the deletions the law and the pricing tiers require, without per-tier partitioning.
- **Consequences.** Not in `schema.sql` yet. Grants on the partitioned parents only, as for every other role (no grants on partitions).
- **Milestone.** M4.

## ED-07. Location scoping through `ancestor_ids`; RLS stays tenant-only; no `ltree`

- **Decision.** A role assignment scoped to a location (`scope_type = location`) is enforced by the repository layer using `location.ancestor_ids` (`ancestor_ids @> ARRAY[<id>]`, GIN-indexed with `tenant_id` first). Row-level security stays tenant-only. `ltree` is not used for now.
- **Rationale.** Keeps the isolation-critical policy trivial and uniform; the array column is trigger-maintained and fast enough for the expected depth and size (architecture 5.1).
- **Consequences.** Every repository query on a location-scoped resource must apply the scope; this is covered by `PolicyService` tests, not by the database. Revisit `ltree` only if subtree queries become a measured bottleneck.
- **Milestone.** M2 (`app.location`). Already in `schema.sql`.

## ED-08. No database-side `uuidv7()` defaults; PostgreSQL 16, 17 and 18

- **Decision.** Cloud runs PostgreSQL 18; the self-hosted edition supports bring-your-own PostgreSQL 16 and 17. Every `DEFAULT uuidv7()` is removed from `schema.sql`. Ids are always generated by the application as UUIDv7 and passed in the INSERT. `schema.sql` uses no other PostgreSQL 18 feature and is tested on 16, 17 and 18.
- **Rationale.** `uuidv7()` exists only in 18. One schema for every deployment avoids a second migration track.
- **Consequences.** SQL-side inserts and seeds must supply ids. `app.provision_tenant` seeds its rows with `gen_random_uuid()` (v4, PostgreSQL 13+), which is fine because nothing relies on seed ids being time-ordered. `app.schema_lint()` has a new rule that fails the install if a `uuidv7()` default reappears. `asset.label_code` keeps its `gen_random_uuid()` default (13+). Features used and their minimum versions are listed in the `schema.sql` header.
- **Milestone.** M1 (schema baseline).

## ED-09. `asset_history` partitioned monthly from day one

- **Decision.** `app.asset_history` is range-partitioned by month on `at`, with a default partition, under the same rules as `audit_log`: `app_user` holds `SELECT, INSERT` on the parent only; every partition has `FORCE ROW LEVEL SECURITY` and the tenant policy and no grants; no `ALTER DEFAULT PRIVILEGES`. The primary key is `(id, at)`.
- **Rationale.** It is the highest-volume table after the audit log (every status, location and custody change); converting a populated table to partitioned later is a painful migration.
- **Consequences.** The old `UNIQUE (tenant_id, id)` is gone (a unique key on a partitioned table must contain the partition key, and nothing references the table). One factory, `app.ensure_partitions(from, months)`, creates both tables' partitions (it replaces `ensure_audit_partitions`); the maintenance job must run it monthly. Retention for this table falls under ED-06.
- **Milestone.** M2.

## ED-10. Import and integration credentials in `integration_connection`

- **Decision.** Credentials for imports and integrations (for example the Snipe-IT URL and API token) are stored envelope-encrypted in an `integration_connection` table, not in `import_job.options`.
- **Rationale.** Secrets must not sit in a plain jsonb column that appears in exports, logs and API responses.
- **Consequences.** Until M5 the Snipe-IT importer is the only consumer and `import_job.options` must not be used for tokens. Recorded only; no DDL now.
- **Milestone.** M5.

## ED-11. Accessory partial returns via `quantity_returned`

- **Decision.** `assignment` gets `quantity_returned integer NOT NULL DEFAULT 0`. A partial return of an accessory increments it on the same row, which stays open; the return that makes `quantity_returned = quantity` also sets `checked_in_at`. Constraints: `0 <= quantity_returned <= quantity`, and `(checked_in_at IS NULL) = (quantity_returned < quantity)`. A trigger rejects changing `quantity` and decreasing `quantity_returned`. Outstanding units are `quantity - quantity_returned` (stock check and `v_accessory_availability`). An asset (quantity 1) closes with `quantity_returned = 1`. The accessory check-in request accepts `quantity`.
- **Rationale.** One row per custody period is kept (no close-and-reopen churn, stable assignment ids for the history and attachments).
- **Consequences.** `Assignment` in the OpenAPI contract has `quantity_returned`. Each partial return is recorded in the audit log, since the row only keeps the running total. Application code that closes an assignment must set both columns in the same UPDATE.
- **Milestone.** M2.

## ED-12. Asset tags are never reused

- **Decision.** The unique index on `lower(asset_tag)` covers archived assets, so a tag is never reassigned, even after a retention period. `app.next_asset_tag` only moves forward.
- **Rationale.** Printed labels and history stay unambiguous; a reused tag could make an old label resolve to a different asset.
- **Consequences.** To re-tag, create a new tag. No reuse job is built.
- **Milestone.** M1 (already in `schema.sql`).

## ED-13. Custody responses return the asset and the assignment

- **Decision.** `POST /v1/assets/{id}/checkout`, `/checkin` and `/transfer` return the updated asset (with its new `ETag` in the response header) together with the assignment (`{asset, assignment}`; transfer adds `transfer`). The loaner-pool check-out returns the same shape, because the client may not know which pool member was chosen.
- **Rationale.** Clients chain the next call (for example a check-in right after a scan) without re-fetching the asset, and always hold a current `ETag`.
- **Consequences.** New schema `CustodyResult`; `TransferResult` now includes `asset`. The accessory check-out and check-in keep returning the assignment alone (there is no asset ETag involved). Client code written against the earlier draft (bare `Assignment`) must read `assignment` from the body.
- **Milestone.** M2.

## ED-14. Auth contract completion (2026-11-18)

- **Decision.** The contract now covers every auth screen the web team built, plus the admin operations the M1-AUTH backlog implies (18 operations, 114 -> 132 on 82 paths).
  - Password reset: `POST /v1/auth/password/forgot` (always 202, no account enumeration), `POST /v1/auth/password/reset` (204; 404 `token-invalid`, 410 `token-expired`, 422 at `/password`; revokes every session).
  - Invitations: `GET /v1/auth/invitations/{token}` (`InvitationInfo`), `POST /v1/auth/invitations/accept` (returns `LoginResponse`; 404 `invitation-not-found`, 410 `invitation-expired`), admin `POST /v1/users/{id}/invitation/resend` and `DELETE /v1/users/{id}/invitation`.
  - MFA (TOTP): `POST /v1/auth/mfa/enrol`, `POST /v1/auth/mfa/enrol/confirm` (ten recovery codes, once), `POST /v1/auth/mfa/recovery-codes/regenerate` and `DELETE /v1/auth/mfa` (both need password or TOTP in the body; wrong value is 403 `reauth-failed`, never 401; disable is 403 `mfa-required-by-policy` when the tenant enforces MFA), admin `DELETE /v1/users/{id}/mfa`. Secret-bearing responses are never stored for idempotent replay, so these operations take no `Idempotency-Key`.
  - Sessions: `GET /v1/auth/sessions`, `DELETE /v1/auth/sessions/{id}` (409 `cannot-revoke-current`), `DELETE /v1/auth/sessions` (all others), admin `GET /v1/users/{id}/sessions` and `DELETE /v1/users/{id}/sessions/{session_id}` (M1-AUTH-03: user and admin can revoke).
  - Search: `GET /v1/search?q&types&limit` returns `{data:[{type,id,label,sublabel,href_hint}]}`, filtered per type by the caller's permissions. M1 returns asset, model and category only; person and location are accepted but empty until M2.
  - `GET /v1/auth/me` gains `mfa_enrolment_required`, `session` (`idle_expires_at`, `absolute_expires_at`; null for API keys) and `tenant.branding` (`logo_url`, `accent_color`, both null until M4+).
  - `GET /v1/auth/password-policy` (public) and schema `PasswordPolicy`: min length 12, max 128, no composition rules, breached-password check (bundled local list always; optional online k-anonymity provider).
  - Problem codes: a catalogue of every `code` (root `x-problem-codes`, schema `ProblemCode`), and each error response lists its own codes in `x-problem-codes`.
- **Rationale.** The web screens were built against proposed shapes; fixing them in the contract lets the web and API sides converge without a later rename, and the code catalogue makes error handling testable. Re-authentication failures are 403, not 401, so clients keep `401` for "session gone".
- **Consequences.** (1) The contract keeps the codes the platform code already emits: `validation` (not `validation-failed`), `idempotency-key-reuse` and `too-many-requests` (not `rate-limited`), plus `unauthorized` for a generic 401. (2) New permission `search:read`, granted to every built-in role, for `GET /v1/search`; self-service auth operations carry `x-self-service: true` instead of `x-permission` (the role matrix test must whitelist them). (3) `schema.sql` has no table for password-reset tokens yet: M1-AUTH-05 needs `identity.password_reset_token` (hash PK, tenant_id, user_id, expires_at, used_at), mirroring `identity.invitation_token`; not added here. Tenant branding and the MFA-enforcement flag live in `app.tenant.settings` (jsonb), so no DDL. (4) Revoking an invitation archives the never-activated account; resend replaces the token.
- **Milestone.** M1 (M1-AUTH-02 to 07); branding values M4+.


## ED-15. Locations, people and custody as built (M2 wave 1)

- **Decision.**
  - **People.** Every login account has exactly one `person`, created (or linked, when an unlinked person with the same email exists) by a database trigger on `user_account`, so every code path that creates a user gets it. There is no separate "link a person to a login" endpoint: the link is made by email when the account is created. Deactivating a person who still holds assets is `409` with `usage.open_assignments` unless the update carries `force: true` and a `reason` (stored in the audit trail only); an inactive person cannot receive assets; a person with a login account cannot be archived.
  - **Locations.** At most ten levels (`depth <= 9`); a move rewrites the subtree in the database (trigger) and is serialised per tenant by an advisory lock; archiving is refused with counts of children, assets, people and open assignments. `asset_count` includes descendants and is computed per request.
  - **Custody.** Check-out, check-in and transfer lock the asset row, answer `{asset, assignment}` (transfer adds `transfer`) with the asset's new ETag, require an `Idempotency-Key` and accept an optional `If-Match`; the asset row is always touched so its ETag changes with every custody change. Only a `deployable` asset can be checked out (new problem code `asset-not-deployable`; `asset-already-checked-out` and `asset-not-checked-out` are now emitted). Lost assets cannot be checked out; marking an asset lost closes its open custody; disposal sets an archived-type status, archives the asset and records reason, date and note (`Asset.disposal`); restoring a disposed asset clears the record. The allowed action per state is one table (`registry/asset-actions.ts`), used by the services, by `scan/resolve` (`allowed_actions`) and by the state-machine test.
  - **History.** `asset_history` is written in the same transaction as every change of an asset (created, updated, status and location changes, custody, archive and restore, lost and found, disposal) with the actor (user, or API key by name). Two custody events carry attachment ids only as ids (no existence check until the attachments service meets this branch).
  - **Contract additions** (all in `gen.mjs`): `POST /v1/assets/{id}/move`, `POST /v1/assets/bulk-move`, `/dispose`, `/mark-lost`, `/mark-found`, `GET /v1/people/{id}/history`; `asset_count`, `direct_asset_count`, `child_count` on `Location`; `assets_held` on `Person` and `force` / `reason` on `PersonUpdate`; `overdue`, `attachment_ids`, `checkin_attachment_ids`, `asset_tag`, `asset_name` on `Assignment`; `overdue` on `AssignmentSummary` and as an asset filter; `disposal` on `Asset`; `asset_tag` on `HistoryEvent`; the asset filters `include_sublocations`, `assigned`, `assigned_person_id` and `overdue` are live; search returns people and locations.
- **Rationale.** The first drafts left these rules to the implementer; pinning them keeps the web and mobile clients, the importer and the later waves (accessories, loaners, repairs) on one behaviour.
- **Consequences.** Not built (reported to the integrator): default location on models and categories (M2-LOC-02 mentions it, the contract has no field), location scoping of roles (M2-LOC-03, last by plan), an explicit person-to-login link action. The accessory and loaner foreign keys on `assignment` and the attachment validation are left to the integrator (see `data_model.md` 3.6.1). Update: the attachment validation was done in wave 1b and the accessory foreign key and stock trigger in wave 2 (migration 0080, ADR 0008); only the loaner foreign key is open.
- **Milestone.** M2.

## ED-16. Editing a location: `kind` is free, address limits are named on their field

- **Report.** "Location edit for site [type]: at edit time I got an error but right now I did not get it." Reproduced against the real stack: only a **site** shows the address fields, and an address value over its limit (typically a country name instead of the two-letter code) is a `422` whose pointer is `/address/country`. The edit dialog matched pointers to fields by name only, so it could not place that pointer and showed the generic "The request body failed validation (1 problem)" with no field marked; the same edit with a valid value (a two-letter code, or the field left empty) saved, hence "right now I did not get it". No `500` exists on any edit path: every scenario of the report (rename, change of kind, move, duplicate name, stale ETag, archived location, role) was replayed against the API and answers with a documented 2xx / 4xx.
- **Decision.**
  - **`kind` is editable at any time** and there are **no rules between `kind` and the tree**: a site may have a parent (a campus of sites, a site inside a region location), a room may be a root, any kind may have children and assets, changing the kind never moves, archives or recounts anything and is audited as an ordinary update. The only structural rules stay the ones that protect the tree: no cycle (`422`, `/parent_id`, code `cycle`), at most ten levels (`too-deep`), a live parent, a name unique among the live children of a parent (`409`, `/name`).
  - `address.country` must be exactly two letters (ISO 3166-1 alpha-2) and is stored upper-case (`no` is saved as `NO`); every address member has its documented length limit and a violation is a `422` on `/address/<member>`.
  - The generic form dialog (`FormDialog`) maps a nested pointer to the field that lists it (`pointers`), checks the field limits and custom rules before it calls the server (message names the field and the limit), lists a problem that matches no field in the banner instead of hiding it, and answers a `412` with "Someone saved this before you" and a **Reload latest** action that reopens the form with the other version.
  - Changing a site to another kind keeps its address (the address fields are hidden, not cleared; change it back and it is there), and an edit keeps `address.line2`, which the old form silently dropped.
- **Rationale.** The error was a message-quality bug, not an API bug; the fix puts the message on the field and stops the form from losing data. Keeping `kind` free avoids inventing hierarchy rules nobody asked for; the database has none either.
- **Consequences.** `Address.country` gets `pattern: ^[A-Za-z]{2}$` in the contract. Stored addresses written before this with a longer country value are still readable and are re-validated only when edited.
- **Milestone.** M2 (backlog M2-LOC-05).

## ED-17. Managed departments replace the free-text department

- **Decision.**
  - A tenant table **`app.department`** (`name` unique among live rows ignoring case and padding through the stored key `name_key`, optional `code` unique likewise, `description`, optional `manager_person_id`, `archived_at`, `version`) with the tenant conventions (FORCE RLS, composite FKs). People get `department_id`, **assets get an optional `department_id`** (owning / cost-centre department; the plan lists CostCenter / Department as an allocation dimension of Asset; the location stays where the asset is).
  - **Migration 0100** creates one department per distinct trimmed, case-insensitively deduplicated free-text value per tenant (most used spelling wins) and links the people without changing their version. `person.department` (text) is **kept one release as a deprecated, unused column** (nothing reads or writes it; the person read model derives `department` as the name of the linked department) and dropped later; it is not dropped now so that a rollback of the application does not lose the old values.
  - **API.** `/v1/departments` (list with `q`, counts of live people and assets, create, get, patch with `If-Match`, archive). Archiving a department that live people or assets still use is a `409` with `usage` (`people`, `assets`) unless `reassign_to=<id>` moves them to another live department in the same transaction (the merge). `department_id` is a filter of the people and asset lists, a field of both read models, writable on person create / update, asset create / update / bulk update / clone, and `expand=department` embeds it in an asset; the people and asset CSV exports carry the department name. A `department` key on person create / update is a `422` (strict bodies).
  - **Permissions.** `department:read` for every built-in role, `department:manage` for the Asset manager (and the Administrator through `*`); migration 0100 updates existing tenants and replaces `app.provision_tenant` from its definition in 0094.
  - **Web.** Settings -> Departments (list, create, rename, archive with usage message, merge), a type-ahead `DepartmentPicker` on the person form, the asset form and the bulk edit, a department column and filter on People and Assets, and the department on both detail views.
- **Rationale.** Free text produced "Maths", "maths " and "Mathematics" as three departments, which breaks every filter and report. A managed list with ids makes a rename a one-row change and a merge one call.
- **Consequences.** Breaking for API clients that wrote `department` text or filtered by `?department=`: they use `department_id`. The old column is dropped in a later migration. Departments are not yet part of the global search.
- **Milestone.** M2 (backlog M2-ORG-01, M2-ORG-02).

## ED-18. The import as built (M2 wave 3)

- **Decision.**
  - **One `import_row` per file row, both phases.** The data model of the first drafts had a row per `(job, phase, row_no)`; with 100,000 rows that doubles the storage and makes "the rows left to commit" a join. The row now carries the raw cells, the typed record, the dry-run verdict (`plan`, `errors`, `warnings`, `entity_id`, `entity_version`) and the commit verdict (`result`, `result_errors`, `created_id`, `before_image`); its key is `(tenant_id, job_id, row_no)` and nothing else refers to a row. The file is read once, at analysis; every later phase works from these rows.
  - **States** `draft, uploaded, analyzing, analyzed, mapped, dry_running, dry_run_done, committing, completed, failed, cancelled` replace the placeholder set of the contract (`dry_run_queued ... committed`). The `import_job` CHECK still says "no commit without a dry run digest"; the digest now also covers the value map and every row's plan.
  - **Sources and entity types.** `csv`, `xlsx` and `google_admin_csv`; `asset`, `person`, `location`, `department`. `snipe_it` is removed from the contract until M5 builds it (its credentials belong in `integration_connection`, ED-10); accessories, consumables, models and categories are created as **references** of an asset import, not imported as such.
  - **A dry run runs the real validators.** Assets call the facade with `dryRun: true` (it stops before the first write); people, locations and departments run their service in a savepoint that is always rolled back. Nothing the dry run does can disagree with the API.
  - **Matching** (`match_on`: tag, serial or external id; `on_match`: skip, update, error) is decided again at commit time; an update never overwrites a record whose `version` moved since the dry run (`changed-since-dry-run`); an asset that is checked out keeps its status.
  - **One worker job per batch**, queued by the previous batch in its own transaction; resumability is the cursor on the job plus the results on the rows (ADR 0010 section 6). `import.sweep` wakes a job that lost its worker.
  - **References** are resolved by name (ignoring case and padding) after the value map; `create` is the default policy for category, manufacturer, model, location, department and vendor, `must_exist` for status labels (never created) and people. Creating the Chromebook category and fields is part of **creating** a Google preset import, not of its dry run.
  - **Contract.** Tag `Imports` is rewritten in `gen.mjs` (block `[M2-W3 IMP]`): jobs, analysis, apply-template, values, dry run, rows, error report (`errors.csv`), commit, cancel, presets and their template files, saved mapping templates; new problem codes `import-wrong-state` and `import-quota-exceeded`; `import-stale-dry-run` is emitted. Attachments already accepted `import_job` / `import_file`.
  - **Upload sniffing** accepts UTF-16 (BOM) and Windows-1252 CSV for `import_file` attachments (decoded for the markup check only).
- **Rationale.** The drafts were written before the facades, the job queue and the files pipeline existed; the pieces they assumed (a staging area per phase, a worker that holds a transaction per phase) do not fit a pooled, multi-tenant system. The built design keeps the invariants (mandatory dry run, writes only through facades, audit with the job id, before-images stored) and drops the assumptions.
- **Consequences.** The web agent's wizard talks to the replaced contract (the old operations had no implementation). `import_row.raw` is tenant data (ED-19). Rolling an import back is still v1.1. A tenant may run at most `IMPORT_MAX_CONCURRENT` (2) imports at once and `IMPORT_MAX_ROWS` (100,000) rows per file.
- **Milestone.** M2 (backlog M2-IMP-01..07).

## ED-19. What an import keeps, who may read it, and how files round-trip

- **Decision.**
  - **Permissions.** `import:read` (held by every built-in role) lists and shows imports, presets and saved templates: counts, mapping, options, the column profile. Everything that shows rows (`rows`, `values`, the error report) or changes anything needs `import:run`; `GET /v1/imports/{id}` itself carries only the 50 sample rows and the column profile the mapping screen needs. `import:run` is held by the (Administrator and Asset manager), plus the entity's write permission (`asset:create`, `person:manage`, `location:manage`, `department:manage`; `asset:update` when `on_match` is `update`; `asset:checkout` for `assigned_to`; the catalogue's, `department:manage`, `location:manage` or `person:manage` for references the import may create). They are checked when the dry run and the commit are requested; the worker acts as the requesting user and stops if that account is no longer active.
  - **What is kept.** The cells of every row stay in `import_row.raw` (unmapped columns included) with the verdicts; the file stays an attachment. Both are tenant data and may contain personal data (an import of people does). There is **no purge yet**: removing the rows of old imports is a retention job still to be written (reported in `STATUS.md`); until then they stay as long as the job.
  - **Round trip with exports (ADR 0009).** A text cell of the file passes `stripFormulaGuard` (the apostrophe an export put before `=`, `+`, `-`, `@`, tab, CR), so an exported file imports to the original values; the error report goes through the export's CSV writer, so formulas in the file come back guarded. The header names of the exports (`asset_tag`, `serial`, `cf:<key>`, `path` for the ancestors of a location next to its `name`) are recognised by the mapping heuristic.
  - **Audit.** `import_job.created / updated / analysis_requested / dry_run_requested / commit_requested / cancel_requested / cancelled` (the API) and `import.analyzed / dry_run_completed / batch_committed` (one per batch) `/ completed / failed / cancelled` (the worker) are audit entries of the job; the records the import writes are audited as usual with `meta.import_job_id` and `meta.import_row` (assets, people, locations, departments; catalogue records created as references are audited by their own service without the job id, their request id is the worker job's).
- **Rationale.** Raw rows are the only way to offer "fix and re-upload" and a faithful error report; the price is retention, which is named instead of hidden. Splitting read from run keeps the 50 sample rows and counts visible to everybody who may see the registry while the file content stays with the people who import.
- **Consequences.** A retention story (delete `import_row` of jobs older than N days, keep the job) is open. The notification `import.completed` carries counts only.
- **Milestone.** M2 (backlog M2-IMP-01, M2-IMP-04).
