import { describe, expect, it } from 'vitest';
import type { UiError } from '@/lib/api';
import type { LoanerPoolMember, ProblemBody } from './api';
import {
  daysBetween,
  defaultDueDate,
  isPoolShow,
  itemFailure,
  lateDays,
  latestDueDate,
  matchesShow,
  memberState,
  notLendableStatus,
  pickBorrower,
  requestFailure,
  todayUtc,
} from './helpers';

const NOW = new Date(2026, 10, 24, 10, 0, 0);

const error = (fields: Partial<UiError>): UiError => ({
  kind: 'conflict',
  messageKey: 'error.conflict',
  fieldErrors: [],
  ...fields,
});

const problem = (fields: Partial<ProblemBody>): ProblemBody => ({
  type: 'x',
  title: 'x',
  status: 409,
  ...fields,
});

describe('due dates', () => {
  it('offers today plus the effective pool default (pool, organisation, else a week)', () => {
    expect(
      defaultDueDate(
        { default_loan_days: 3, effective_default_loan_days: 3, max_loan_days: null },
        NOW,
      ),
    ).toBe('2026-11-27');
    expect(defaultDueDate(null, NOW)).toBe('2026-12-01');
  });

  it('never goes beyond the longest loan the pool allows', () => {
    expect(
      defaultDueDate(
        { default_loan_days: 14, effective_default_loan_days: 14, max_loan_days: 7 },
        NOW,
      ),
    ).toBe('2026-12-01');
    expect(latestDueDate({ max_loan_days: 28 }, NOW)).toBe('2026-12-22');
    expect(latestDueDate({ max_loan_days: null }, NOW)).toBeNull();
    expect(latestDueDate(null, NOW)).toBeNull();
  });

  it('counts whole days and says how late a return was', () => {
    expect(daysBetween('2026-11-20', '2026-11-24')).toBe(4);
    expect(daysBetween('2026-11-24', '2026-11-20')).toBe(-4);
    expect(todayUtc(new Date(Date.UTC(2026, 10, 24, 23, 59)))).toBe('2026-11-24');
    expect(lateDays('2026-11-20', new Date(Date.UTC(2026, 10, 24, 12)))).toBe(4);
    expect(lateDays('2026-12-01', NOW)).toBe(0);
    expect(lateDays(null, NOW)).toBe(0);
  });
});

describe('pool members', () => {
  const member = (
    assignment?: Partial<NonNullable<NonNullable<LoanerPoolMember['asset']>['current_assignment']>>,
    available = !assignment,
  ) =>
    ({
      asset_id: 'a1',
      loaner_pool_id: 'p1',
      added_at: '2026-01-01T00:00:00Z',
      available,
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

  it('tells available, on loan, overdue, due today and not available apart', () => {
    expect(memberState(member(), NOW)).toBe('available');
    expect(memberState(member(undefined, false), NOW)).toBe('unavailable');
    expect(memberState(member({ expected_return: '2026-12-01' }), NOW)).toBe('on_loan');
    expect(memberState(member({ expected_return: '2026-11-24' }), NOW)).toBe('due_today');
    expect(memberState(member({ expected_return: '2026-11-20', overdue: true }), NOW)).toBe(
      'overdue',
    );
  });

  it('filters: "on loan" includes the late ones but not what is merely unavailable', () => {
    expect(matchesShow('overdue', 'on_loan')).toBe(true);
    expect(matchesShow('due_today', 'on_loan')).toBe(true);
    expect(matchesShow('available', 'on_loan')).toBe(false);
    expect(matchesShow('unavailable', 'on_loan')).toBe(false);
    expect(matchesShow('unavailable', 'all')).toBe(true);
    expect(matchesShow('on_loan', 'overdue')).toBe(false);
    expect(isPoolShow('overdue')).toBe(true);
    expect(isPoolShow('nope')).toBe(false);
    expect(isPoolShow(null)).toBe(false);
  });
});

describe('what a scan did', () => {
  it('names the failure of one device by its status and code', () => {
    expect(itemFailure(undefined, 404)).toBe('not_found');
    expect(
      itemFailure(
        problem({
          status: 422,
          code: 'validation',
          errors: [{ pointer: '/codes/1', message: 'x', code: 'not-in-pool' }],
        }),
        422,
      ),
    ).toBe('not_in_pool');
    expect(itemFailure(problem({ code: 'asset-already-checked-out' }), 409)).toBe('already_out');
    expect(itemFailure(problem({ code: 'asset-not-deployable' }), 409)).toBe('not_deployable');
    expect(itemFailure(problem({ code: 'loan-limit-reached' }), 409)).toBe('limit');
    expect(itemFailure(problem({ code: 'asset-not-checked-out' }), 409)).toBe('not_checked_out');
    expect(itemFailure(problem({ code: 'conflict' }), 409)).toBe('ambiguous');
    expect(itemFailure(problem({ code: 'internal', status: 500 }), 500)).toBe('other');
  });

  it('names what stopped a whole request', () => {
    expect(requestFailure(error({ code: 'loaner-pool-inactive' }))).toBe('pool_inactive');
    expect(requestFailure(error({ code: 'no-loaner-available' }))).toBe('no_device');
    expect(
      requestFailure(
        error({
          status: 422,
          kind: 'validation',
          fieldErrors: [{ pointer: '/person_id', message: 'x', code: 'not-eligible' }],
        }),
      ),
    ).toBe('not_eligible');
    expect(
      requestFailure(
        error({
          status: 422,
          kind: 'validation',
          fieldErrors: [{ pointer: '/borrower', message: 'x', code: 'inactive' }],
        }),
      ),
    ).toBe('borrower_inactive');
    expect(
      requestFailure(
        error({
          status: 422,
          kind: 'validation',
          fieldErrors: [{ pointer: '/borrower', message: 'x', code: 'not-found' }],
        }),
      ),
    ).toBe('borrower_not_found');
    expect(requestFailure(error({ code: 'conflict', status: 409 }))).toBe('borrower_ambiguous');
    expect(requestFailure(error({ code: 'something-else', status: 500 }))).toBe('other');
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

describe('lendable at the desk', () => {
  it('lets a deployable device through and names the status that stops the others', () => {
    expect(notLendableStatus({ status: { name: 'Ready', state_type: 'deployable' } })).toBeNull();
    expect(notLendableStatus({ status: { name: 'In repair', state_type: 'undeployable' } })).toBe(
      'In repair',
    );
    expect(notLendableStatus({ status: { name: 'Retired', state_type: 'archived' } })).toBe(
      'Retired',
    );
    expect(notLendableStatus({ status: { name: ' ', state_type: 'pending' } })).toBe('pending');
    // a device that is out is answered at Lend ("already out", with the return offered)
    expect(notLendableStatus({ status: { name: 'Deployed', state_type: 'deployed' } })).toBeNull();
    // an asset without a loaded status is left to the server
    expect(notLendableStatus({ status: null })).toBeNull();
  });

  it('names the failures a single next-available loan answers for the whole request', () => {
    expect(requestFailure(error({ code: 'loan-limit-reached', status: 409 }))).toBe('limit');
    expect(requestFailure(error({ code: 'asset-not-deployable', status: 409 }))).toBe(
      'not_deployable',
    );
    expect(requestFailure(error({ code: 'no-loaner-available', status: 409 }))).toBe('no_device');
  });
});
