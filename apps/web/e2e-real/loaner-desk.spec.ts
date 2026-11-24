import { expect, test, type Page } from '@playwright/test';
import { runId, signInAsOwner } from './support';

/**
 * The loaner desk against the REAL stack (M2-LOAN-02, ED-20, ED-24): a pool with three devices is set
 * up through the API, the desk lends the three to one borrower in one go, the dashboard and the loan
 * list agree, then the desk takes the three back one by one. Every name carries a per-run suffix.
 */
const id = runId();

test.describe.configure({ mode: 'serial' });

let page: Page;
const devices: Array<{ id: string; tag: string }> = [];
let poolId = '';
const poolName = `Real cart ${id}`;
const borrowerName = `Desk Borrower ${id}`;

/** Calls the real API from the signed-in page (cookie + CSRF). */
async function api<T = unknown>(
  p: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  return p.evaluate(
    async ({ method, path, body }) => {
      const me = (await (await fetch('/v1/auth/me')).json()) as { csrf_token: string };
      const res = await fetch(path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': me.csrf_token,
          'idempotency-key': `e2e-${Math.random().toString(36).slice(2)}-${Date.now()}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, json: (text ? JSON.parse(text) : null) as never };
    },
    { method, path, body },
  );
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  await page.context().close();
});

test('signs in and sets up a pool of three devices and a borrower', async () => {
  await signInAsOwner(page);
  const category = (
    await api<{ data: Array<{ id: string }> }>(page, 'GET', '/v1/categories?kind=asset&limit=1')
  ).json.data[0]!.id;
  const pool = await api<{ id: string; effective_default_loan_days: number }>(
    page,
    'POST',
    '/v1/loaner-pools',
    { name: poolName, max_loan_days: 14 },
  );
  expect(pool.status).toBe(201);
  // no loan length of its own: the organisation default, else 7 days
  expect(pool.json.effective_default_loan_days).toBeGreaterThanOrEqual(1);
  poolId = pool.json.id;
  for (let i = 0; i < 3; i++) {
    const asset = await api<{ id: string; asset_tag: string }>(page, 'POST', '/v1/assets', {
      category_id: category,
      name: `Real loaner ${id} ${i}`,
    });
    expect(asset.status).toBe(201);
    devices.push({ id: asset.json.id, tag: asset.json.asset_tag });
    const member = await api(page, 'POST', `/v1/loaner-pools/${poolId}/members`, {
      asset_id: asset.json.id,
    });
    expect(member.status).toBe(201);
  }
  const person = await api(page, 'POST', '/v1/people', {
    display_name: borrowerName,
    email: `desk.${id.toLowerCase()}@school.example`,
    kind: 'employee',
  });
  expect(person.status).toBe(201);
});

test('lends the three devices to one borrower from the desk', async () => {
  await page.goto('/loaners/desk');
  await page.getByRole('combobox', { name: 'Lend from' }).click();
  await page.getByRole('option', { name: new RegExp(poolName) }).click();
  const device = page.getByLabel('Device', { exact: true });
  for (const d of devices) {
    await device.fill(d.tag);
    await device.press('Enter');
  }
  await expect(
    page.getByRole('list', { name: 'Devices to lend' }).getByRole('listitem'),
  ).toHaveCount(3);
  const borrower = page.getByLabel('Borrower', { exact: true });
  await borrower.fill(borrowerName);
  await borrower.press('Enter');
  await expect(page.getByLabel('Due date')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Lend 3 devices' }).click();
  await expect(page.getByTestId('desk-feedback')).toContainText(
    `3 devices lent to ${borrowerName}`,
  );

  // the real API agrees: three open loans of the pool, due inside the pool's maximum
  const loans = await api<{
    data: Array<{ asset_id: string; state: string; expected_return: string }>;
  }>(page, 'GET', `/v1/loans?loaner_pool_id=${poolId}`);
  expect(loans.json.data.map((l) => l.asset_id).sort()).toEqual(devices.map((d) => d.id).sort());
  const latest = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  for (const loan of loans.json.data) expect(loan.expected_return <= latest).toBe(true);

  // the dashboard follows
  await page.goto('/loaners');
  await expect(page.getByTestId(`pool-${poolId}-onLoan`)).toContainText('3');
  await expect(page.getByTestId(`pool-${poolId}-available`)).toContainText('0');
});

test('takes the three devices back at the desk', async () => {
  await page.goto('/loaners/desk?mode=return');
  const returned = page.getByLabel('Returned device');
  await expect(returned).toBeFocused();
  const feedback = page.getByTestId('desk-feedback');
  for (const [index, d] of devices.entries()) {
    await returned.fill(d.tag);
    await returned.press('Enter');
    await expect(feedback).toContainText(`${d.tag} returned`);
    await expect(page.getByTestId('desk-return-summary')).toContainText(
      `${index + 1} ${index === 0 ? 'device' : 'devices'} returned`,
    );
  }
  const loans = await api<{ data: unknown[] }>(
    page,
    'GET',
    `/v1/loans?loaner_pool_id=${poolId}&state=on_loan,due_today,overdue`,
  );
  expect(loans.json.data).toHaveLength(0);
  await page.goto('/loaners');
  await expect(page.getByTestId(`pool-${poolId}-onLoan`)).toContainText('0');
  await expect(page.getByTestId(`pool-${poolId}-available`)).toContainText('3');
});
