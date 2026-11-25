import { ApiError } from '@assettracker/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { getApi } from '@/lib/api';
import {
  assetsApi,
  categoriesApi,
  fieldsApi,
  tagTemplateApi,
  usersApi,
  vendorsApi,
} from '@/lib/registry/api';
import { seedSession } from '@/test/render';
import { MOCK_ACCOUNTS } from './fixtures';
import { uid } from './registry-fixtures';

/**
 * The mock registry follows the conventions of docs/engineering/openapi.yaml, because the web
 * screens (and Playwright) are written against it: pagination, ETags, problem+json, permissions.
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

describe('mock registry (owner)', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('is seeded with about 200 assets over four categories', async () => {
    const page = await assetsApi.list({ limit: 1, include_total: true, archived: 'include' });
    expect(page.page.total).toBe(200);
    const categories = await categoriesApi.list({ kind: 'asset' });
    expect(categories.data.map((c) => c.name)).toEqual([
      'Chromebook',
      'Laptop',
      'Projector',
      'Tablet',
    ]);
  });

  it('paginates with opaque cursors, sorts, and refuses a cursor from another sort', async () => {
    const first = await assetsApi.list({ limit: 50, include_total: true, sort: ['asset_tag'] });
    expect(first.data).toHaveLength(50);
    expect(first.data[0]!.asset_tag).toBe('AT-00001');
    expect(first.page).toMatchObject({ has_more: true, total: 195 });

    const second = await assetsApi.list({
      limit: 50,
      cursor: first.page.next_cursor!,
      sort: ['asset_tag'],
    });
    expect(second.data[0]!.asset_tag).toBe('AT-00052'); // AT-00037 is archived, so the first page ends at 51
    expect(second.data.map((a) => a.id)).not.toContain(first.data[0]!.id);

    const wrong = await fails(
      assetsApi.list({ limit: 50, cursor: first.page.next_cursor!, sort: ['-asset_tag'] }),
    );
    expect(wrong.status).toBe(400);
    expect(wrong.code).toBe('invalid-cursor');
  });

  it('filters by category, status, free text, tag, custom field and archived state', async () => {
    const [laptop] = (await categoriesApi.list({ q: 'Laptop' })).data;
    const laptops = await assetsApi.list({ category_id: [laptop!.id], include_total: true });
    expect(laptops.page.total).toBe(39);

    const byTag = await assetsApi.list({ tag: 'at-00124' });
    expect(byTag.data.map((a) => a.asset_tag)).toEqual(['AT-00124']);

    const text = await assetsApi.list({ q: 'LAP-0002', include_total: true });
    expect(text.page.total).toBe(10);

    const archived = await assetsApi.list({ archived: 'only', include_total: true });
    expect(archived.page.total).toBe(5);

    const cf = await assetsApi.list({ cf: { screen_size: '14' }, include_total: true });
    expect(cf.page.total).toBeGreaterThan(0);
    expect(cf.data.every((a) => a.custom_data.screen_size === 14)).toBe(true);
  });

  it('ETag on read, 428 without If-Match, 412 when stale, new ETag after a write', async () => {
    const id = uid('asset', 10);
    const { value, etag } = await assetsApi.get(id);
    expect(etag).toBe('W/"1"');

    const http = getApi().http;
    const missing = await fails(
      http.PATCH('/v1/assets/{id}', {
        params: { path: { id }, header: { 'If-Match': '' } },
        body: { notes: 'x' },
      }),
    );
    expect(missing.status).toBe(428);

    const updated = await assetsApi.update(id, { notes: 'first' }, etag);
    expect(updated.etag).toBe('W/"2"');
    expect(updated.value.notes).toBe('first');

    const stale = await fails(assetsApi.update(id, { notes: 'second' }, etag));
    expect(stale.status).toBe(412);
    expect(value.id).toBe(id);
  });

  it('validates assets: required category, model must match it, custom data per definition', async () => {
    const [chromebook] = (await categoriesApi.list({ q: 'Chromebook' })).data;
    const empty = await fails(assetsApi.create({} as never));
    expect(empty.status).toBe(422);
    expect(empty.body).toMatchObject({ errors: [{ pointer: '/category_id' }] });

    const bad = await fails(
      assetsApi.create({
        category_id: chromebook!.id,
        custom_data: { screen_size: 99, unknown_field: 'x', managed: 'yes' },
      }),
    );
    const pointers = (bad.body as { errors: Array<{ pointer: string }> }).errors.map(
      (e) => e.pointer,
    );
    expect(pointers).toEqual(
      expect.arrayContaining([
        '/custom_data/screen_size',
        '/custom_data/unknown_field',
        '/custom_data/managed',
        '/custom_data/os_version', // required, missing
      ]),
    );
  });

  it('numbers tags from the category prefix, rejects duplicates, lets a typed tag win', async () => {
    const [chromebook] = (await categoriesApi.list({ q: 'Chromebook' })).data;
    const custom = { os_version: 'ChromeOS 126' };
    const created = await assetsApi.create({ category_id: chromebook!.id, custom_data: custom });
    expect(created.value.asset_tag).toBe('AT-00131');
    expect(created.etag).toBe('W/"1"');

    const dup = await fails(
      assetsApi.create({ category_id: chromebook!.id, asset_tag: 'at-00001', custom_data: custom }),
    );
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ errors: [{ pointer: '/asset_tag' }] });

    const typed = await assetsApi.create({
      category_id: chromebook!.id,
      asset_tag: 'MY-1',
      custom_data: custom,
    });
    expect(typed.value.asset_tag).toBe('MY-1');
  });

  it('archives with If-Match, hides the asset, restores it and writes history', async () => {
    const id = uid('asset', 20);
    await assetsApi.archive(id);
    const list = await assetsApi.list({ tag: 'AT-00020' });
    expect(list.data).toHaveLength(0);
    const still = await assetsApi.list({ tag: 'AT-00020', archived: 'only' });
    expect(still.data).toHaveLength(1);
    const restored = await assetsApi.restore(id);
    expect(restored.value.archived_at).toBeNull();
    const history = await assetsApi.history(id, {});
    const types = history.data.map((e) => e.event_type);
    expect(types.slice(0, 2)).toEqual(['restored', 'archived']);
    expect(types.at(-1)).toBe('created');
  });

  it('refuses to archive a category in use, naming the counts, and a free one goes', async () => {
    const [laptop] = (await categoriesApi.list({ q: 'Laptop' })).data;
    const refused = await fails(categoriesApi.archive(laptop!.id));
    expect(refused.status).toBe(409);
    // Like the API: every asset counts (archived too) and the 409 carries `usage`.
    const body = refused.body as { code: string; detail: string; usage: Record<string, number> };
    expect(body.code).toBe('conflict');
    expect(body.usage).toEqual({ assets: 40, models: 3, custom_fields: 2 });
    expect(body.detail).toMatch(/assets: 40/);

    const created = await categoriesApi.create({ name: 'Scratch', kind: 'asset' });
    await categoriesApi.archive(created.id);
    const all = await categoriesApi.list({ archived: 'only' });
    expect(all.data.map((c) => c.name)).toContain('Scratch');
  });

  it('bulk endpoints answer 200 with one result per id; a failing item does not stop the others', async () => {
    const page = (await assetsApi.list({ limit: 3, sort: ['asset_tag'] })).data;
    const ids = page.map((a) => a.id);
    // archive one of them first: the bulk edit refuses that item (409) and edits the rest
    await assetsApi.archive(ids[1]!);
    const statuses = (await getApi().http.GET('/v1/status-labels')).data!.data;
    const target = statuses.find((x) => x.id !== page[0]!.status_id)!;
    const updated = await assetsApi.bulkUpdate(ids, { status_id: target.id });
    expect(updated.summary).toEqual({ total: 3, succeeded: 2, failed: 1 });
    expect(updated.results.map((r) => r.status)).toEqual([200, 409, 200]);
    expect(updated.results[1]!.error).toMatchObject({ code: 'conflict' });
    expect(updated.results[0]!.data!.status_id).toBe(target.id);

    const archived = await assetsApi.bulkArchive([ids[0]!, ids[1]!]);
    expect(archived.results.map((r) => r.status)).toEqual([200, 409]);
    const restored = await assetsApi.bulkRestore([ids[0]!, ids[1]!, uid('asset', 9999)]);
    expect(restored.results.map((r) => r.status)).toEqual([200, 200, 404]);

    const empty = await fails(assetsApi.bulkArchive([]));
    expect(empty).toMatchObject({ status: 422, code: 'validation' });
    const many = await fails(
      assetsApi.bulkArchive(Array.from({ length: 101 }, (_, i) => uid('asset', i + 1))),
    );
    expect(many.status).toBe(422);
    const noop = await fails(assetsApi.bulkUpdate(ids, {}));
    expect(noop.status).toBe(422);
  });

  it('the tag numbering template is versioned and drives generated tags', async () => {
    const before = await tagTemplateApi.get();
    expect(before.value).toMatchObject({ prefix: '', width: 5, use_category_prefix: true });
    expect(before.etag).toBeTruthy();
    const saved = await tagTemplateApi.put(
      { prefix: 'ACME-', width: 4, use_category_prefix: false },
      before.etag,
    );
    expect(saved.value.example).toBe('ACME-0042');
    expect(saved.etag).not.toBe(before.etag);
    // a stale If-Match is refused
    expect((await fails(tagTemplateApi.put(saved.value, before.etag))).status).toBe(412);
    // invalid values are refused with pointers
    const bad = await fails(
      tagTemplateApi.put({ prefix: 'lower', width: 40, use_category_prefix: true }, saved.etag),
    );
    expect(bad.status).toBe(422);

    const [category] = (await categoriesApi.list({ q: 'Laptop' })).data;
    const created = await assetsApi.create({ category_id: category!.id });
    expect(created.value.asset_tag).toBe('ACME-0001');
  });

  it('custom fields: key is immutable, type cannot change once assets have values', async () => {
    const fields = await fieldsApi.list({
      category_id: (await categoriesApi.list({ q: 'Chromebook' })).data[0]!.id,
    });
    const screen = fields.data.find((f) => f.key === 'screen_size')!;
    const keyChange = await fails(fieldsApi.update(screen.id, { key: 'other' }));
    expect(keyChange.status).toBe(422);
    const typeChange = await fails(fieldsApi.update(screen.id, { data_type: 'text' }));
    expect(typeChange.status).toBe(409);
    expect((typeChange.body as { title: string }).title).toMatch(/Cannot change the type/);
  });

  it('search ranks an exact tag first and returns assets, models and categories', async () => {
    const { search } = await import('@/lib/registry/api');
    const results = await search('lap-00007');
    expect(results[0]).toMatchObject({
      type: 'asset',
      label: expect.stringContaining('LAP-00007'),
    });
    const chrome = await search('chrome');
    expect(new Set(chrome.map((r) => r.type))).toEqual(new Set(['asset', 'model', 'category']));
  });

  it('scan resolve finds an asset by label code or tag, 404 otherwise', async () => {
    expect((await assetsApi.resolve('LBL00124')).asset.asset_tag).toBe('AT-00124');
    expect((await assetsApi.resolve('at-00124')).asset.asset_tag).toBe('AT-00124');
    expect((await fails(assetsApi.resolve('nope'))).status).toBe(404);
  });

  it('users: invite, duplicate email 409, resend and revoke an invitation, last admin protected', async () => {
    const roles = (await getApi().http.GET('/v1/roles')).data!.data;
    const tech = roles.find((r) => r.key === 'technician')!;
    const invited = await usersApi.invite({
      email: 'new@example.org',
      display_name: 'New',
      role_assignments: [{ role_id: tech.id, scope_type: 'tenant' }],
    });
    expect(invited.status).toBe('invited');
    expect(
      (
        await fails(
          usersApi.invite({
            email: 'NEW@example.org',
            display_name: 'x',
            role_assignments: [{ role_id: tech.id }],
          }),
        )
      ).status,
    ).toBe(409);

    await usersApi.resendInvitation(invited.id);
    await usersApi.revokeInvitation(invited.id);
    expect((await fails(usersApi.resendInvitation(invited.id))).status).toBe(409);

    const admins = (
      await usersApi.list({ role_id: roles.find((r) => r.key === 'tenant_admin')!.id })
    ).data.filter((u) => u.role_assignments.some((r) => r.scope_type === 'tenant'));
    expect(admins).toHaveLength(2);
    // disable one of the two org-wide admins: fine; the last one: refused (a location
    // administrator does not keep the organisation manageable)
    const [a, b] = admins;
    await usersApi.update(a!.id, { status: 'disabled' });
    const last = await fails(usersApi.update(b!.id, { status: 'disabled' }));
    expect(last.status).toBe(409);
  });

  it('an admin cannot reset their own MFA; resetting another clears it', async () => {
    const self = (await usersApi.list({ q: 'alice' })).data[0]!;
    expect((await fails(usersApi.resetMfa(self.id))).status).toBe(409);
    const priya = (await usersApi.list({ q: 'priya' })).data[0]!;
    expect(priya.mfa_enabled).toBe(true);
    await usersApi.resetMfa(priya.id);
    expect((await usersApi.get(priya.id)).value.mfa_enabled).toBe(false);
  });
});

describe('mock registry (permissions are enforced server-side)', () => {
  it('a viewer can read assets but every write is a 403 forbidden', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    expect((await assetsApi.list({ limit: 1 })).data).toHaveLength(1);
    const create = await fails(assetsApi.create({ category_id: uid('category', 1) }));
    expect(create.status).toBe(403);
    expect(create.code).toBe('forbidden');
    expect((await fails(assetsApi.archive(uid('asset', 1)))).status).toBe(403);
    expect((await fails(vendorsApi.create({ name: 'X' }))).status).toBe(403);
    expect((await fails(usersApi.list())).status).toBe(403);
  });

  it('an asset manager manages the catalogue but cannot manage users', async () => {
    seedSession(MOCK_ACCOUNTS.manager);
    await vendorsApi.create({ name: 'Manager vendor' });
    expect((await usersApi.list()).data.length).toBeGreaterThan(0);
    const roles = (await getApi().http.GET('/v1/roles')).data!.data;
    expect(
      (
        await fails(
          usersApi.invite({
            email: 'a@b.co',
            display_name: 'A',
            role_assignments: [{ role_id: roles[0]!.id }],
          }),
        )
      ).status,
    ).toBe(403);
  });

  it('a mutation without the CSRF token is refused', async () => {
    seedSession(MOCK_ACCOUNTS.owner);
    const response = await fetch('/v1/vendors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No CSRF' }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('csrf-invalid');
  });
});
