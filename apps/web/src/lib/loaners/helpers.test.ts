import { describe, expect, it } from 'vitest';
import type { UiError } from '@/lib/api';
import type { LoanerPool, LoanerPoolMember } from './api';
import {
  daysBetween,
  defaultDueDate,
  isPoolShow,
  latestDueDate,
  lendVerdict,
  loanFailure,
  matchesShow,
  memberState,
  pickBorrower,
  poolCounts,
  returnVerdict,
  sumCounts,
  todayUtc,
} from './helpers';

const NOW = new Date(2026, 10, 24, 10, 0, 0);

const pool = (fields: Partial<LoanerPool> = {}): LoanerPool => ({
  id: 'p1',
  name: 'Student Chromebooks',
  member_count: 8,
  checked_out_count: 3,
  overdue_count: 1,
  due_today_count: 1,
  ...fields,
});

const error = (fields: Partial<UiError>): UiError => ({
  kind: 'conflict',
  messageKey: 'error.conflict',
  fieldErrors: [],
  ...fields,
});

describe('due dates', () => {
  it('offers today plus the pool default, else the organisation default, else a week', () => {
    expect(defaultDueDate({ default_loan_days: 3, max_loan_days: null }, null, NOW)).toBe(
      '2026-11-27',
    );
    expect(defaultDueDate(null, { default_loan_days: 14, max_loan_days: null }, NOW)).toBe(
      '2026-12-08',
    );
    expect(defaultDueDate(null, null, NOW)).toBe('2026-12-01');
  });

  it('never goes beyond the longest loan allowed', () => {
    expect(defaultDueDate({ default_loan_days: 14, max_loan_days: 7 }, null, NOW)).toBe(
      '2026-12-01',
    );
    expect(latestDueDate({ max_loan_days: 28 }, null, NOW)).toBe('2026-12-22');
    expect(latestDueDate({ max_loan_days: null }, { max_loan_days: 60 }, NOW)).toBe('2027-01-23');
    expect(latestDueDate(null, null, NOW)).toBeNull();
  });

  it('counts whole days between two dates', () => {
    expect(daysBetween('2026-11-20', '2026-11-24')).toBe(4);
    expect(daysBetween('2026-11-24', '2026-11-20')).toBe(-4);
    expect(todayUtc(new Date(Date.UTC(2026, 10, 24, 23, 59)))).toBe('2026-11-24');
  });
});

describe('pool numbers', () => {
  it('derives available from the size and what is out', () => {
    expect(poolCounts(pool())).toEqual({
      total: 8,
      onLoan: 3,
      available: 5,
      overdue: 1,
      dueToday: 1,
    });
  });

  it('is safe with missing counters and adds pools up', () => {
    expect(poolCounts({ id: 'p', name: 'x' })).toEqual({
      total: 0,
      onLoan: 0,
      available: 0,
      overdue: 0,
      dueToday: 0,
    });
    expect(
      sumCounts([pool(), pool({ member_count: 2, checked_out_count: 2, overdue_count: 2 })]),
    ).toEqual({
      total: 10,
      onLoan: 5,
      available: 5,
      overdue: 3,
      dueToday: 2,
    });
  });
});

describe('pool members', () => {
  const member = (
    assignment?: Partial<NonNullable<LoanerPoolMember['asset']>['current_assignment']>,
  ) =>
    ({
      asset_id: 'a1',
      loaner_pool_id: 'p1',
      added_at: '2026-01-01T00:00:00Z',
      available: !assignment,
      asset: {
        id: 'a1',
        asset_tag: 'AT-1',
        category_id: 'c',
        status_id: 's',
        custom_data: {},
        current_assignment: assignment
          ? {
              assignment_id: 'x',
              target_type: 'person',
              target_id: 'u',
              checked_out_at: '2026-11-20T00:00:00Z',
              ...assignment,
            }
          : null,
      },
    }) as LoanerPoolMember;

  it('tells available, on loan, overdue and due today apart', () => {
    expect(memberState(member(), NOW)).toBe('available');
    expect(memberState(member({ expected_return: '2026-12-01' }), NOW)).toBe('on_loan');
    expect(memberState(member({ expected_return: '2026-11-24' }), NOW)).toBe('due_today');
    expect(memberState(member({ expected_return: '2026-11-20', overdue: true }), NOW)).toBe(
      'overdue',
    );
  });

  it('filters: "on loan" includes the late ones', () => {
    expect(matchesShow('overdue', 'on_loan')).toBe(true);
    expect(matchesShow('due_today', 'on_loan')).toBe(true);
    expect(matchesShow('available', 'on_loan')).toBe(false);
    expect(matchesShow('available', 'all')).toBe(true);
    expect(matchesShow('on_loan', 'overdue')).toBe(false);
    expect(isPoolShow('overdue')).toBe(true);
    expect(isPoolShow('nope')).toBe(false);
    expect(isPoolShow(null)).toBe(false);
  });
});

describe('the desk', () => {
  const free = {
    loaner_pool_id: 'p1',
    current_assignment: null,
    status: { id: 's', name: 'Ready', state_type: 'deployable' },
  };

  it('lends a free pool device', () => {
    expect(lendVerdict(free, true)).toEqual({ kind: 'ok', poolId: 'p1' });
  });

  it('refuses a device outside a pool, one on loan and one that cannot be lent', () => {
    expect(lendVerdict({ ...free, loaner_pool_id: null }, true)).toEqual({ kind: 'not_in_pool' });
    expect(
      lendVerdict(
        {
          ...free,
          current_assignment: {
            assignment_id: 'a',
            target_type: 'person',
            target_id: 'u',
            target_name: 'A. Chen',
            checked_out_at: '2026-11-20T00:00:00Z',
            expected_return: '2026-12-01',
          },
        },
        false,
      ),
    ).toEqual({ kind: 'on_loan', holder: 'A. Chen', due: '2026-12-01' });
    expect(
      lendVerdict(
        { ...free, status: { id: 's', name: 'In repair', state_type: 'undeployable' } },
        false,
      ),
    ).toEqual({
      kind: 'unavailable',
      status: 'In repair',
    });
  });

  it('takes back a device that is out, and says how late it is', () => {
    const out = {
      loaner_pool_id: 'p1',
      current_assignment: {
        assignment_id: 'a',
        target_type: 'person' as const,
        target_id: 'u',
        target_name: 'D. Park',
        checked_out_at: '2026-11-10T00:00:00Z',
        expected_return: '2026-11-20',
      },
    };
    expect(returnVerdict(out, NOW)).toEqual({ kind: 'ok', holder: 'D. Park', overdueDays: 4 });
    expect(
      returnVerdict(
        {
          ...out,
          current_assignment: { ...out.current_assignment, expected_return: '2026-12-01' },
        },
        NOW,
      ),
    ).toMatchObject({ overdueDays: 0 });
    expect(returnVerdict({ loaner_pool_id: 'p1', current_assignment: null }, NOW)).toEqual({
      kind: 'not_on_loan',
    });
    expect(returnVerdict({ loaner_pool_id: null, current_assignment: null }, NOW)).toEqual({
      kind: 'not_in_pool',
    });
  });

  it('names the problems of a refused loan by their code', () => {
    expect(loanFailure(error({ code: 'no-loaner-available' }))).toBe('no_device');
    expect(loanFailure(error({ code: 'loan-limit-reached' }))).toBe('limit');
    expect(loanFailure(error({ code: 'asset-already-checked-out' }))).toBe('already_out');
    expect(loanFailure(error({ code: 'asset-not-deployable' }))).toBe('not_deployable');
    expect(
      loanFailure(
        error({
          kind: 'validation',
          fieldErrors: [{ pointer: '/person_id', message: 'x', code: 'inactive' }],
        }),
      ),
    ).toBe('inactive_person');
    expect(loanFailure(error({ code: 'something-else' }))).toBe('other');
  });

  it('picks a borrower only when the match is certain', () => {
    const people = [
      { display_name: 'Alice Owner', email: 'alice@example.org', employee_ref: 'S-1' },
      { display_name: 'Alicia Stone', email: 'alicia@example.org', employee_ref: 'S-2' },
    ];
    expect(pickBorrower([people[0]!], 'ali')).toBe(people[0]);
    expect(pickBorrower(people, 'ali')).toBeNull();
    expect(pickBorrower(people, 's-2')).toBe(people[1]);
    expect(pickBorrower(people, 'Alice@example.org')).toBe(people[0]);
    expect(pickBorrower(people, '  ')).toBeNull();
    expect(pickBorrower([], 'x')).toBeNull();
  });
});
