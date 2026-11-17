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
