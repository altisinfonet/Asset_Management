import { ApiError } from '@assettracker/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { getApi } from '@/lib/api';
import { assetsApi, locationsApi, peopleApi, usersApi } from '@/lib/registry/api';
import { seedSession } from '@/test/render';
import { MOCK_ACCOUNTS } from './fixtures';
import { roleIdFor, uid } from './registry-fixtures';
import { registry } from './registry-state';

/**
 * Location scoping of role assignments (M2-LOC-03, ED-26) in the mock, as apps/api does it: the
 * assignments are stored and returned with `scope_type` / `location_id`, a bad location is a 422 at
 * `/role_assignments/<n>/location_id`, `/v1/auth/me` carries `location_scope`, and a scoped principal
 * sees only its subtree and loses the org-only permissions.
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
const errorsOf = (e: ApiError) =>
  (e.body as { errors?: Array<{ pointer: string; code?: string }> }).errors ?? [];

const ROOM_101 = uid('location', 3);
const ROOM_204 = uid('location', 4);
const MAIN_BUILDING = uid('location', 2);

describe('mock role assignments with a location scope (admin)', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('stores and returns scope_type and location_id; keeps the id of an unchanged assignment', async () => {
    const created = await usersApi.invite({
      email: 'scoped.new@example.org',
      display_name: 'Scoped New',
      role_assignments: [
        { role_id: roleIdFor('technician'), scope_type: 'location', location_id: ROOM_204 },
      ],
    });
    expect(created.role_assignments).toEqual([
      {
        id: expect.any(String),
        role_id: roleIdFor('technician'),
        scope_type: 'location',
        company_id: null,
        location_id: ROOM_204,
      },
    ]);
    const kept = await usersApi.update(created.id, {
      role_assignments: [
        { role_id: roleIdFor('technician'), scope_type: 'location', location_id: ROOM_204 },
        { role_id: roleIdFor('viewer'), scope_type: 'tenant' },
      ],
    });
    expect(kept.role_assignments[0]!.id).toBe(created.role_assignments[0]!.id);
    expect(kept.role_assignments[1]).toMatchObject({
      scope_type: 'tenant',
      location_id: null,
      company_id: null,
    });
  });

  it('a missing or unknown location is a 422 at /role_assignments/<n>/location_id', async () => {
    const priya = (await usersApi.list({ q: 'priya' })).data[0]!;
    const unknown = await fails(
      usersApi.update(priya.id, {
        role_assignments: [
          { role_id: roleIdFor('viewer'), scope_type: 'tenant' },
          {
            role_id: roleIdFor('technician'),
            scope_type: 'location',
            location_id: uid('location', 999),
          },
        ],
      }),
    );
    expect(unknown.status).toBe(422);
    expect(errorsOf(unknown)).toEqual([
      expect.objectContaining({ pointer: '/role_assignments/1/location_id', code: 'not-found' }),
    ]);
    const absent = await fails(
      usersApi.invite({
        email: 'nowhere@example.org',
        display_name: 'Nowhere',
        role_assignments: [{ role_id: roleIdFor('technician'), scope_type: 'location' }],
      }),
    );
    expect(errorsOf(absent)).toEqual([
      expect.objectContaining({ pointer: '/role_assignments/0/location_id', code: 'invalid' }),
    ]);
  });

  it('/v1/auth/me of an org-wide administrator has location_scope null', async () => {
    const me = (await getApi().http.GET('/v1/auth/me')).data!;
    expect(me.location_scope).toBeNull();
    expect(me.permissions).toContain('*');
  });
});

describe('mock scoped technician (Room 101)', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.scopedTechnician));

  it('/v1/auth/me names the scope with its path and drops the org-only permissions', async () => {
    const me = (await getApi().http.GET('/v1/auth/me')).data!;
    expect(me.location_scope).toEqual({
      locations: [
        { id: ROOM_101, name: 'Room 101', path: 'Riverside Elementary / Main building / Room 101' },
      ],
    });
    expect(me.permissions).toContain('asset:checkout');
    expect(me.permissions).not.toContain('user:read');
    expect(me.permissions).not.toContain('role:read');
  });

  it('lists only the locations, assets and people inside the subtree; others are 404', async () => {
    const locations = (await locationsApi.list({ limit: 200 })).data;
    expect(locations.map((l) => l.id)).toEqual([ROOM_101]);
    expect((await fails(locationsApi.get(MAIN_BUILDING))).status).toBe(404);

    const assets = (await assetsApi.list({ limit: 200 })).data;
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((a) => a.location_id === ROOM_101)).toBe(true);
    const elsewhere = registry().assets.find((a) => a.location_id && a.location_id !== ROOM_101)!;
    expect((await fails(assetsApi.get(elsewhere.id))).status).toBe(404);

    const people = (await peopleApi.list({ limit: 200 })).data;
    expect(people.length).toBeGreaterThan(0);
    expect(people.every((p) => p.location_id === ROOM_101)).toBe(true);
    expect((await fails(usersApi.list())).status).toBe(403);
  });
});

describe('mock scoped writes (location administrator)', () => {
  // Lara Local: an Administrator limited to Main building
  beforeEach(() => seedSession(MOCK_ACCOUNTS.scopedAdmin));

  it('a scoped Administrator holds no org-only permission and must give writes a location', async () => {
    const me = (await getApi().http.GET('/v1/auth/me')).data!;
    expect(me.permissions).not.toContain('*');
    expect(me.permissions).not.toContain('user:manage');
    expect(me.permissions).not.toContain('notification:manage');
    expect(me.permissions).toContain('location:manage');

    const topLevel = await fails(locationsApi.create({ name: 'Annex', kind: 'building' }));
    expect(errorsOf(topLevel)).toEqual([
      expect.objectContaining({ pointer: '/parent_id', code: 'required' }),
    ]);
    const nowhere = await fails(peopleApi.create({ display_name: 'No Home' }));
    expect(errorsOf(nowhere)).toEqual([
      expect.objectContaining({ pointer: '/location_id', code: 'required' }),
    ]);
    const inside = await locationsApi.create({
      name: 'Annex room',
      kind: 'room',
      parent_id: MAIN_BUILDING,
    });
    expect(inside.value.parent_id).toBe(MAIN_BUILDING);
  });
});
