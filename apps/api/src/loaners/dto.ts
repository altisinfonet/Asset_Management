import type { Tx } from '../tenancy/index.js';

/** Row -> API object mappers of the loaner module (openapi `LoanerPool`, `LoanerPoolMember`, `Loan`, ...). */

export type PoolRow = NonNullable<Awaited<ReturnType<Tx['loaner_pool']['findUnique']>>>;

/** The live counts of one pool (all from the same grouped query, see `PoolsService.counts`). */
export interface PoolCounts {
  member_count: number;
  available_count: number;
  checked_out_count: number;
  overdue_count: number;
  due_today_count: number;
  due_soon_count: number;
}

export const EMPTY_COUNTS: PoolCounts = {
  member_count: 0,
  available_count: 0,
  checked_out_count: 0,
  overdue_count: 0,
  due_today_count: 0,
  due_soon_count: 0,
};

/** The loan length when neither the pool nor the organisation says (ED-24). */
export const FALLBACK_LOAN_DAYS = 7;

/**
 * The default length of a loan of `pool` in days (ED-24): the pool's own `default_loan_days`, else the
 * organisation's `default_expected_return_days`, else 7; never beyond the pool's `max_loan_days`.
 */
export function effectiveLoanDays(
  pool: { default_loan_days: number | null; max_loan_days: number | null },
  tenantDays: number | null,
): number {
  const days = pool.default_loan_days ?? tenantDays ?? FALLBACK_LOAN_DAYS;
  return pool.max_loan_days !== null ? Math.min(days, pool.max_loan_days) : days;
}

/** Schema `LoanerPool`. An empty `eligible_person_kinds` column (= every kind) is shown as null. */
export const poolDto = (
  r: PoolRow,
  counts: PoolCounts = EMPTY_COUNTS,
  tenantDays: number | null = null,
) => ({
  id: r.id,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
  archived_at: r.archived_at ? r.archived_at.toISOString() : null,
  name: r.name,
  description: r.description,
  home_location_id: r.home_location_id,
  default_loan_days: r.default_loan_days,
  effective_default_loan_days: effectiveLoanDays(r, tenantDays),
  max_loan_days: r.max_loan_days,
  max_loans_per_person: r.max_loans_per_person,
  eligible_person_kinds: r.eligible_person_kinds.length > 0 ? r.eligible_person_kinds : null,
  owner_user_id: r.owner_user_id,
  is_active: r.is_active,
  email_borrowers_without_login: r.email_borrowers_without_login,
  member_count: counts.member_count,
  available_count: counts.available_count,
  checked_out_count: counts.checked_out_count,
  overdue_count: counts.overdue_count,
  due_today_count: counts.due_today_count,
});

/** The fields of a pool the audit trail records (no counts, no timestamps). */
export const poolAuditView = (r: PoolRow) => {
  const {
    member_count: _m,
    available_count: _a,
    checked_out_count: _c,
    overdue_count: _o,
    due_today_count: _d,
    effective_default_loan_days: _e,
    created_at: _ca,
    updated_at: _ua,
    ...rest
  } = poolDto(r);
  return rest;
};

/** `YYYY-MM-DD` of a date column. */
export const isoDay = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/** A date `days` after `day` (both `YYYY-MM-DD`, UTC). */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Row of the loan queries (see `LOAN_SELECT` in loans.service.ts). */
export interface LoanRow {
  id: string;
  asset_id: string;
  asset_tag: string;
  asset_name: string | null;
  loaner_pool_id: string;
  pool_name: string;
  person_id: string | null;
  person_name: string | null;
  person_email: string | null;
  person_ref: string | null;
  checked_out_at: Date;
  expected_return: Date;
  checked_in_at: Date | null;
  note: string | null;
  state: 'on_loan' | 'due_today' | 'overdue' | 'returned';
  days_overdue: number;
}

/** Schema `Loan`. */
export const loanDto = (r: LoanRow) => ({
  id: r.id,
  asset_id: r.asset_id,
  asset_tag: r.asset_tag,
  asset_name: r.asset_name,
  loaner_pool_id: r.loaner_pool_id,
  pool_name: r.pool_name,
  person_id: r.person_id,
  person_name: r.person_name,
  person_email: r.person_email,
  person_ref: r.person_ref,
  checked_out_at: r.checked_out_at.toISOString(),
  expected_return: isoDay(r.expected_return)!,
  returned_at: r.checked_in_at ? r.checked_in_at.toISOString() : null,
  state: r.state,
  days_overdue: Number(r.days_overdue),
  note: r.note,
});
