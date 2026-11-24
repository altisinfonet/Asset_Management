import type { UiError } from '@/lib/api';
import { dateAfter } from '@/lib/custody/helpers';
import type { Asset } from '@/lib/registry/types';
import type { LoanerPool, LoanerPoolMember, LoanSettings } from './api';

/**
 * Pure helpers of the loaner screens: the due date a loan gets, the counts of a pool card, what a
 * scanned device allows at the desk and what state a pool member is in.
 */

/** Used until the organisation's defaults have loaded (the contract's default of `default_loan_days`). */
export const FALLBACK_LOAN_DAYS = 7;

/**
 * The due date the desk offers: today + the pool's default period, else the organisation's, else a
 * week. Never beyond the longest loan the pool (or the organisation) allows.
 */
export function defaultDueDate(
  pool: Pick<LoanerPool, 'default_loan_days' | 'max_loan_days'> | null | undefined,
  settings: Pick<LoanSettings, 'default_loan_days' | 'max_loan_days'> | null | undefined,
  now: Date = new Date(),
): string {
  const days = pool?.default_loan_days ?? settings?.default_loan_days ?? FALLBACK_LOAN_DAYS;
  const max = pool?.max_loan_days ?? settings?.max_loan_days ?? null;
  return dateAfter({ days: max ? Math.min(days, max) : days }, now);
}

/** The latest due date a pool allows for a loan made `now`, or null when it has no limit. */
export function latestDueDate(
  pool: Pick<LoanerPool, 'max_loan_days'> | null | undefined,
  settings: Pick<LoanSettings, 'max_loan_days'> | null | undefined,
  now: Date = new Date(),
): string | null {
  const max = pool?.max_loan_days ?? settings?.max_loan_days ?? null;
  return max ? dateAfter({ days: max }, now) : null;
}

export interface PoolCounts {
  total: number;
  available: number;
  onLoan: number;
  overdue: number;
  dueToday: number;
}

/** The four numbers of a pool card, from the pool's own counters. */
export function poolCounts(pool: LoanerPool): PoolCounts {
  const total = pool.member_count ?? 0;
  const onLoan = Math.min(pool.checked_out_count ?? 0, total);
  return {
    total,
    onLoan,
    available: Math.max(0, total - onLoan),
    overdue: pool.overdue_count ?? 0,
    dueToday: pool.due_today_count ?? 0,
  };
}

/** The sum over several pools (the tiles above the cards). */
export function sumCounts(pools: readonly LoanerPool[]): PoolCounts {
  return pools.reduce<PoolCounts>(
    (sum, pool) => {
      const counts = poolCounts(pool);
      return {
        total: sum.total + counts.total,
        available: sum.available + counts.available,
        onLoan: sum.onLoan + counts.onLoan,
        overdue: sum.overdue + counts.overdue,
        dueToday: sum.dueToday + counts.dueToday,
      };
    },
    { total: 0, available: 0, onLoan: 0, overdue: 0, dueToday: 0 },
  );
}

/** Today's date in UTC, the day the server compares due dates with. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export type MemberState = 'available' | 'on_loan' | 'overdue' | 'due_today';

/** Where a pool member stands: free, out, out and late, or out and due today. */
export function memberState(
  member: Pick<LoanerPoolMember, 'available' | 'asset'>,
  now: Date = new Date(),
): MemberState {
  const assignment = member.asset?.current_assignment;
  if (member.available && !assignment) return 'available';
  if (assignment?.overdue) return 'overdue';
  if (assignment?.expected_return && assignment.expected_return === todayUtc(now)) {
    return 'due_today';
  }
  return 'on_loan';
}

/** The pool page's filter (`?show=`). */
export type PoolShow = 'all' | MemberState;
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
  if (show === 'on_loan') return state !== 'available';
  return state === show;
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`), negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

// ---- the desk ------------------------------------------------------------------------------------

/** What a scanned device allows at the desk. */
export type LendVerdict =
  | { kind: 'ok'; poolId: string }
  | { kind: 'not_in_pool' }
  | { kind: 'on_loan'; holder: string | null; due: string | null }
  | { kind: 'unavailable'; status: string | null };

/**
 * Can this device be lent now? It needs a pool, no open check-out and the check-out action the
 * server offers (a device in repair or lost does not). The server decides in the end; this keeps
 * the desk from sending what is certain to fail and words the reason.
 */
export function lendVerdict(
  asset: Pick<Asset, 'loaner_pool_id' | 'current_assignment' | 'status'>,
  allowedCheckout: boolean,
): LendVerdict {
  if (!asset.loaner_pool_id) return { kind: 'not_in_pool' };
  if (asset.current_assignment) {
    return {
      kind: 'on_loan',
      holder: asset.current_assignment.target_name ?? null,
      due: asset.current_assignment.expected_return ?? null,
    };
  }
  if (!allowedCheckout) return { kind: 'unavailable', status: asset.status?.name ?? null };
  return { kind: 'ok', poolId: asset.loaner_pool_id };
}

export type ReturnVerdict =
  | { kind: 'ok'; holder: string | null; overdueDays: number }
  | { kind: 'not_in_pool' }
  | { kind: 'not_on_loan' };

/** Can this device be taken back at the desk? It has to be in a pool and out. */
export function returnVerdict(
  asset: Pick<Asset, 'loaner_pool_id' | 'current_assignment'>,
  now: Date = new Date(),
): ReturnVerdict {
  if (!asset.loaner_pool_id) return { kind: 'not_in_pool' };
  const assignment = asset.current_assignment;
  if (!assignment) return { kind: 'not_on_loan' };
  const due = assignment.expected_return;
  return {
    kind: 'ok',
    holder: assignment.target_name ?? null,
    overdueDays: due ? Math.max(0, daysBetween(due, todayUtc(now))) : 0,
  };
}

export type LoanFailure =
  'no_device' | 'limit' | 'already_out' | 'not_deployable' | 'inactive_person' | 'other';

/** Which of the desk's named failures a problem is (by its machine `code`). */
export function loanFailure(error: UiError): LoanFailure {
  switch (error.code) {
    case 'no-loaner-available':
      return 'no_device';
    case 'loan-limit-reached':
      return 'limit';
    case 'asset-already-checked-out':
      return 'already_out';
    case 'asset-not-deployable':
      return 'not_deployable';
    default:
      return error.fieldErrors.some((field) => field.code === 'inactive')
        ? 'inactive_person'
        : 'other';
  }
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
