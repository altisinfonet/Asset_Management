import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Resp, dbEnabled } from '../auth/support.js';
import { contractViolations } from '../support/contract-observer.js';
import {
  LOANER_TAGS,
  UNIVERSAL_STATUSES,
  loadContract,
  loadProblemCodes,
} from '../support/contract.js';
import { mode } from '../support/db.js';
import { check } from '../support/schema-check.js';
import {
  type App,
  type TenantFixture,
  basics,
  createTenant,
  inDays,
  keyed,
  newAsset,
  newPerson,
  newTenancy,
  startRegistryApp,
  unique,
} from '../lifecycle/support.js';

/**
 * Live half of the contract test for the loaner pools (ED-20): every operation of the `Loaners` tag
 * is called with valid input, and each answer must have a documented status, validate against the
 * response schema, and, for errors, be a problem document with a code of the catalogue. This is the
 * test that fixes the shapes the web app is built against.
 */
describe.skipIf(!dbEnabled)(`loaners contract (live, ${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  const { operations } = loadContract();
  const byId = new Map(operations.map((o) => [o.operationId, o]));
  const walked = new Set<string>();
  const problemCodes = loadProblemCodes();

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'loanc');
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  async function hit(
    operationId: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    expected: number,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Resp> {
    const op = byId.get(operationId);
    expect(op, `operation ${operationId} is not in the contract`).toBeDefined();
    const res = await t.admin.request(method, url, {
      body: options.body,
      headers: options.headers ?? {},
    });
    expect(res.status, `${operationId}: ${method} ${url} -> ${res.raw.slice(0, 300)}`).toBe(
      expected,
    );
    expect(
      op!.statuses.includes(res.status) || UNIVERSAL_STATUSES.includes(res.status),
      `${operationId} answered ${res.status}, the contract documents ${op!.statuses.join(', ')}`,
    ).toBe(true);
    if (res.status < 400) {
      walked.add(operationId);
      const schema = op!.responseSchemas[res.status];
      if (schema) {
        expect(
          check({ $ref: `#/components/schemas/${schema}` }, res.body),
          `${operationId} response body`,
        ).toEqual([]);
      } else if (res.status !== 204) {
        expect(res.raw, `${operationId}: no body documented for ${res.status}`).toBe('');
      }
    } else {
      expect(String(res.headers['content-type'])).toMatch(/^application\/problem\+json/);
      expect(check({ $ref: '#/components/schemas/Problem' }, res.body)).toEqual([]);
      expect(problemCodes[res.body.code], `unknown problem code ${res.body.code}`).toContain(
        res.status,
      );
    }
    return res;
  }

  it('walks every Loaners operation: statuses and bodies match the contract', async () => {
    const uuid = () => randomUUID();
    const etag = (r: Resp) => String(r.headers.etag);
    const { categoryId } = await basics(t);
    const device = async () => {
      const asset = await newAsset(t.admin, categoryId, { serial: unique('SN') });
      return { id: asset.id as string, tag: asset.body.asset_tag as string };
    };
    const kid = await newPerson(t.admin, {
      kind: 'student',
      email: `${unique('kid')}@school.example`,
    });

    // ---- pools
    const pool = await hit('createLoanerPool', 'POST', '/v1/loaner-pools', 201, {
      body: {
        name: unique('Cart'),
        default_loan_days: 5,
        max_loan_days: 14,
        max_loans_per_person: 3,
        eligible_person_kinds: ['student'],
      },
    });
    await hit('createLoanerPool', 'POST', '/v1/loaner-pools', 409, {
      body: { name: pool.body.name },
    });
    await hit('createLoanerPool', 'POST', '/v1/loaner-pools', 422, { body: { name: '' } });
    await hit(
      'listLoanerPools',
      'GET',
      '/v1/loaner-pools?limit=5&include_total=true&sort=-name',
      200,
    );
    await hit('listLoanerPools', 'GET', '/v1/loaner-pools?sort=nope', 400);
    await hit('getLoanerPool', 'GET', `/v1/loaner-pools/${pool.body.id}`, 200);
    await hit('getLoanerPool', 'GET', `/v1/loaner-pools/${uuid()}`, 404);
    const updated = await hit(
      'updateLoanerPool',
      'PATCH',
      `/v1/loaner-pools/${pool.body.id}`,
      200,
      {
        body: { description: 'Room 12' },
        headers: { 'if-match': etag(pool) },
      },
    );
    await hit('updateLoanerPool', 'PATCH', `/v1/loaner-pools/${pool.body.id}`, 412, {
      body: { description: 'x' },
      headers: { 'if-match': etag(pool) },
    });
    await hit('updateLoanerPool', 'PATCH', `/v1/loaner-pools/${pool.body.id}`, 428, {
      body: { description: 'x' },
    });
    await hit('updateLoanerPool', 'PATCH', `/v1/loaner-pools/${pool.body.id}`, 422, {
      body: { max_loan_days: 2 },
      headers: { 'if-match': etag(updated) },
    });

    // ---- members
    const [d1, d2, d3, d4] = [await device(), await device(), await device(), await device()];
    await hit('addLoanerPoolMember', 'POST', `/v1/loaner-pools/${pool.body.id}/members`, 201, {
      body: { asset_id: d1.id },
    });
    await hit('addLoanerPoolMember', 'POST', `/v1/loaner-pools/${pool.body.id}/members`, 200, {
      body: { asset_id: d1.id },
    });
    const other = await hit('createLoanerPool', 'POST', '/v1/loaner-pools', 201, {
      body: { name: unique('Other') },
    });
    await hit('addLoanerPoolMember', 'POST', `/v1/loaner-pools/${other.body.id}/members`, 409, {
      body: { asset_id: d1.id },
    });
    await hit('addLoanerPoolMember', 'POST', `/v1/loaner-pools/${pool.body.id}/members`, 422, {
      body: { asset_id: uuid() },
    });
    await hit(
      'bulkAddLoanerPoolMembers',
      'POST',
      `/v1/loaner-pools/${pool.body.id}/members/bulk-add`,
      200,
      {
        body: { ids: [d2.id, d3.id, d4.id, uuid()] },
      },
    );
    await hit(
      'bulkAddLoanerPoolMembers',
      'POST',
      `/v1/loaner-pools/${pool.body.id}/members/bulk-add`,
      422,
      {
        body: { ids: [] },
      },
    );
    await hit(
      'listLoanerPoolMembers',
      'GET',
      `/v1/loaner-pools/${pool.body.id}/members?limit=2&available=true`,
      200,
    );
    await hit(
      'listLoanerPoolMembers',
      'GET',
      `/v1/loaner-pools/${pool.body.id}/members?available=maybe`,
      400,
    );
    await hit('listLoanerPoolMembers', 'GET', `/v1/loaner-pools/${uuid()}/members`, 404);

    // ---- lending
    await hit('checkoutLoaner', 'POST', `/v1/loaner-pools/${pool.body.id}/checkout`, 201, {
      body: { person_id: kid.id, asset_id: d1.id, note: 'Exam week' },
      headers: keyed().headers,
    });
    await hit('checkoutLoaner', 'POST', `/v1/loaner-pools/${pool.body.id}/checkout`, 400, {
      body: { person_id: kid.id },
    });
    await hit('checkoutLoaner', 'POST', `/v1/loaner-pools/${pool.body.id}/checkout`, 422, {
      body: { person_id: uuid() },
      headers: keyed().headers,
    });
    const quick = await hit(
      'quickCheckoutLoaners',
      'POST',
      `/v1/loaner-pools/${pool.body.id}/quick-checkout`,
      200,
      {
        body: { person_id: kid.id, codes: [d2.tag, 'NO-SUCH-CODE'], expected_return: inDays(3) },
        headers: keyed().headers,
      },
    );
    expect(quick.body.results.map((r: { status: number }) => r.status)).toEqual([201, 404]);
    await hit(
      'quickCheckoutLoaners',
      'POST',
      `/v1/loaner-pools/${pool.body.id}/quick-checkout`,
      422,
      {
        body: { borrower: 'nobody@nowhere.example', codes: [d3.tag] },
        headers: keyed().headers,
      },
    );
    await hit('quickCheckoutLoaners', 'POST', `/v1/loaner-pools/${uuid()}/quick-checkout`, 404, {
      body: { person_id: kid.id, codes: [d3.tag] },
      headers: keyed().headers,
    });
    const loanId = quick.body.results[0].data.assignment.id as string;

    // ---- loans
    const list = await hit(
      'listLoans',
      'GET',
      `/v1/loans?loaner_pool_id=${pool.body.id}&include_total=true&limit=1`,
      200,
    );
    expect(list.body.page.total).toBe(2);
    await hit(
      'listLoans',
      'GET',
      `/v1/loans?loaner_pool_id=${pool.body.id}&state=returned,overdue,due_today,on_loan&sort=-checked_out_at`,
      200,
    );
    await hit('listLoans', 'GET', '/v1/loans?state=gone', 400);
    await hit('getLoan', 'GET', `/v1/loans/${loanId}`, 200);
    await hit('getLoan', 'GET', `/v1/loans/${uuid()}`, 404);
    await hit('extendLoan', 'POST', `/v1/loans/${loanId}/extend`, 200, {
      body: { expected_return: inDays(9), note: 'Project' },
    });
    await hit('extendLoan', 'POST', `/v1/loans/${loanId}/extend`, 422, {
      body: { expected_return: inDays(9) },
    });
    await hit('extendLoan', 'POST', `/v1/loans/${uuid()}/extend`, 404, {
      body: { expected_return: inDays(9) },
    });
    await hit('listOverdueCheckouts', 'GET', '/v1/loans/overdue?limit=5&sort=-days_overdue', 200);
    await hit('listOverdueCheckouts', 'GET', '/v1/loans/overdue?sort=nope', 400);
    await hit('getLoanerDashboard', 'GET', '/v1/loaners/dashboard', 200);

    // ---- returning
    const back = await hit('returnLoans', 'POST', '/v1/loans/return', 200, {
      body: { codes: [d1.tag, d2.tag, d3.tag, 'NO-SUCH-CODE'], condition: 'good' },
      headers: keyed().headers,
    });
    expect(back.body.results.map((r: { status: number }) => r.status)).toEqual([
      200, 200, 409, 404,
    ]);
    await hit('returnLoans', 'POST', '/v1/loans/return', 400, { body: { codes: [d1.tag] } });
    await hit('returnLoans', 'POST', '/v1/loans/return', 422, {
      body: { codes: [] },
      headers: keyed().headers,
    });

    // ---- removing and archiving
    await hit(
      'removeLoanerPoolMember',
      'DELETE',
      `/v1/loaner-pools/${pool.body.id}/members/${d1.id}`,
      204,
    );
    await hit(
      'removeLoanerPoolMember',
      'DELETE',
      `/v1/loaner-pools/${pool.body.id}/members/${d1.id}`,
      404,
    );
    await hit(
      'bulkRemoveLoanerPoolMembers',
      'POST',
      `/v1/loaner-pools/${pool.body.id}/members/bulk-remove`,
      200,
      {
        body: { ids: [d2.id, uuid()] },
      },
    );
    await hit(
      'bulkRemoveLoanerPoolMembers',
      'POST',
      `/v1/loaner-pools/${pool.body.id}/members/bulk-remove`,
      422,
      {
        body: { ids: [] },
      },
    );
    // a device still out blocks the removal and the archive (409 with usage)
    await hit(
      'quickCheckoutLoaners',
      'POST',
      `/v1/loaner-pools/${pool.body.id}/quick-checkout`,
      200,
      {
        body: { person_id: kid.id, codes: [d3.tag] },
        headers: keyed().headers,
      },
    );
    await hit(
      'removeLoanerPoolMember',
      'DELETE',
      `/v1/loaner-pools/${pool.body.id}/members/${d3.id}`,
      409,
    );
    const current = await hit('getLoanerPool', 'GET', `/v1/loaner-pools/${pool.body.id}`, 200);
    await hit('archiveLoanerPool', 'DELETE', `/v1/loaner-pools/${pool.body.id}`, 409, {
      headers: { 'if-match': etag(current) },
    });
    await hit('returnLoans', 'POST', '/v1/loans/return', 200, {
      body: { codes: [d3.tag] },
      headers: keyed().headers,
    });
    await hit('archiveLoanerPool', 'DELETE', `/v1/loaner-pools/${pool.body.id}`, 204, {
      headers: { 'if-match': etag(current) },
    });
    await hit('archiveLoanerPool', 'DELETE', `/v1/loaner-pools/${pool.body.id}`, 404, {
      headers: { 'if-match': '*' },
    });
  });

  it('walks the custody settings (M2-LIFE-09)', async () => {
    const got = await hit('getCustodySettings', 'GET', '/v1/settings/custody', 200);
    await hit('putCustodySettings', 'PUT', '/v1/settings/custody', 428, {
      body: { loan_reminder_days: 3 },
    });
    await hit('putCustodySettings', 'PUT', '/v1/settings/custody', 412, {
      body: { loan_reminder_days: 3 },
      headers: { 'if-match': 'W/"999"' },
    });
    await hit('putCustodySettings', 'PUT', '/v1/settings/custody', 422, {
      body: { loan_reminder_days: 99 },
      headers: { 'if-match': String(got.headers.etag) },
    });
    await hit('putCustodySettings', 'PUT', '/v1/settings/custody', 200, {
      body: { default_expected_return_days: 14, loan_reminder_days: 3 },
      headers: { 'if-match': String(got.headers.etag) },
    });
  });

  it('the walk covered every operation of the Loaners tag', () => {
    const required = operations.filter((o) => LOANER_TAGS.has(o.tag)).map((o) => o.operationId);
    expect(required).toHaveLength(18);
    expect(required.filter((id) => !walked.has(id))).toEqual([]);
  });
});
