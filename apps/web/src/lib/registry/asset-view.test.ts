import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMNS,
  SAVED_VIEWS_KEY,
  defaultViewState,
  hasActiveFilters,
  readSavedViews,
  sanitiseState,
  stateFromLink,
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

  it('the department filter goes to the API, counts as active and opens from a link', () => {
    const state = { ...defaultViewState(), department_id: 'd1' };
    expect(toAssetQuery(state).department_id).toBe('d1');
    expect(toAssetQuery(defaultViewState()).department_id).toBeUndefined();
    expect(hasActiveFilters(state)).toBe(true);
    expect(stateFromLink(new URLSearchParams('department=d9')).department_id).toBe('d9');
    expect(sanitiseState({ department_id: 'd2' }).department_id).toBe('d2');
    expect(sanitiseState({ department_id: 7 }).department_id).toBe('');
  });

  it('custody filters count as active filters', () => {
    expect(hasActiveFilters({ ...defaultViewState(), assigned: 'no' })).toBe(true);
    expect(hasActiveFilters({ ...defaultViewState(), person_id: 'p' })).toBe(true);
  });

  it('sends the state type and overdue filters the dashboard tiles link to', () => {
    const query = toAssetQuery({
      ...defaultViewState(),
      state_type: 'undeployable',
      overdue: true,
    });
    expect(query).toMatchObject({ state_type: ['undeployable'], overdue: true });
    expect(toAssetQuery(defaultViewState())).not.toHaveProperty('overdue');
    expect(toAssetQuery(defaultViewState())).not.toHaveProperty('state_type');
    expect(hasActiveFilters({ ...defaultViewState(), state_type: 'deployable' })).toBe(true);
    expect(hasActiveFilters({ ...defaultViewState(), overdue: true })).toBe(true);
  });

  it('reads the dashboard deep links and ignores a made-up state type', () => {
    expect(stateFromLink(new URLSearchParams('state_type=deployable'))).toMatchObject({
      state_type: 'deployable',
      assigned: '',
      overdue: false,
    });
    expect(stateFromLink(new URLSearchParams('assigned=yes'))).toMatchObject({ assigned: 'yes' });
    expect(stateFromLink(new URLSearchParams('overdue=1'))).toMatchObject({ overdue: true });
    expect(stateFromLink(new URLSearchParams('state_type=nope&assigned=maybe'))).toEqual(
      defaultViewState(),
    );
    expect(sanitiseState({ state_type: 'lost', overdue: true })).toMatchObject({
      state_type: 'lost',
      overdue: true,
    });
    expect(sanitiseState({ state_type: 'nope', overdue: 'yes' })).toMatchObject({
      state_type: '',
      overdue: false,
    });
  });

  it('a custom field filter without a value is not sent', () => {
    const query = toAssetQuery({ ...defaultViewState(), cf: { key: 'x', value: '' } });
    expect(query.cf).toBeUndefined();
  });
});

describe('views kept in this browser by the earlier version', () => {
  beforeEach(() => window.localStorage.clear());

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
