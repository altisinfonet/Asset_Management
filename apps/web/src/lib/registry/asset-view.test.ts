import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMNS,
  SAVED_VIEWS_KEY,
  defaultViewState,
  deleteView,
  hasActiveFilters,
  readSavedViews,
  sanitiseState,
  saveView,
  toAssetQuery,
} from './asset-view';

describe('assets list state', () => {
  it('the default view has no filters and the default columns', () => {
    const state = defaultViewState();
    expect(hasActiveFilters(state)).toBe(false);
    expect(state.columns).toEqual(DEFAULT_COLUMNS);
    expect(toAssetQuery(state)).toMatchObject({
      limit: 50,
      include_total: true,
      archived: 'exclude',
    });
  });

  it('turns filters, sort and cursor into the API query', () => {
    const state = {
      ...defaultViewState(),
      q: ' lap ',
      status_id: 's1',
      category_id: 'c1',
      location_id: 'l1',
      archived: 'only' as const,
      cf: { key: 'screen_size', value: '14' },
      sort: '-asset_tag',
    };
    expect(hasActiveFilters(state)).toBe(true);
    expect(toAssetQuery(state, 'cur')).toMatchObject({
      cursor: 'cur',
      q: 'lap',
      status_id: ['s1'],
      category_id: ['c1'],
      location_id: 'l1',
      include_sublocations: true,
      archived: 'only',
      cf: { screen_size: '14' },
      sort: ['-asset_tag'],
    });
  });

  it('sends the custody filters and the sublocations switch', () => {
    const query = toAssetQuery({
      ...defaultViewState(),
      location_id: 'l1',
      include_sublocations: false,
      assigned: 'yes',
      person_id: 'p1',
      person_name: 'Maria Reyes',
    });
    expect(query).toMatchObject({
      location_id: 'l1',
      include_sublocations: false,
      assigned: true,
      assigned_person_id: 'p1',
    });
    expect(toAssetQuery({ ...defaultViewState(), assigned: 'no' }).assigned).toBe(false);
    expect(toAssetQuery(defaultViewState()).assigned).toBeUndefined();
  });

  it('custody filters count as active filters', () => {
    expect(hasActiveFilters({ ...defaultViewState(), assigned: 'no' })).toBe(true);
    expect(hasActiveFilters({ ...defaultViewState(), person_id: 'p' })).toBe(true);
  });

  it('a custom field filter without a value is not sent', () => {
    const query = toAssetQuery({ ...defaultViewState(), cf: { key: 'x', value: '' } });
    expect(query.cf).toBeUndefined();
  });
});

describe('saved views (this browser only)', () => {
  beforeEach(() => window.localStorage.clear());

  it('saves, lists, replaces by name and deletes', () => {
    const state = { ...defaultViewState(), category_id: 'c1', columns: ['tag', 'serial'] };
    const saved = saveView('Laptops', state);
    expect(saved).toHaveLength(1);
    expect(readSavedViews()[0]).toMatchObject({ name: 'Laptops', state: { category_id: 'c1' } });

    saveView('laptops', { ...state, category_id: 'c2' }); // same name, any case
    expect(readSavedViews()).toHaveLength(1);
    expect(readSavedViews()[0]!.state.category_id).toBe('c2');

    saveView('Other', defaultViewState());
    expect(readSavedViews().map((v) => v.name)).toEqual(['Other', 'laptops']);
    expect(deleteView(readSavedViews()[0]!.id)).toHaveLength(1);
  });

  it('ignores a tampered or outdated stored value instead of crashing', () => {
    window.localStorage.setItem(SAVED_VIEWS_KEY, '{not json');
    expect(readSavedViews()).toEqual([]);
    window.localStorage.setItem(
      SAVED_VIEWS_KEY,
      JSON.stringify([
        { id: 1, name: 'bad id' },
        {
          id: 'v1',
          name: 'ok',
          state: { archived: 'evil', sort: '"; drop', columns: ['<script>'], status_id: 5 },
        },
      ]),
    );
    const views = readSavedViews();
    expect(views).toHaveLength(1);
    expect(views[0]!.state).toEqual(defaultViewState());
  });

  it('sanitiseState defaults the custody filters of a view saved before they existed', () => {
    const state = sanitiseState({ q: 'x', assigned: 'maybe', include_sublocations: 'no' });
    expect(state).toMatchObject({ assigned: '', person_id: '', include_sublocations: true });
    expect(sanitiseState({ assigned: 'yes', include_sublocations: false }).assigned).toBe('yes');
    expect(sanitiseState({ include_sublocations: false }).include_sublocations).toBe(false);
  });

  it('sanitiseState keeps well-formed values', () => {
    expect(
      sanitiseState({
        q: 'x',
        archived: 'include',
        sort: 'name',
        columns: ['tag', 'cf:screen_size'],
      }),
    ).toMatchObject({
      q: 'x',
      archived: 'include',
      sort: 'name',
      columns: ['tag', 'cf:screen_size'],
    });
  });
});
