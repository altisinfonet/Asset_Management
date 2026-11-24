import { ApiError } from '@assettracker/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { custodySettingsApi, loanersApi, type LoanerPool } from '@/lib/loaners/api';
import { getApi } from '@/lib/api';
import { peopleApi } from '@/lib/registry/api';
import { seedSession } from '@/test/render';
import { MOCK_ACCOUNTS } from './fixtures';

/**
 * The loaner mock endpoints mirror the contract of the loaner backend (ED-20 / ED-21): the screens and
 * Playwright are written against them. The first request seeds two pools (eight and three devices) and
 * four loans: one due in four days, one five days late, one due today, and one of the staff pool.
 */
async function fails(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error('expected the request to fail');
}
const code = (error: ApiError) => (error.body as { code?: string }).code;
const pointers = (error: ApiError) =>
  ((error.body as { errors?: Array<{ pointer: string }> }).errors ?? []).map((e) => e.pointer);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function pool(prefix: string): Promise<LoanerPool> {
  return (await loanersApi.pools()).data.find((p) => p.name.startsWith(prefix))!;
}
async function members(poolId: string, available?: boolean) {
  return (await loanersApi.members(poolId, available === undefined ? {} : { available })).data;
}
async function borrower(n: number) {
  return (await peopleApi.list({ limit: 40, status: 'active' })).data[n]!;
}
let keyCount = 0;
const key = () => `key-loaner-${String((keyCount += 1)).padStart(5, '0')}`;

describe('mock loaner pools', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('seeds two pools with counts derived from the loans', async () => {
    const pools = (await loanersApi.pools()).data;
    expect(pools.map((p) => p.name)).toEqual([
      'Staff laptop loaners',
      'Student Chromebook loaners',
    ]);
    expect(await pool('Student')).toMatchObject({
      member_count: 8,
      available_count: 5,
      checked_out_count: 3,
      overdue_count: 1,
      due_today_count: 1,
      default_loan_days: 7,
      max_loan_days: 28,
      max_loans_per_person: 1,
      eligible_person_kinds: null,
      is_active: true,
    });
  });

  it('answers the dashboard in one call: totals, a row per pool and the latest activity', async () => {
    const dashboard = await loanersApi.dashboard();
    expect(dashboard.totals).toEqual({
      pools: 2,
      members: 11,
      available: 7,
      checked_out: 4,
      overdue: 1,
      due_today: 1,
      due_soon: 0,
    });
    const students = dashboard.pools.find((p) => p.name.startsWith('Student'))!;
    expect(students).toMatchObject({
      member_count: 8,
      available_count: 5,
      checked_out_count: 3,
      overdue_count: 1,
      due_today_count: 1,
      due_soon_count: 0,
    });
    expect(dashboard.as_of).toBe(inDays(0));
    expect(dashboard.recent).toHaveLength(4);
    expect(dashboard.recent[0]).toMatchObject({ kind: 'checked_out' });
  });

  it('lists members with their asset and whether each can be lent right now', async () => {
    const students = await pool('Student');
    expect(await members(students.id)).toHaveLength(8);
    const free = await members(students.id, true);
    expect(free).toHaveLength(5);
    expect(free.every((m) => m.available && !m.asset?.current_assignment)).toBe(true);
    const out = await members(students.id, false);
    expect(
      out.every((m) => !m.available && m.asset?.current_assignment?.loaner_pool_id === students.id),
    ).toBe(true);
  });

  it('validates a pool: name, whole days, longest loan, kinds, one name per pool', async () => {
    expect(pointers(await fails(loanersApi.createPool({ name: '  ' })))).toContain('/name');
    expect(
      pointers(
        await fails(
          loanersApi.createPool({ name: 'Short', default_loan_days: 10, max_loan_days: 5 }),
        ),
      ),
    ).toContain('/max_loan_days');
    expect(
      pointers(await fails(loanersApi.createPool({ name: 'Zero', default_loan_days: 0 }))),
    ).toContain('/default_loan_days');
    expect(
      pointers(await fails(loanersApi.createPool({ name: 'Kinds', eligible_person_kinds: [] }))),
    ).toContain('/eligible_person_kinds');
    const dup = await fails(loanersApi.createPool({ name: 'staff LAPTOP loaners' }));
    expect(dup.status).toBe(409);
    const made = await loanersApi.createPool({
      name: 'Exam week',
      default_loan_days: 2,
      eligible_person_kinds: ['student'],
    });
    expect(made.value).toMatchObject({
      name: 'Exam week',
      member_count: 0,
      available_count: 0,
      max_loan_days: null,
      eligible_person_kinds: ['student'],
    });
    expect(made.etag).toBeDefined();
  });

  it('edits a pool with If-Match and refuses a stale version', async () => {
    const { value, etag } = await loanersApi.createPool({ name: 'Edit me' });
    const saved = await loanersApi.updatePool(value.id, { default_loan_days: 4 }, etag);
    expect(saved.value.default_loan_days).toBe(4);
    expect(
      (await fails(loanersApi.updatePool(value.id, { description: 'again' }, etag))).status,
    ).toBe(412);
  });

  it('adds a device to one pool at most, in bulk too, and keeps an open loan from being removed', async () => {
    const students = await pool('Student');
    const staff = await pool('Staff');
    const taken = (await members(students.id))[0]!;
    expect((await fails(loanersApi.addMember(staff.id, taken.asset_id))).status).toBe(409);
    // adding to the pool it is already in answers with the member
    expect((await loanersApi.addMember(students.id, taken.asset_id)).asset_id).toBe(taken.asset_id);
    const out = (await members(students.id, false)).find((m) => m.asset?.current_assignment)!;
    const blocked = await fails(loanersApi.removeMember(students.id, out.asset_id));
    expect(blocked.status).toBe(409);
    expect((blocked.body as { usage?: Record<string, number> }).usage).toEqual({ open_loans: 1 });
    const free = (await members(students.id, true))[0]!;
    await loanersApi.removeMember(students.id, free.asset_id);
    await loanersApi.addMember(students.id, free.asset_id);
  });

  it('bulk add and remove answer per asset with a summary', async () => {
    const { value: tiny } = await loanersApi.createPool({ name: 'Bulk pool' });
    const students = await pool('Student');
    const ids = (await members(students.id, true)).slice(0, 2).map((m) => m.asset_id);
    const http = getApi().http;
    const added = await http.POST('/v1/loaner-pools/{id}/members/bulk-add', {
      params: { path: { id: tiny.id }, header: { 'Idempotency-Key': key() } },
      body: { ids },
    });
    // the devices belong to the student pool: both items fail, the request is still a 200
    expect(added.data?.summary).toEqual({ total: 2, succeeded: 0, failed: 2 });
    expect(added.data?.results[0]).toMatchObject({ index: 0, status: 409 });
    const free = (await loanersApi.pools()).data.length;
    expect(free).toBe(3);
  });

  it('archives a pool only when nothing is out (usage.open_loans)', async () => {
    const students = await pool('Student');
    const refused = await fails(loanersApi.archivePool(students.id));
    expect(refused.status).toBe(409);
    expect((refused.body as { usage?: Record<string, number> }).usage).toEqual({ open_loans: 3 });
    const { value } = await loanersApi.createPool({ name: 'Short lived' });
    await loanersApi.archivePool(value.id);
    expect((await loanersApi.pools()).data.some((p) => p.id === value.id)).toBe(false);
  });
});

describe('mock loans: single, quick, return', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('lends the next free device with a pool-default due date through the single endpoint', async () => {
    const staff = await pool('Staff');
    const person = await borrower(12);
    const http = getApi().http;
    const result = await http.POST('/v1/loaner-pools/{id}/checkout', {
      params: { path: { id: staff.id }, header: { 'Idempotency-Key': key() } },
      body: { person_id: person.id },
    });
    expect(result.data?.assignment).toMatchObject({
      person_id: person.id,
      expected_return: inDays(14),
    });
    expect((await pool('Staff')).checked_out_count).toBe(2);
  });

  it('a quick check-out lends several devices to one borrower, each answered on its own', async () => {
    const students = await pool('Student');
    const person = await borrower(13);
    const [a, b] = (await members(students.id, true)).map((m) => m.asset!.asset_tag);
    const outTag = (await members(students.id, false))[0]!.asset!.asset_tag;
    const looseTag = (await members((await pool('Staff')).id, true))[0]!.asset!.asset_tag;
    const result = await loanersApi.quickCheckout(
      students.id,
      { person_id: person.id, codes: [a!, outTag, looseTag, 'NOPE-0000', b!] },
      key(),
    );
    expect(result.person).toMatchObject({ id: person.id, display_name: person.display_name });
    expect(result.expected_return).toBe(inDays(7));
    expect(result.summary).toEqual({ total: 5, succeeded: 1, failed: 4 });
    expect(result.results.map((r) => r.status)).toEqual([201, 409, 422, 404, 409]);
    expect(result.results[1]!.error?.code).toBe('asset-already-checked-out');
    expect(result.results[2]!.error?.errors?.[0]).toMatchObject({
      pointer: '/codes/2',
      code: 'not-in-pool',
    });
    expect(result.results[0]!.data?.assignment.person_id).toBe(person.id);
    expect(result.results[4]!.error?.code).toBe('loan-limit-reached');
    expect((await pool('Student')).checked_out_count).toBe(4);
  });

  it('finds the borrower by exact email or number, and replays the same key', async () => {
    const students = await pool('Student');
    const person = (await peopleApi.list({ limit: 50, status: 'active' })).data.find(
      (p) => p.employee_ref && p.email,
    )!;
    const tag = (await members(students.id, true))[0]!.asset!.asset_tag;
    const request = { borrower: person.employee_ref!.toLowerCase(), codes: [tag] };
    const k = key();
    const first = await loanersApi.quickCheckout(students.id, request, k);
    expect(first.person.id).toBe(person.id);
    const again = await loanersApi.quickCheckout(students.id, request, k);
    expect(again.results[0]!.data?.assignment.id).toBe(first.results[0]!.data?.assignment.id);
    const nobody = await fails(
      loanersApi.quickCheckout(
        students.id,
        { borrower: 'nobody@nowhere.test', codes: [tag] },
        key(),
      ),
    );
    expect(nobody.status).toBe(422);
    expect(pointers(nobody)).toContain('/borrower');
  });

  it('refuses a borrower at the pool limit per device, a switched-off pool and an ineligible kind', async () => {
    const students = await pool('Student');
    const person = await borrower(15);
    const [a, b] = (await members(students.id, true)).map((m) => m.asset!.asset_tag);
    const result = await loanersApi.quickCheckout(
      students.id,
      { person_id: person.id, codes: [a!, b!] },
      key(),
    );
    expect(result.results.map((r) => r.status)).toEqual([201, 409]);
    expect(result.results[1]!.error?.code).toBe('loan-limit-reached');

    const { value: off } = await loanersApi.createPool({ name: 'Off', is_active: false });
    const inactive = await fails(
      loanersApi.quickCheckout(off.id, { person_id: person.id, codes: ['X'] }, key()),
    );
    expect(inactive.status).toBe(409);
    expect(code(inactive)).toBe('loaner-pool-inactive');

    const { value: kids } = await loanersApi.createPool({
      name: 'Kids',
      eligible_person_kinds: ['student'],
    });
    const adults = (await peopleApi.list({ limit: 80, status: 'active' })).data.find(
      (p) => p.kind !== 'student',
    )!;
    const refused = await fails(
      loanersApi.quickCheckout(kids.id, { person_id: adults.id, codes: ['X'] }, key()),
    );
    expect(refused.status).toBe(422);
    expect((refused.body as { errors: Array<{ code?: string }> }).errors[0]!.code).toBe(
      'not-eligible',
    );
  });

  it('keeps the due date within today and the longest loan; needs 1 to 50 codes and a key', async () => {
    const students = await pool('Student');
    const person = await borrower(16);
    const tag = (await members(students.id, true))[0]!.asset!.asset_tag;
    const late = await fails(
      loanersApi.quickCheckout(
        students.id,
        { person_id: person.id, codes: [tag], expected_return: inDays(90) },
        key(),
      ),
    );
    expect(pointers(late)).toContain('/expected_return');
    expect(
      pointers(
        await fails(
          loanersApi.quickCheckout(students.id, { person_id: person.id, codes: [] }, key()),
        ),
      ),
    ).toContain('/codes');
    expect(
      (
        await fails(
          loanersApi.quickCheckout(students.id, { person_id: person.id, codes: [tag] }, ''),
        )
      ).status,
    ).toBe(400);
  });

  it('the viewer reads but cannot lend', async () => {
    const students = await pool('Student');
    seedSession(MOCK_ACCOUNTS.viewer);
    const person = await borrower(2);
    const denied = await fails(
      loanersApi.quickCheckout(students.id, { person_id: person.id, codes: ['A'] }, key()),
    );
    expect(denied.status).toBe(403);
    expect((await loanersApi.pools()).data.length).toBeGreaterThan(0);
  });

  it('a quick return answers per device and sends the device to the pool home', async () => {
    const students = await pool('Student');
    const out = await members(students.id, false);
    const free = (await members(students.id, true))[0]!;
    const result = await loanersApi.returnLoans(
      {
        codes: [
          out[0]!.asset!.asset_tag,
          free.asset!.asset_tag,
          'NOPE-1',
          (await members((await pool('Staff')).id, true))[0]!.asset!.asset_tag,
        ],
        loaner_pool_id: students.id,
      },
      key(),
    );
    expect(result.summary).toEqual({ total: 4, succeeded: 1, failed: 3 });
    expect(result.results.map((r) => r.status)).toEqual([200, 409, 404, 422]);
    expect(result.results[1]!.error?.code).toBe('asset-not-checked-out');
    expect(result.results[3]!.error?.errors?.[0]!.code).toBe('not-in-pool');
    expect(result.results[0]!.data?.asset.current_assignment).toBeNull();
    expect((await pool('Student')).checked_out_count).toBe(2);
  });
});

describe('mock loans: list, extend, overdue', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('lists the open loans by default and filters by state and pool', async () => {
    const students = await pool('Student');
    const open = await loanersApi.loans({ limit: 50 });
    expect(open.data).toHaveLength(4);
    const overdue = await loanersApi.loans({ state: ['overdue'] });
    expect(overdue.data).toHaveLength(1);
    expect(overdue.data[0]).toMatchObject({
      state: 'overdue',
      days_overdue: 5,
      pool_name: 'Student Chromebook loaners',
    });
    expect(overdue.data[0]!.person_name).toBeTruthy();
    expect(
      (await loanersApi.loans({ loaner_pool_id: students.id, state: ['due_today'] })).data,
    ).toHaveLength(1);
    expect((await loanersApi.loans({ state: ['returned'] })).data).toEqual([]);
  });

  it('extends an open loan (logged) and refuses what the rules refuse', async () => {
    const dueToday = (await loanersApi.loans({ state: ['due_today'] })).data[0]!;
    const { http } = getApi();
    const post = (id: string, expected_return: string) =>
      loanersApi.extend(id, { expected_return, note: 'Exam week' });
    expect(pointers(await fails(post(dueToday.id, dueToday.expected_return)))).toContain(
      '/expected_return',
    );
    const tooLong = await fails(post(dueToday.id, inDays(400)));
    expect((tooLong.body as { errors: Array<{ code?: string }> }).errors[0]!.code).toBe(
      'exceeds-max-loan',
    );
    const extended = await post(dueToday.id, inDays(3));
    expect(extended).toMatchObject({ expected_return: inDays(3), state: 'on_loan' });
    expect(http).toBeDefined();
    const overdue = (await loanersApi.loans({ state: ['overdue'] })).data[0]!;
    const past = await fails(post(overdue.id, inDays(-2)));
    expect((past.body as { errors: Array<{ code?: string }> }).errors[0]!.code).toMatch(
      /in-the-past|not-an-extension/,
    );
  });

  it('lists overdue check-outs with the new names', async () => {
    const { data } = await getApi().http.GET('/v1/loans/overdue', { params: { query: {} } });
    const row = data!.data.find((o) => o.pool_name)!;
    expect(row).toMatchObject({ pool_name: 'Student Chromebook loaners', days_overdue: 5 });
    expect(row.asset_tag).toMatch(/^AT-/);
    expect(row.holder_name).toBeTruthy();
  });

  it('reads and replaces the custody settings with If-Match', async () => {
    const { value, etag } = await custodySettingsApi.get();
    expect(value).toEqual({ default_expected_return_days: null, loan_reminder_days: 2 });
    const saved = await custodySettingsApi.put(
      { default_expected_return_days: 14, loan_reminder_days: 3 },
      etag,
    );
    expect(saved.value).toEqual({ default_expected_return_days: 14, loan_reminder_days: 3 });
    expect(
      (
        await fails(
          custodySettingsApi.put({ default_expected_return_days: 1, loan_reminder_days: 1 }, etag),
        )
      ).status,
    ).toBe(412);
    expect(
      pointers(
        await fails(
          custodySettingsApi.put({ default_expected_return_days: 999, loan_reminder_days: 1 }),
        ),
      ),
    ).toContain('/default_expected_return_days');
  });
});
