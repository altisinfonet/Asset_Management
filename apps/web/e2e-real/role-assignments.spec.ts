import { expect, test, type Page } from '@playwright/test';
import { api, choose, runId, signInAsOwner, waitForMail } from './support';

/**
 * Real stack (compose api + Postgres + Mailpit), no mock. M2-USR-04 (ED-27): on Settings > Users the
 * administrator opens a user's access, adds a role limited to one site with "Add access", and removes
 * it again after a confirmation. The API is read back each time: the assignment exists with its
 * scope, then it is gone; the user's own (only) access cannot be removed.
 */
const id = runId();
const SITE = `E2E Access Site ${id}`;
const NAME = `E2E Access ${id}`;
// stored lower-cased by the API: compare in that form
const EMAIL = `access-${id}@acme.example`.toLowerCase();

test.describe.configure({ mode: 'serial' });

let admin: Page;
let siteId = '';
let userId = '';

type Assignments = Array<{
  id: string;
  role_id: string;
  scope_type: string;
  location_id: string | null;
}>;
const assignmentsOf = async () =>
  (await api<{ role_assignments: Assignments }>(admin, 'GET', `/v1/users/${userId}`)).json
    .role_assignments;

test.beforeAll(async ({ browser }) => {
  admin = await (await browser.newContext()).newPage();
  await signInAsOwner(admin);
  const site = await api<{ id: string }>(admin, 'POST', '/v1/locations', {
    name: SITE,
    kind: 'site',
  });
  expect(site.status).toBe(201);
  siteId = site.json.id;
  const roles = await api<{ data: Array<{ id: string; key: string }> }>(admin, 'GET', '/v1/roles');
  const viewer = roles.json.data.find((r) => r.key === 'viewer')!;
  const invited = await api<{ id: string }>(admin, 'POST', '/v1/users', {
    email: EMAIL,
    display_name: NAME,
    role_assignments: [{ role_id: viewer.id }],
  });
  expect(invited.status).toBe(201);
  userId = invited.json.id;

  // the user accepts the mailed invitation, so they are listed among the people who can sign in
  const mail = await waitForMail(EMAIL);
  const token = decodeURIComponent(/token=([^\s&>"')\]]+)/.exec(mail.Text)![1]!);
  const other = await (await browser.newContext()).newPage();
  try {
    await other.goto('/login');
    const accepted = await other.evaluate(
      async ({ token, name }) => {
        const res = await fetch('/v1/auth/invitations/accept', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, password: `Access-${name}-Passw0rd`, display_name: name }),
        });
        return res.status;
      },
      { token, name: NAME },
    );
    expect(accepted).toBe(200);
  } finally {
    await other.context().close();
  }
});

test.afterAll(async () => {
  await admin.context().close();
});

test('an administrator adds a role limited to a site, then removes it', async () => {
  const before = await assignmentsOf();
  expect(before).toHaveLength(1);

  await admin.goto('/settings/users');
  const row = admin.getByRole('row', { name: new RegExp(NAME) });
  await row.getByRole('button', { name: new RegExp(`Actions for ${NAME}`) }).click();
  await admin.getByRole('menuitem', { name: 'Change role and access' }).click();
  const dialog = admin.getByRole('dialog', { name: `Role and access of ${NAME}` });
  // the user's only access cannot be removed
  await expect(dialog.getByRole('button', { name: 'Remove access: Viewer' })).toBeDisabled();

  await dialog.getByRole('button', { name: 'Add access' }).click();
  const add = admin.getByRole('dialog', { name: `Add access for ${NAME}` });
  await choose(admin, /^Role/, 'Technician');
  await choose(admin, /^Access/, 'Limited to a location');
  await add.getByRole('combobox', { name: /^Location/ }).fill(SITE);
  await admin
    .getByRole('option', { name: new RegExp(SITE) })
    .first()
    .click();
  await add.getByRole('button', { name: 'Add access' }).click();
  await expect(admin.getByText(`Access added for ${NAME}.`).first()).toBeVisible();
  await expect(dialog.getByText(`Technician at ${SITE}`)).toBeVisible();

  // the API holds the assignment with its scope
  const added = await assignmentsOf();
  expect(added).toHaveLength(2);
  expect(added.find((a) => a.scope_type === 'location')).toMatchObject({ location_id: siteId });

  // remove it after a confirmation
  await dialog.getByRole('button', { name: `Remove access: Technician at ${SITE}` }).click();
  const confirm = admin.getByRole('dialog', { name: 'Remove this access?' });
  await expect(confirm).toContainText(`${NAME} will no longer have Technician at ${SITE}`);
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(admin.getByText(`Access removed from ${NAME}.`).first()).toBeVisible();
  await expect(dialog.getByText(`Technician at ${SITE}`)).toHaveCount(0);

  const after = await assignmentsOf();
  expect(after).toHaveLength(1);
  expect(after[0]!.id).toBe(before[0]!.id);
  await expect(dialog.getByRole('button', { name: 'Remove access: Viewer' })).toBeDisabled();
});

test('the API refuses to remove the only access (409) and an assignment of nobody (404)', async () => {
  const [only] = await assignmentsOf();
  const etag = (await api(admin, 'GET', `/v1/users/${userId}`)).etag!;
  const refused = await api(
    admin,
    'DELETE',
    `/v1/users/${userId}/role-assignments/${only!.id}`,
    undefined,
    { 'if-match': etag },
  );
  expect(refused.status).toBe(409);
  const unknown = await api(
    admin,
    'DELETE',
    `/v1/users/${userId}/role-assignments/0194a000-0000-7000-8000-000000000001`,
    undefined,
    { 'if-match': etag },
  );
  expect(unknown.status).toBe(404);
  expect(await assignmentsOf()).toHaveLength(1);
});
