import { expect, test, type Page } from '@playwright/test';
import { runId, signInAsOwner } from './support';

/**
 * M2-REG-03, M2-USR-03 and M2-UX-02 against the REAL stack (no mock):
 *
 *   sort the asset list by Assigned to / Due back / Location from the column headers (empty values last,
 *   paging stays correct) -> check an asset out and undo it from the toast, check it in and undo that
 *   (the history keeps both events) -> link a person to a login account from the person page and
 *   unlink it again (the login keeps a person of its own).
 *
 * Every name carries a per-run suffix, so the suite can run again on the same database.
 */
const id = runId();

test.describe.configure({ mode: 'serial' });

let page: Page;
let categoryId = '';
const people: string[] = [];
const assets: Array<{ id: string; tag: string }> = [];

/** Calls the real API from the signed-in page (cookie + CSRF), for set-up and read-back. */
async function api<T = unknown>(
  p: Page,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: T; etag: string | null }> {
  return p.evaluate(
    async ({ method, path, body, headers }) => {
      const me = (await (await fetch('/v1/auth/me')).json()) as { csrf_token: string };
      const res = await fetch(path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': me.csrf_token,
          'idempotency-key': `e2e-${Math.random().toString(36).slice(2)}-${Date.now()}`,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return {
        status: res.status,
        json: (text ? JSON.parse(text) : null) as never,
        etag: res.headers.get('etag'),
      };
    },
    { method, path, body, headers },
  );
}

async function pick(p: Page, name: RegExp | string, text: string, option: RegExp | string) {
  await p.getByRole('combobox', { name }).fill(text);
  await p.getByRole('option', { name: option }).first().click();
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  await page.context().close();
});

test('signs in and sets up three people and five assets with custody', async () => {
  await signInAsOwner(page);
  categoryId = (
    await api<{ data: Array<{ id: string }> }>(page, 'GET', '/v1/categories?kind=asset&limit=1')
  ).json.data[0]!.id;
  for (const name of [`Ana ${id}`, `Bruno ${id}`, `Cleo ${id}`]) {
    const person = await api<{ id: string }>(page, 'POST', '/v1/people', { display_name: name });
    expect(person.status).toBe(201);
    people.push(person.json.id);
  }
  const location = await api<{ id: string }>(page, 'POST', '/v1/locations', {
    name: `Sort room ${id}`,
  });
  for (let i = 0; i < 5; i++) {
    const asset = await api<{ id: string; asset_tag: string }>(page, 'POST', '/v1/assets', {
      category_id: categoryId,
      name: `Sort laptop ${id} ${i}`,
      ...(i < 3 ? { location_id: location.json.id } : {}),
    });
    expect(asset.status).toBe(201);
    assets.push({ id: asset.json.id, tag: asset.json.asset_tag });
  }
  // three of five are checked out, with different due dates; the other two are in stock
  const due = [30, 10, 20].map((d) =>
    new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10),
  );
  for (const [i, personId] of people.entries()) {
    const res = await api(page, 'POST', `/v1/assets/${assets[i]!.id}/checkout`, {
      person_id: personId,
      expected_return: due[i],
    });
    expect(res.status).toBe(201);
  }
});

test('sorts the list by Due back, Assigned to and Location, empty values last, across pages', async () => {
  // the API order first: three dated assets, ascending by date, then the two without a date
  for (const dir of ['', '-']) {
    const mine = await api<{ data: Array<{ id: string }>; page: { next_cursor: string | null } }>(
      page,
      'GET',
      `/v1/assets?q=${encodeURIComponent(`Sort laptop ${id}`)}&sort=${dir}due&limit=2`,
    );
    const second = await api<{ data: Array<{ id: string }> }>(
      page,
      'GET',
      `/v1/assets?q=${encodeURIComponent(`Sort laptop ${id}`)}&sort=${dir}due&limit=2&cursor=${mine.json.page.next_cursor}`,
    );
    const ids = [...mine.json.data, ...second.json.data].map((a) => a.id);
    const dated =
      dir === '' ? [assets[1]!, assets[2]!, assets[0]!] : [assets[0]!, assets[2]!, assets[1]!];
    expect(ids.slice(0, 3)).toEqual(dated.map((a) => a.id));
    expect(new Set(ids.slice(3, 4)).size).toBe(1);
    expect([assets[3]!.id, assets[4]!.id]).toContain(ids[3]);
  }

  // then the UI: the headers sort through the server
  await page.goto('/assets');
  await page.getByPlaceholder('Tag, serial or name').fill(`Sort laptop ${id}`);
  await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-5 of 5');
  const assignee = page.getByRole('columnheader', { name: /Assigned to/ });
  await assignee.getByRole('button').click();
  await expect(assignee).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.getByRole('row').nth(1)).toContainText(`Ana ${id}`);
  await assignee.getByRole('button').click();
  await expect(assignee).toHaveAttribute('aria-sort', 'descending');
  await expect(page.getByRole('row').nth(1)).toContainText(`Cleo ${id}`);
  const location = page.getByRole('columnheader', { name: /Location/ });
  await location.getByRole('button').click();
  await expect(location).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.getByRole('row').nth(1)).toContainText(`Sort room ${id}`);
  await expect(page.getByRole('row').last()).not.toContainText(`Sort room ${id}`);
});

test('undoes a check-out from the toast (the history keeps both events)', async () => {
  const asset = assets[3]!;
  await page.goto(`/assets/view?id=${asset.id}`);
  await page.getByRole('button', { name: 'Check out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Check out ${asset.tag}` });
  await pick(page, /Person/, `Ana ${id}`, new RegExp(`Ana ${id}`));
  await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
  await expect(page.getByText(`${asset.tag} checked out to Ana ${id}.`).first()).toBeVisible();
  await expect(page.getByText('You can undo this for 10 seconds.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText(`Undone: ${asset.tag} is back as it was.`).first()).toBeVisible();
  await expect(page.getByTestId('asset-holder')).toHaveCount(0);

  const history = await api<{ data: Array<{ event_type: string }> }>(
    page,
    'GET',
    `/v1/assets/${asset.id}/history?limit=5`,
  );
  expect(history.json.data.slice(0, 2).map((e) => e.event_type)).toEqual([
    'custody_undone',
    'checked_out',
  ]);
});

test('undoes a check-in: the holder has it again; a change in between refuses the undo', async () => {
  const asset = assets[0]!;
  await page.goto(`/assets/view?id=${asset.id}`);
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Check in ${asset.tag}` });
  await dialog.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.getByText(`${asset.tag} checked in.`).first()).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText(`Undone: ${asset.tag} is back as it was.`).first()).toBeVisible();
  await expect(page.getByTestId('asset-holder')).toContainText(`Ana ${id}`);

  // check in again, then somebody edits the asset before Undo is used
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  const again = page.getByRole('dialog', { name: `Check in ${asset.tag}` });
  await again.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.getByText(`${asset.tag} checked in.`).first()).toBeVisible();
  const current = await api(page, 'GET', `/v1/assets/${asset.id}`);
  const edit = await api(
    page,
    'PATCH',
    `/v1/assets/${asset.id}`,
    { notes: 'edited in between' },
    { 'if-match': current.etag ?? '' },
  );
  expect(edit.status).toBe(200);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByText(`${asset.tag} changed in the meantime, so this cannot be undone.`).first(),
  ).toBeVisible();
  const now = await api<{ current_assignment: unknown }>(page, 'GET', `/v1/assets/${asset.id}`);
  expect(now.json.current_assignment).toBeNull();
});

test('links a person to a login from the person page and unlinks it again', async () => {
  const roles = await api<{ data: Array<{ id: string; key: string }> }>(page, 'GET', '/v1/roles');
  const viewer = roles.json.data.find((r) => r.key === 'viewer')!;
  const email = `link-${id.toLowerCase()}@acme.example`;
  const user = await api<{ id: string; person_id: string }>(page, 'POST', '/v1/users', {
    email,
    display_name: `Login ${id}`,
    role_assignments: [{ role_id: viewer.id, scope_type: 'tenant' }],
  });
  expect(user.status).toBe(201);
  const placeholder = user.json.person_id;
  expect(placeholder).toBeTruthy();

  const pupil = people[1]!;
  await page.goto(`/people/view?id=${pupil}`);
  await expect(page.getByRole('button', { name: 'Link to a login' })).toBeVisible();
  await page.getByRole('button', { name: 'Link to a login' }).click();
  const dialog = page.getByRole('dialog', { name: `Link Bruno ${id} to a login` });
  await pick(page, /Login account/, `Login ${id}`, new RegExp(`Login ${id}`));
  await expect(dialog.getByText(new RegExp(`will sign in as ${email}`))).toBeVisible();
  await dialog.getByRole('button', { name: 'Link login' }).click();
  await expect(page.getByText(`Bruno ${id} is now linked to ${email}.`).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlink login' })).toBeVisible();

  const linked = await api<{ person_id: string }>(page, 'GET', `/v1/users/${user.json.id}`);
  expect(linked.json.person_id).toBe(pupil);
  const old = await api<{ archived_at: string | null; user_id: string | null }>(
    page,
    'GET',
    `/v1/people/${placeholder}`,
  );
  expect(old.json.archived_at).toBeTruthy();
  expect(old.json.user_id).toBeNull();

  // the same login cannot take a second person (the refusal names who has it)
  await page.goto(`/people/view?id=${people[2]}`);
  await page.getByRole('button', { name: 'Link to a login' }).click();
  const second = page.getByRole('dialog', { name: `Link Cleo ${id} to a login` });
  await pick(page, /Login account/, `Login ${id}`, new RegExp(`Login ${id}`));
  await second.getByRole('button', { name: 'Link login' }).click();
  await expect(second.getByText(new RegExp(`already linked to Bruno ${id}`))).toBeVisible();
  await second.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(`/people/view?id=${pupil}`);
  await page.getByRole('button', { name: 'Unlink login' }).click();
  const confirm = page.getByRole('dialog', { name: `Unlink Bruno ${id} from their login?` });
  await confirm.getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByText(`Bruno ${id} was unlinked from their login.`).first()).toBeVisible();
  const after = await api<{ person_id: string }>(page, 'GET', `/v1/users/${user.json.id}`);
  expect(after.json.person_id).toBeTruthy();
  expect(after.json.person_id).not.toBe(pupil);
  expect(after.json.person_id).not.toBe(placeholder);

  // the toast says where the login went and leads to its new automatic record, which has nothing to
  // unlink: no Unlink button, a badge and a sentence instead; the API refuses it too (ED-33)
  await expect(
    page
      .getByText(
        `Bruno ${id} keeps their assets and history. The login ${email} now has its own empty record.`,
      )
      .first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open the new record' }).click();
  await expect(page.getByTestId('person-name')).toHaveText(`Login ${id}`);
  await expect(page.getByTestId('login-placeholder-badge')).toHaveText("Login's own record");
  await expect(page.getByTestId('login-placeholder-hint')).toContainText(
    `This is the automatic record of the login ${email}; there is nothing to unlink.`,
  );
  await expect(page.getByRole('button', { name: 'Unlink login' })).toHaveCount(0);
  const refused = await api<{ code: string }>(
    page,
    'DELETE',
    `/v1/people/${after.json.person_id}/link-user`,
  );
  expect(refused.status).toBe(409);
  expect(refused.json.code).toBe('conflict');
});
