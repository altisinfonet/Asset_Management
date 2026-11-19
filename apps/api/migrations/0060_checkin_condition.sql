-- 0060_checkin_condition [M2 wave 1 integration]: the condition of an asset when it comes back.
-- One nullable column on app.assignment (a check-in states it; a check-out and an open period have
-- none). No new table, no policy change: the table keeps its tenant conventions from 0041.
alter table app.assignment
  add column checkin_condition text
    constraint assignment_checkin_condition_check
    check (checkin_condition is null or checkin_condition in ('good', 'fair', 'poor', 'damaged'));
