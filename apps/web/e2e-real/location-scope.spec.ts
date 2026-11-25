import { expect, test, type Page } from '@playwright/test';
import { api, choose, runId, signInAsOwner, waitForMail } from './support';

/**
 * Real stack (compose api + Postgres + Mailpit), no mock. M2-LOC-03 (ED-26): the administrator
 * invites a technician on the Users screen with access "Limited to a location" (one site); the
 * technician accepts the mailed invitation and, signed in, sees "Scoped to: <site>" and only that
 * site's assets: an asset at another site does not exist for them (404), also by its tag.
 */
const id = runId();
const SITE_IN = `E2E Scope In ${id}`;
const SITE_OUT = `E2E Scope Out ${id}`;
const ASSET = `Scope laptop ${id}`;
const INVITEE = `scoped-${id}@acme.example`;

test.describe.configure({ mode: 'serial' });

let admin: Page;
let inAssetId = '';
let outAssetId = '';
let outTag = '';

test.beforeAll(async ({ browser }) => {
  admin = await (await browser.newContext()).newPage();
  await signInAsOwner(admin);
  const siteIn = await api<{ id: string }>(admin, 'POST', '/v1/locations', {
    name: SITE_IN,
    kind: 'site',
  });
  const siteOut = await api<{ id: string }>(admin, 'POST', '/v1/locations', {
    name: SITE_OUT,
    kind: 'site',
  });
  expect(siteIn.status).toBe(201);
  expect(siteOut.status).toBe(201);
  const categories = await api<{ data: Array<{ id: string; kind: string }> }>(
    admin,
    'GET',
    '/v1/categories?limit=200',
  );
  const category = categories.json.data.find((c) => c.kind === 'asset')!;
  const made = async (where: string, suffix: string) => {
    const res = await api<{ id: string; asset_tag: string }>(admin, 'POST', '/v1/assets', {
      category_id: category.id,
      name: `${ASSET} ${suffix}`,
      location_id: where,
    });
    expect(res.status).toBe(201);
    return res.json;
  };
  inAssetId = (await made(siteIn.json.id, 'in')).id;
  const out = await made(siteOut.json.id, 'out');
  outAssetId = out.id;
  outTag = out.asset_tag;
});

test.afterAll(async () => {
  await admin.context().close();
});

test('an administrator limits a new technician to one site; the technician sees only that site', async ({
  browser,
}) => {
  // the administrator invites with access "Limited to a location"
  await admin.goto('/settings/users');
  await admin.getByRole('button', { name: 'Invite user' }).click();
  const dialog = admin.getByRole('dialog', { name: 'Invite a user' });
  await dialog.getByLabel(/^Name/).fill(`E2E Scoped ${id}`);
  await dialog.getByLabel(/^Email/).fill(INVITEE);
  await choose(admin, /^Role/, 'Technician');
  await choose(admin, /^Access/, 'Limited to a location');
  const location = dialog.getByRole('combobox', { name: /^Location/ });
  await location.fill(SITE_IN);
  await admin
    .getByRole('option', { name: new RegExp(SITE_IN) })
    .first()
    .click();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(admin.getByText(`Invitation sent to ${INVITEE}.`).first()).toBeVisible();

  // the role assignment is stored with the scope
  const users = await api<{
    data: Array<{ email: string; role_assignments: Array<Record<string, unknown>> }>;
  }>(admin, 'GET', `/v1/users?q=${encodeURIComponent(INVITEE)}`);
  const invited = users.json.data.find((u) => u.email === INVITEE)!;
  expect(invited.role_assignments).toEqual([expect.objectContaining({ scope_type: 'location' })]);

  // the technician accepts the mailed invitation and is signed in
  const mail = await waitForMail(INVITEE);
  const token = decodeURIComponent(/token=([^\s&>"')\]]+)/.exec(mail.Text)![1]!);
  const tech = await (await browser.newContext()).newPage();
  try {
    await tech.goto('/login');
    const accepted = await tech.evaluate(
      async ({ token, name }) => {
        const res = await fetch('/v1/auth/invitations/accept', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, password: `Scoped-${name}-Passw0rd`, display_name: name }),
        });
        return res.status;
      },
      { token, name: `E2E Scoped ${id}` },
    );
    expect(accepted).toBe(200);

    await tech.goto('/assets');
    await expect(tech.getByTestId('scope-indicator')).toContainText(`Scoped to: ${SITE_IN}`);
    await tech.getByPlaceholder('Tag, serial or name').fill(ASSET);
    await expect(tech.getByTestId('assets-range')).toHaveText('Showing 1-1 of 1');
    await expect(tech.getByRole('link', { name: new RegExp(`${ASSET} in`) }).first()).toBeVisible();
    await expect(tech.getByText(`${ASSET} out`)).toHaveCount(0);

    // outside the scope is "not found", by id and by tag
    expect((await api(tech, 'GET', `/v1/assets/${outAssetId}`)).status).toBe(404);
    expect(
      (await api(tech, 'GET', `/v1/scan/resolve?code=${encodeURIComponent(outTag)}`)).status,
    ).toBe(404);
    expect((await api(tech, 'GET', `/v1/assets/${inAssetId}`)).status).toBe(200);
    await tech.goto(`/assets/view?id=${outAssetId}`);
    await expect(tech.getByTestId('asset-not-found')).toBeVisible();

    // the administrator still sees both sites' assets
    await admin.goto('/assets');
    await admin.getByPlaceholder('Tag, serial or name').fill(ASSET);
    await expect(admin.getByTestId('assets-range')).toHaveText('Showing 1-2 of 2');
  } finally {
    await tech.context().close();
  }
});
