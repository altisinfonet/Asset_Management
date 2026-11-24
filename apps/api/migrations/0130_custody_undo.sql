-- 0130_custody_undo [M2-UX-02, ED-23]: the history of an asset gets one more event type,
-- `custody_undone`, written by `POST /v1/assets/{id}/undo-custody` next to the `checked_out` /
-- `checked_in` / `transferred` event it reverses (the original event is never touched or deleted).
--
-- The CHECK lives on the partitioned parent and is inherited by every partition (and by partitions
-- created later); dropping and re-adding it on the parent does both in one statement each. No data
-- change, no new table, no new grant.

alter table app.asset_history drop constraint asset_history_event_type_check;
alter table app.asset_history add constraint asset_history_event_type_check check (event_type in (
  'created','updated','status_changed','location_changed','checked_out','checked_in',
  'transferred','repair_opened','repair_completed','archived','restored','label_printed','imported',
  'custody_undone'));
