import { ApiError } from '@assettracker/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { peopleApi, usersApi } from '@/lib/registry/api';
import { seedSession } from '@/test/render';
import { MOCK_ACCOUNTS } from './fixtures';

/**
 * The link mock endpoints follow docs/engineering/openapi.yaml and apps/api/src/people (ED-22):
 * one login per person, one person per login, the placeholder of a login is replaced (archived),
 * unlinking gives the login a new placeholder; Administrators only.
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
const code = (e: ApiError) => (e.body as { code?: string }).code;

const person = async (name: string) =>
  (await peopleApi.list({ q: name, archived: 'include' })).data.find(
    (p) => p.display_name === name,
  )!;
const user = async (name: string) =>
  (await usersApi.list({ q: name })).data.find((u) => u.display_name === name)!;

describe('mock link-user (owner)', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('links a person to a login, archiving the placeholder, and unlinks again with a new placeholder', async () => {
    const vera = await user('Vera Viewer');
    const placeholder = await person('Vera Viewer');
    expect(vera.person_id).toBe(placeholder.id);
    const jamie = await person('Jamie Okafor');

    const linked = await peopleApi.linkUser(jamie.id, vera.id);
    expect(linked.value).toMatchObject({ id: jamie.id, user_id: vera.id });
    expect((await usersApi.get(vera.id)).value.person_id).toBe(jamie.id);
    const old = (await peopleApi.get(placeholder.id)).value;
    expect(old.archived_at).toBeTruthy();
    expect(old.user_id).toBeNull();
    // linking the same pair again changes nothing
    expect((await peopleApi.linkUser(jamie.id, vera.id)).value.user_id).toBe(vera.id);

    const unlinked = await peopleApi.unlinkUser(jamie.id);
    expect(unlinked.value.user_id).toBeNull();
    const now = (await usersApi.get(vera.id)).value.person_id;
    expect(now).toBeTruthy();
    expect(now).not.toBe(jamie.id);
    expect(now).not.toBe(placeholder.id);
    expect(code(await fails(peopleApi.unlinkUser(jamie.id)))).toBe('conflict');
  });

  it('answers the documented 409s and 422s', async () => {
    const vera = await user('Vera Viewer');
    const alice = await user('Alice Owner');
    const jamie = await person('Jamie Okafor');
    const maria = await person('Maria Reyes');
    await peopleApi.linkUser(jamie.id, vera.id);

    // the person has a login
    expect(code(await fails(peopleApi.linkUser(jamie.id, alice.id)))).toBe('person-already-linked');
    // the login has a person somebody chose
    expect(code(await fails(peopleApi.linkUser(maria.id, vera.id)))).toBe('login-already-linked');
    // unknown account / person
    const unknown = await fails(
      peopleApi.linkUser(maria.id, '0190a6b2-0000-7000-8000-00000000ffff'),
    );
    expect(unknown.status).toBe(422);
    expect(
      (await fails(peopleApi.linkUser('0190a6b2-0011-7000-8000-000000009999', vera.id))).status,
    ).toBe(404);
    // a stale ETag
    const stale = await fails(
      peopleApi.linkUser(maria.id, (await user('Marco Secure')).id, 'W/"99"'),
    );
    expect(stale.status).toBe(412);
  });
});

describe('mock link-user (not an Administrator)', () => {
  it('is refused with 403', async () => {
    seedSession(MOCK_ACCOUNTS.manager);
    const jamie = await person('Jamie Okafor');
    expect((await fails(peopleApi.linkUser(jamie.id, jamie.id))).status).toBe(403);
    expect((await fails(peopleApi.unlinkUser(jamie.id))).status).toBe(403);
  });
});
