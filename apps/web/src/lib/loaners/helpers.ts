import type { UiError } from '@/lib/api';
import { dateAfter } from '@/lib/custody/helpers';
import type { LoanerPool, LoanerPoolMember, ProblemBody } from './api';

/**
 * Pure helpers of the loaner screens: the due date a loan gets, the numbers of a pool, the state of a
 * pool member, the words for what a scan did (per device) and for what stopped a whole request.
 */

/** Used until the pool has loaded (the contract's default of `default_loan_days`). */
export const FALLBACK_LOAN_DAYS = 7;

/**
 * The due date the desk offers: today plus the pool's default period, never beyond the longest loan
 * the pool allows (the API computes the same when no date is sent).
 */
export function defaultDueDate(
  pool: Pick<LoanerPool, 'default_loan_days' | 'max_loan_days'> | null | undefined,
  now: Date = new Date(),
): string {
  const days = pool?.default_loan_days ?? FALLBACK_LOAN_DAYS;
  const max = pool?.max_loan_days ?? null;
  return dateAfter({ days: max ? Math.min(days, max) : days }, now);
}

/** The latest due date a pool allows for a loan made `now`, or null when it has no limit. */
export function latestDueDate(
  pool: Pick<LoanerPool, 'max_loan_days'> | null | undefined,
  now: Date = new Date(),
): string | null {
  const max = pool?.max_loan_days ?? null;
  return max ? dateAfter({ days: max }, now) : null;
}

/** Today's date in UTC, the day the server compares due dates with. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`), negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** How many days a device came back after its due date (0 when on time or without a date). */
export function lateDays(
  expectedReturn: string | null | undefined,
  now: Date = new Date(),
): number {
  return expectedReturn ? Math.max(0, daysBetween(expectedReturn, todayUtc(now))) : 0;
}

export type MemberState = 'available' | 'on_loan' | 'overdue' | 'due_today' | 'unavailable';

/**
 * Where a pool member stands: free, out, out and late, out and due today, or neither free nor out
 * (in repair, lost: it cannot be lent but nobody has it).
 */
export function memberState(
  member: Pick<LoanerPoolMember, 'available' | 'asset'>,
  now: Date = new Date(),
): MemberState {
  const assignment = member.asset?.current_assignment;
  if (!assignment) return member.available ? 'available' : 'unavailable';
  if (assignment.overdue) return 'overdue';
  if (assignment.expected_return && assignment.expected_return === todayUtc(now))
    return 'due_today';
  return 'on_loan';
}

/** The pool page's filter (`?show=`). */
export type PoolShow = 'all' | 'available' | 'on_loan' | 'overdue' | 'due_today';
export const POOL_SHOW: readonly PoolShow[] = [
  'all',
  'available',
  'on_loan',
  'overdue',
  'due_today',
];

export function isPoolShow(value: string | null | undefined): value is PoolShow {
  return !!value && (POOL_SHOW as readonly string[]).includes(value);
}

/** Does a member belong to a filter? "On loan" counts every device that is out, late or not. */
export function matchesShow(state: MemberState, show: PoolShow): boolean {
  if (show === 'all') return true;
  if (show === 'on_loan') return state !== 'available' && state !== 'unavailable';
  return state === show;
}

// ---- what a scan did ------------------------------------------------------------------------------

export type ItemFailure =
  | 'not_found'
  | 'ambiguous'
  | 'not_in_pool'
  | 'already_out'
  | 'not_deployable'
  | 'limit'
  | 'not_checked_out'
  | 'other';

/**
 * Which named failure a device's own problem is (an item of `quick-checkout` or `loans/return`):
 * unknown code `404`, ambiguous serial `409 conflict`, not in the pool `422` with the field code
 * `not-in-pool`, and the machine codes of a refused check-out or return.
 */
export function itemFailure(error: ProblemBody | undefined, status: number): ItemFailure {
  if (status === 404) return 'not_found';
  if (error?.errors?.some((e) => e.code === 'not-in-pool')) return 'not_in_pool';
  switch (error?.code) {
    case 'asset-already-checked-out':
      return 'already_out';
    case 'asset-not-deployable':
      return 'not_deployable';
    case 'loan-limit-reached':
      return 'limit';
    case 'asset-not-checked-out':
      return 'not_checked_out';
    case 'conflict':
      return 'ambiguous';
    default:
      return 'other';
  }
}

export type RequestFailure =
  | 'pool_inactive'
  | 'not_eligible'
  | 'borrower_not_found'
  | 'borrower_inactive'
  | 'borrower_ambiguous'
  | 'no_device'
  | 'other';

/** Which named failure stopped a whole request (the borrower or the pool, before any device was tried). */
export function requestFailure(error: UiError): RequestFailure {
  if (error.code === 'loaner-pool-inactive') return 'pool_inactive';
  if (error.code === 'no-loaner-available') return 'no_device';
  const field = error.fieldErrors.find(
    (f) => f.pointer === '/borrower' || f.pointer === '/person_id',
  );
  if (field?.code === 'not-eligible') return 'not_eligible';
  if (field?.code === 'inactive') return 'borrower_inactive';
  if (field) return 'borrower_not_found';
  if (error.code === 'conflict' && error.status === 409) return 'borrower_ambiguous';
  return 'other';
}

/** A person's search result narrowed to an exact match of a scanned or typed code, if there is exactly one. */
export function pickBorrower<
  T extends { display_name: string; email?: string | null; employee_ref?: string | null },
>(candidates: readonly T[], code: string): T | null {
  const wanted = code.trim().toLowerCase();
  if (!wanted) return null;
  if (candidates.length === 1) return candidates[0]!;
  const exact = candidates.filter(
    (person) =>
      person.employee_ref?.toLowerCase() === wanted ||
      person.email?.toLowerCase() === wanted ||
      person.display_name.toLowerCase() === wanted,
  );
  return exact.length === 1 ? exact[0]! : null;
}

/** The kinds of people a pool lends to, as words ("everyone" when it has no restriction). */
export const PERSON_KINDS = ['employee', 'student', 'contractor', 'external'] as const;
