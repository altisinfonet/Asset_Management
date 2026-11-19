import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVED_VIEWS_KEY, defaultViewState } from '@/lib/registry/asset-view';
import {
  MIGRATED_KEY,
  degradeState,
  applyWarnings,
  fromDefinition,
  migrateLocalViews,
  pendingLocalViews,
  toDefinition,
  type ViewReferences,
} from './convert';

const refs = (extra: Partial<ViewReferences> = {}): ViewReferences => ({
  statusIds: new Set(['s1']),
  categoryIds: new Set(['c1']),
  locationIds: new Set(['l1']),
  fieldKeys: new Set(['screen_size']),
  ready: true,
  ...extra,
});

describe('saved view definitions', () => {
  it('round-trips the list state through the server shape', () => {
    const state = {
      ...defaultViewState(),
      q: 'lap',
      category_id: 'c1',
      sort: '-name',
      columns: ['tag', 'cf:screen_size'],
      cf: { key: 'screen_size', value: '14' },
    };
    const definition = toDefinition(state);
    expect(definition.sort).toBe('-name');
    expect(definition.columns).toEqual(['tag', 'cf:screen_size']);
    expect(definition.filters).toMatchObject({ q: 'lap', category_id: 'c1' });
    expect(definition.filters).not.toHaveProperty('columns');
    expect(fromDefinition(definition)).toEqual(state);
  });

  it('stores a missing sort as null and reads a malformed definition as the defaults', () => {
    expect(toDefinition(defaultViewState()).sort).toBeNull();
    expect(
      fromDefinition({ filters: { archived: 'evil', sort: 5 }, columns: ['<x>'], sort: null }),
    ).toEqual(defaultViewState());
  });
});

describe('a view that refers to things that no longer exist', () => {
  const state = {
    ...defaultViewState(),
    status_id: 'gone',
    category_id: 'c1',
    location_id: 'gone',
    cf: { key: 'old_field', value: 'x' },
    columns: ['tag', 'cf:old_field', 'cf:screen_size'],
  };

  it('drops the missing parts and says which', () => {
    const { state: next, dropped } = degradeState(state, refs());
    expect(next).toMatchObject({ status_id: '', category_id: 'c1', location_id: '', cf: null });
    expect(next.columns).toEqual(['tag', 'cf:screen_size']);
    expect(dropped.sort()).toEqual(['column', 'field', 'location', 'status']);
  });

  it('leaves a healthy view alone and falls back to default columns if none remain', () => {
    const healthy = { ...defaultViewState(), status_id: 's1' };
    expect(degradeState(healthy, refs())).toEqual({ state: healthy, dropped: [] });
    const onlyGone = { ...defaultViewState(), columns: ['cf:old_field'] };
    expect(degradeState(onlyGone, refs()).state.columns).toEqual(defaultViewState().columns);
  });

  it('judges nothing before the catalogue has loaded, nor against an empty list', () => {
    expect(degradeState(state, refs({ ready: false })).dropped).toEqual([]);
    // a location list that is empty because the API does not serve it is not "everything deleted"
    expect(degradeState(state, refs({ locationIds: new Set() })).dropped).not.toContain('location');
  });
});

describe('the warnings of the server', () => {
  const state = {
    ...defaultViewState(),
    status_id: 'gone',
    category_id: 'c1',
    location_id: 'archived-one',
    person_id: 'p1',
    person_name: 'Ada',
  };

  it('clears the filters whose reference no longer resolves and says which', () => {
    const { state: next, dropped } = applyWarnings(state, [
      { field: 'status_id', id: 'gone', reason: 'not-found' },
      { field: 'location_id', id: 'archived-one', reason: 'archived' },
      { field: 'assigned_person_id', id: 'other', reason: 'not-found' },
      { field: 'person_id', id: 'p1', reason: 'not-found' },
      { field: 'vendor_id', id: 'v', reason: 'not-found' },
    ]);
    expect(next).toMatchObject({
      status_id: '',
      category_id: 'c1',
      location_id: '',
      person_id: '',
      person_name: '',
    });
    expect(dropped.sort()).toEqual(['location', 'person', 'status']);
  });

  it('leaves a view without warnings alone', () => {
    expect(applyWarnings(state, [])).toEqual({ state, dropped: [] });
  });
});

describe('moving the views kept in this browser', () => {
  beforeEach(() => window.localStorage.clear());

  const local = (names: string[]) =>
    window.localStorage.setItem(
      SAVED_VIEWS_KEY,
      JSON.stringify(names.map((name, i) => ({ id: `v${i}`, name, state: defaultViewState() }))),
    );

  it('creates each as a personal view, skips a name the user already has and then forgets them', async () => {
    local(['Laptops', 'Projectors', 'Mine']);
    const create = vi.fn().mockResolvedValue({});
    const result = await migrateLocalViews(
      pendingLocalViews(),
      [
        { name: 'laptops', is_owner: true },
        { name: 'Projectors', is_owner: false },
      ],
      create,
    );
    expect(result).toEqual({ moved: 2, skipped: 1, failed: 0 });
    expect(create.mock.calls.map(([view]) => view.name)).toEqual(['Projectors', 'Mine']);
    // the definition travels flat: filters, columns and sort
    expect(create.mock.calls[0]![0]).toMatchObject({
      filters: expect.any(Object),
      columns: expect.any(Array),
      sort: null,
    });
    expect(window.localStorage.getItem(SAVED_VIEWS_KEY)).toBeNull();
    expect(window.localStorage.getItem(MIGRATED_KEY)).toBeTruthy();
    expect(pendingLocalViews()).toEqual([]);
  });

  it('keeps the local views when one cannot be moved, so the next load tries again', async () => {
    local(['A', 'B']);
    const create = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('offline'));
    const result = await migrateLocalViews(pendingLocalViews(), [], create);
    expect(result).toEqual({ moved: 1, skipped: 0, failed: 1 });
    expect(window.localStorage.getItem(SAVED_VIEWS_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(MIGRATED_KEY)).toBeNull();
    expect(pendingLocalViews()).toHaveLength(2);
  });

  it('has nothing to move when there are no local views', () => {
    expect(pendingLocalViews()).toEqual([]);
  });
});
