-- 0140_loan_defaults_and_mail [M2-LOAN-01, M2-LOAN-03; ED-24]: founder decisions of 2026-11-24 on loaner pools.
--  1. The loan length of a pool becomes OPTIONAL: a pool without its own `default_loan_days` takes the
--     organisation's `default_expected_return_days` (app.tenant.settings.custody), else 7 days.
--  2. `email_borrowers_without_login`: whether a borrower who has no login account but has an e-mail address
--     gets the due-soon and overdue mails. NULL = automatic (every kind except students), true = every
--     borrower with an address, false = never.
-- Migration range 0140-0149 belongs to this change.

alter table app.loaner_pool alter column default_loan_days drop not null;
alter table app.loaner_pool alter column default_loan_days drop default;

alter table app.loaner_pool add column email_borrowers_without_login boolean;
