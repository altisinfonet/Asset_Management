# ADR 0011: Loaner pools: a loan is an assignment with a pool, quick flows by scanning, once-per-state alerts

Status: PROPOSED (Claude, 2026-11-24); implements M2-LOAN-01, M2-LOAN-03, the API of M2-LOAN-02 and M2-LOAN-04, and M2-LIFE-09; needs founder sign-off like every ADR.
Date: 2026-11-24. Stories: M2-LOAN-01, M2-LOAN-03 (backend), M2-LOAN-02 and M2-LOAN-04 (the web screens are a separate piece of work), M2-LIFE-09.
Inputs: `docs/engineering/data_model.md` 3.6, migration 0041 (`assignment.loaner_pool_id` without a foreign key, "the loaner migration adds it"), ED-11 and ED-13 (custody), ADR 0004 (outbox, ids-only payloads, jobs), ADR 0005 (RLS-safe indexing), ADR 0009 (NOTIFIER, subscriber table), ED-20, ED-21.

## Context

A school lends Chromebooks from a cart: a teacher scans a pupil's badge and a stack of devices, the devices are due back after a week, and a pile of them is always overdue. The product plan says to model this "with the existing asset and assignment tables; no new entity". The work is to put rules on that (who may borrow, for how long, how many), to make the scan-driven screens possible without a request per device, and to nag about late devices exactly once a day, not once per scheduler restart.

## 1. A loan is an assignment with a pool (DECISION)

`app.loaner_pool` holds the rules (`default_loan_days`, `max_loan_days`, `max_loans_per_person`, `eligible_person_kinds`, `home_location_id`, `owner_user_id`, `is_active`), `app.loaner_pool_member` the membership (primary key `(tenant_id, asset_id)`: one pool per asset). Lending is `CustodyService.checkout` with one extra argument, the pool, which becomes `assignment.loaner_pool_id` (foreign key added by migration 0120). So a loan inherits every guarantee of custody for free: the asset row lock and the partial unique index make the 50-way race on one device yield one winner; `If-Match`, history (`Loaned to ...`), audit and the `asset.checked_out` event (which now also carries `loanerPoolId`) are the same code path. The database already says a loan needs an asset and a due date (`assignment_loan_due`).

Membership does not stop a regular check-out of the same device: the backlog wants both. That assignment has no pool, so it is not a loan: not in the loan lists, not alerted, but it makes the device "out" for the pool's counts, so nobody lends a device somebody else holds.

## 2. Rules are checked where the pool is known (DECISION)

Active pool, active borrower of an eligible kind, limit per person, due date within the maximum: all checked in the loaner service in the lending transaction, **before** the custody call, with the borrower row locked (`SELECT .. FOR UPDATE`) so two parallel scans of one person cannot both pass the limit. The database does not repeat them: they are policy of a pool that an administrator edits, not an invariant of the data (an edit of the limit must not invalidate loans already open).

**Next available device**: lowest asset tag among lendable members, `FOR UPDATE SKIP LOCKED`. Lowest tag is deterministic and easy to explain at the cart ("take the next one in the row"); a least-recently-used order would spread wear but needs a last-return timestamp per device; it can replace the `ORDER BY` later without a contract change.

**The tenant's `default_expected_return_days` is not applied by the API.** M2-LIFE-09 says so explicitly ("the API itself never applies a default silently"); the web pre-fills it. The default of a *loan* is the pool's `default_loan_days`, which is part of the pool's rules and always set. A pool that should follow the tenant default would need `default_loan_days` to be nullable; not built, flagged as an open question below.

## 3. The quick flows are bulk requests with per-item answers (DECISION)

`quick-checkout` (one borrower, up to 50 codes) and `loans/return` (up to 100 codes, any borrowers) follow the platform bulk convention (ADR 0003): HTTP 200 whenever the request itself is valid, `results[]` per item in request order with the status the single operation would have had, `summary` with counts. Each item runs in a savepoint inside one transaction, so a failing scan (unknown code, device already out, over the limit) undoes only itself, and the whole request replays under its `Idempotency-Key`. Request-level problems (unknown pool, switched-off pool, unknown or ineligible borrower) answer the whole request. The borrower is found by `person_id`, or by the scanned text matched against `email_key` (case-insensitive, btree) and `employee_ref` (exact): people have no badge column, and the school's student number is what a badge encodes; if two different people match, the request is `409` and the client asks for the id. Codes use the same lookup as `GET /v1/scan/resolve` (label code or URL, tag, serial; ambiguous serial refused), now one function in the registry; unknown codes are misses of the same enumeration throttle, so the new endpoints are not a way around it.

A return puts the device back where the pool says (`home_location_id`, when that location is still live), because the cart is a place; an explicit `checkin_location_id: null` leaves it where it is. The status goes back to the tenant's deployable default like any check-in.

**Extension** is an action of its own (`POST /v1/loans/{id}/extend`), not a check-out edit: it locks the asset, changes only `expected_return` of the open assignment, bumps the asset's version (its `current_assignment` changed) and writes audit `loan.extended`, an outbox event and an `updated` history entry whose payload carries the change. A new history event type would have needed a database constraint change and a web rendering for something that is a field edit.

## 4. Alerts: a ledger decides, the clock only proposes (DECISION)

The daily job (queue `loan.alerts`, per tenant, singleton-keyed like the digest) selects loans that are overdue or due within the reminder lead time and, for each, **inserts a row into `app.loan_alert` under a unique index and emits the outbox event only if the insert won**. Overdue: unique per loan and day; due soon: unique per loan and due date. A second run the same day, a retry after a crash halfway, and two scheduler replicas all find the rows and stay silent; an extension changes the due date and so re-arms the reminder. The overdue alert repeats every day while the loan is out, because that is what the backlog asks for ("once per loan per day with escalating copy"), and the text escalates at 7 and 14 days. The event carries ids and counters only (ADR 0004); the subscription reads the loan under RLS in the relay's transaction and drops the notification when the loan was returned in the meantime.

Recipients: the borrower when they have a login; for overdue also the pool owner (when set and active) or else everybody holding `loaner:manage`. A borrower without a login is not notified (the NOTIFIER addresses users). Per-user opt-out is the existing notification preference of the two types; the daily digest picks them up when a user chose `digest`. Only loans of pools are alerted, not every overdue check-out: those exist already in tenants, were never promised an alert, and mailing their holders every morning from the day this ships would be a surprise.

**The tenant day** is the UTC date. There is no tenant time zone; the per-user `timezone` is for display. Every "today" in the lists, counts, dashboard and job is the same UTC date, and the job takes it as a parameter so tests advance the clock instead of sleeping.

## 5. Counts and the dashboard are computed, not stored (DECISION)

A pool's `member_count`, `available_count` (live, `deployable`, not out), `checked_out_count`, `overdue_count`, `due_today_count` (and the dashboard's `due_soon_count`) come from one grouped query over members, assets and open assignments per request. Two partial indexes (`assignment_loan_out_idx`, `assignment_loan_in_idx`) keep the loan lists and "recent activity" off a sequential scan. Nothing is cached or stored, so a status change or a manual SQL fix is reflected at once.

## Options considered

| Topic | Chosen | Rejected |
| --- | --- | --- |
| What a loan is | assignment with `loaner_pool_id` | a `loan` table (a second custody system with its own race, history and overdue logic) |
| Pool rules in the database | application checks under a borrower lock | triggers (an edited limit would reject updates of loans already open) |
| Bulk scan result | HTTP 200 with per-item status (platform convention) | 207 Multi-Status; all-or-nothing (one bad scan voids the other nine) |
| Once-per-state alerts | unique-index ledger written before the event | compare "last run" timestamps (a crash between event and timestamp notifies twice); rely on the notification dedupe alone (still creates the outbox events) |
| Extension history | `updated` event with `payload.loan_extended` | new event type `loan_extended` (constraint change, contract enum change, a web case for a one-field edit) |
| Borrower identification | email or `employee_ref` text, or id | a new badge column (no data to fill it, the student number is the badge) |

## Consequences

- Migration 0120 (pools, members, `loan_alert`, the foreign key, two indexes); queue `loan.alerts` and the daily producer; contract tag Loaners grows from five contract-only operations to 18 implemented ones; two new problem codes (`loan-limit-reached`, `loaner-pool-inactive`); the asset list filters `loaner_pool_id` and `in_loaner_pool`; the demo seed adds one pool of ten Chromebooks per tenant with five loans, two overdue (the demo tenants now have 210 assets).
- Not built: a tenant time zone; per-pool reminder lead time; recipients configurable per pool beyond the owner; pool membership events in the asset history; the K-12 vocabulary (homeroom, device number), which the founder has to confirm.
- Open questions for the founder: (1) should the tenant default for the expected return also be the default of a pool that has none of its own? (2) alert only the borrower's login, or also mail an address held by a person without a login? (3) is "lowest asset tag first" the right order for the next device?
