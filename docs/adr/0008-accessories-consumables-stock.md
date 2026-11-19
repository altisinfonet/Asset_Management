# ADR 0008: Accessories and consumables: derived availability, the stock ledger and minimum-stock events

Status: PROPOSED (Claude, 2026-11-19); implements M2-ACC-01, M2-ACC-02 and M2-ACC-03 (the delivery half of M2-ACC-03 is the notifications agent's) and needs founder sign-off like every ADR.
Date: 2026-11-19. Stories: M2-ACC-01, M2-ACC-02, M2-ACC-03 (backend); M2-ACC-04 is the web screens.
Inputs: `docs/engineering/data_model.md` 3.6 and 3.7, ED-11 (partial returns), ADR 0004 (outbox, ids-only payloads), ADR 0005 (RLS-safe indexing), ADR 0006 section 7 (scan codes); migration 0041 (`assignment.accessory_id` without foreign key, "the integrator adds the stock trigger").

## Context

Two kinds of stock sit next to the individually tracked assets. **Accessories** (chargers, cables, headsets) are handed out and come back, often in parts. **Consumables** (toner, label rolls, paper) are used up. Both need a quantity that is always right under concurrency (fifty people grabbing the last charger; a toner counted out twice), a trail of who took what, and a warning before the shelf is empty, without building a second custody system.

## 1. Accessory availability is derived, never stored (DECISION)

An accessory has `qty_total`. Units that are out are rows of the existing `app.assignment` table with `accessory_id` set, `quantity` and `quantity_returned` (ED-11): a hand-over is ONE row, a partial return raises `quantity_returned` on the same row, the return that reaches `quantity` also sets `checked_in_at` (one UPDATE, so the existing `assignment_returned_state` CHECK holds). Units out = `sum(quantity - quantity_returned)` over the open rows; available = `qty_total` minus that. The API shows `qty_total`, `qty_checked_out` and `qty_available` (computed per request for a page of ids in one grouped query) and the view `v_accessory_availability` says the same in SQL. Nothing stores "available", so it cannot drift after a crash, a manual fix or a partial return.

**Concurrency** is a row lock: every operation that changes what is out (check-out, check-in, total, archive) starts with `SELECT .. FOR UPDATE` on the accessory, so requests for one accessory run one after the other and the loser sees the winner's committed state. The database repeats the guarantee for anyone who bypasses the service: trigger `assignment_accessory_stock` (before insert; locks the accessory row and refuses `outstanding + quantity > qty_total`) and `accessory_guard_total` (the total cannot go below the units that are out). Test: 40 parallel requests for one unit each on 7 units give exactly 7 `201` and 33 `409 insufficient-stock`.

The accessory row itself is **not** touched by a check-out (its ETag is the ETag of its editable fields, so a clerk editing the name does not get a `412` because somebody took a cable).

Targets are the same as for assets: a person (active), a location, or an asset (`target_asset_id`). Check-out and check-in need an `Idempotency-Key` like every custody action; the 409 for "not enough" is the contract code `insufficient-stock` (also now in the API problem catalogue). The assignment list of an accessory carries `target_name`; the lists of a person include accessory assignments with `accessory_name`, so the offboarding checklist and the deactivation guard (`409 usage.open_assignments`) cover accessories too.

## 2. Consumables: the ledger is the truth, the balance is its running sum (DECISION)

`app.stock_movement` is append-only (SELECT and INSERT for the runtime role, nothing else): `qty_delta <> 0`, `reason` in `receive`, `issue` (consume), `return`, `adjust`, `correction`, an optional `person_id` (who took it), a note, the actor, `balance_after`. The backlog says "receive, consume, adjust"; the data model's five reasons are kept (`issue` is the consume movement; `return` is unused stock coming back; `correction` fixes an earlier mistake, since the ledger cannot be edited).

`consumable.qty_on_hand` is a stored running balance maintained by the BEFORE INSERT trigger of the ledger (row lock, then `qty_on_hand + qty_delta`, `balance_after` stamped). It is stored rather than recomputed because every list and every low-stock check reads it, but it is **not writable by anything except that trigger**: a guard trigger refuses any other change (the movement insert is trigger depth 1, its UPDATE runs the guard at depth 2) and a new consumable must start at 0, so "on-hand derived from the ledger" holds by construction; a test compares the balance with `sum(qty_delta)` after 60 concurrent requests. `CHECK (qty_on_hand >= 0)` is the last line of defence against a negative balance, and the service answers `409 insufficient-stock` (with `on_hand` and `requested`) before it gets there, after taking the row lock.

Rules repeated in the table so the ledger stays sane whoever writes it: the sign follows the reason (`receive` and `return` positive, `issue` negative; `adjust` and `correction` either way) and an adjustment or correction needs a note ("never negative unless adjusted with reason": an adjustment can reduce stock to what a count found, but never below zero, and always says why). The timestamp `at` is taken with `clock_timestamp()` **after** the row lock is won, so the order of `at` is the order in which the balances were computed. An opening quantity on create (`initial_qty`) is the first `receive` movement.

**Per-location stock is not built.** The backlog's wording ("consume log per consumable and per person") and `schema.sql` have one stock per consumable with a home `location_id`; keeping the same consumable in two rooms is two consumables. A per-location split would change the ledger key and every balance rule; it can be added later as `stock_location` without touching the ledger rows written now. The consume log is queryable per consumable (`GET /v1/consumables/{id}/movements`, filter by reason and person) and per person (`GET /v1/people/{id}/stock-movements`).

## 3. Minimum-stock alerts: a latch, once per crossing (DECISION)

An item is **low** while `min_qty > 0` and its quantity (consumable: on hand; accessory: available) is at or below `min_qty`; that is also the rule of the view `v_low_stock`, of the `low_stock` member in the API and of the `low_stock=true|false` list filter. The backlog says "crossing below minimum"; at-or-below is chosen so that a minimum of 4 warns when the fourth-to-last unit is gone, not the fifth.

Each of the two tables has `low_stock_alerted boolean`. After every change that can move the quantity or the minimum (a movement, a check-out or check-in, a new total or minimum, creation) the service runs ONE statement that sets the latch to the current "is low" value **only where it differs**, and publishes the outbox event only when that statement flipped it from false to true. So a crossing emits exactly one event however many movements follow while the item stays low (60 parallel consumes across the minimum raise one), restocking above the minimum clears the latch silently (re-arm), and the next crossing alerts again. The row is locked by the same transaction (ledger trigger, `FOR UPDATE`, or the UPDATE itself), so two concurrent changes cannot both see the crossing. The latch is only ever changed together with the thing that moved it, in the same transaction as the audit row and the movement.

**Events** (outbox, aggregate = the item, ids only): `consumable.low_stock` `{consumableId, movementId?}` and `accessory.low_stock` `{accessoryId, assignmentId?}`. The backlog calls the event `stock.low`; the brief for the wave fixed `consumable.low_stock`, and accessories get the sibling name so a subscriber can bind by type. Both are emitted whenever the latch flips, including creating an item that is already low (a toner created with no stock and a minimum of 4 is low). Other events: `accessory.created|updated|archived|checked_out|checked_in`, `consumable.created|updated|archived|stock_moved`, each with `version` and the ids involved.

**Not built here:** delivery (in-app notification, email, the daily digest, the role subscription). The notifications agent owns the `NOTIFIER` port; the integrator binds a subscriber on `consumable.low_stock` and `accessory.low_stock` that reads the item (name, quantity, minimum, location) and notifies the subscribed roles. The demo seed sets the latch to the current state without events, so seeding never raises alerts.

## 4. Scan codes (DECISION)

Accessories and consumables get the same opaque `label_code` as assets (128-bit-class random hex, unique per tenant). `GET /v1/scan/resolve` tries the asset lookups first (label code, tag, serial, unchanged), then asks the resolvers other modules registered with the registry's `ScanResolverRegistry` (the registry cannot import the stock module: dependencies point downward). The stock resolver answers `entity_type: accessory` with the accessory and `entity_type: consumable` with the consumable, each with its own `allowed_actions` (`checkout`, `checkin`, `update` for accessories; `issue`, `receive`, `adjust`, `update` for consumables), filtered by the caller's permissions; a caller without `accessory:read` / `consumable:read` gets the plain 404. Enumeration resistance is unchanged (misses count, hits do not; the throttle sits in the registry). The 200 body is documented as a `oneOf` of `ScanResolveResult` (asset, unchanged, so existing clients keep working), `ScanResolveAccessoryResult` and `ScanResolveConsumableResult`, told apart by `entity_type`. Label printing for them belongs to the labels agent.

## Options considered

| Topic | Chosen | Rejected |
| --- | --- | --- |
| Accessory availability | derived from open assignments, row-locked | a stored `qty_available` (drifts; needs the same lock anyway) |
| Accessory hand-over | one assignment row with `quantity`, partial returns raise `quantity_returned` | a row per unit (50 chargers = 50 rows, no natural "who has 3") |
| Consumable balance | running balance on the row, maintained only by the ledger trigger | recomputing `sum(qty_delta)` on every read (slow lists); writing the balance from the service (can disagree with the ledger) |
| Overdraw | row lock + exact 409, `CHECK >= 0` as the backstop | relying on the CHECK alone (a 500-looking error and no useful message) |
| Alert | latch flipped in the same statement that detects the crossing | comparing before/after quantities in the application (two concurrent movements can both see the crossing) |
| Alert delivery | outbox event only; subscriber wired by the integrator | building notifications here (belongs to the notifications story) |

## Consequences

- Migration `0080_accessories_consumables.sql` (range 0080-0089): the three tables, the assignment foreign key and triggers, two views, the grants. `data_model.md` 3.6.1 and 3.7 describe the as-built differences from `schema.sql` (label code, latch, search text, ledger CHECKs).
- Archiving a category, manufacturer, vendor or location that live accessories or consumables point at is refused with `409` and `usage.accessories` / `usage.consumables` (the members appear only when not zero, so existing answers keep their shape). Archiving an accessory with units out is refused (`usage.open_assignments`).
- Contract: `Accessory` and `Consumable` gain `label_code` and `low_stock`; `qty_checked_out`, `qty_available` and `qty_on_hand` are always present; `Assignment` gains `accessory_name` and `target_name`; `StockMovement` gains `consumable_name` and `person_name` in lists; new operation `listPersonStockMovements`; `resolveScan` answers a `oneOf`.
- Open for the founder: whether per-location stock is wanted before M3; whether "at or below the minimum" (chosen) or "strictly below" is the wording the school wants. Raising the minimum over a healthy item alerts (the edit is a change like any other); editing the minimum of an item that is already low does not alert again (the latch is set).
