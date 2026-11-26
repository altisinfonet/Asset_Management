import { describe, expect, it } from 'vitest';
import {
  disposeBody,
  lifecycleActions,
  markFoundBody,
  markLostBody,
  statusChoices,
  statusHintKind,
} from './lifecycle';
import type { StatusLabel } from './types';

const all = () => true;
const asset = (stateType: string, archived = false) => ({
  archived_at: archived ? '2026-11-20T00:00:00Z' : null,
  status: { id: 's', name: stateType, state_type: stateType },
});

describe('lifecycleActions', () => {
  it('offers mark lost and dispose on ready, deployed, pending and in-repair assets', () => {
    for (const type of ['deployable', 'deployed', 'pending', 'undeployable', 'archived']) {
      expect(lifecycleActions(asset(type), all)).toEqual(['mark_lost', 'dispose']);
    }
  });

  it('offers mark found (not mark lost) on a lost asset, and nothing on an archived one', () => {
    expect(lifecycleActions(asset('lost'), all)).toEqual(['mark_found', 'dispose']);
    expect(lifecycleActions(asset('lost', true), all)).toEqual([]);
    expect(lifecycleActions(asset('deployable', true), all)).toEqual([]);
  });

  it('filters by permission: lost and found need asset:update, dispose asset:delete', () => {
    const updateOnly = (p: string) => p === 'asset:update';
    expect(lifecycleActions(asset('deployable'), updateOnly)).toEqual(['mark_lost']);
    expect(lifecycleActions(asset('lost'), (p) => p === 'asset:delete')).toEqual(['dispose']);
    expect(lifecycleActions(asset('deployable'), () => false)).toEqual([]);
  });
});

describe('statusChoices', () => {
  const label = (id: string, state_type: string, position: number, archived = false) =>
    ({
      id,
      name: id,
      state_type,
      position,
      archived_at: archived ? '2026-01-01T00:00:00Z' : null,
    }) as unknown as StatusLabel;
  it('lists the live labels of one state type in catalogue order', () => {
    const list = [
      label('Stolen', 'lost', 2),
      label('Missing', 'lost', 1),
      label('Old lost', 'lost', 0, true),
      label('Ready', 'deployable', 0),
    ];
    expect(statusChoices(list, 'lost')).toEqual([
      { value: 'Missing', label: 'Missing' },
      { value: 'Stolen', label: 'Stolen' },
    ]);
  });
});

describe('request bodies', () => {
  it('mark lost: the note when typed, the status only when the user could choose', () => {
    expect(markLostBody({ note: '  ', status_id: 's1' }, false)).toEqual({});
    expect(markLostBody({ note: ' Left on the bus ', status_id: 's1' }, true)).toEqual({
      note: 'Left on the bus',
      status_id: 's1',
    });
  });

  it('mark found: the location only when it changed, null when cleared', () => {
    expect(markFoundBody({ location_id: 'loc-1', note: '' }, 'loc-1', false)).toEqual({});
    expect(markFoundBody({ location_id: 'loc-2', note: 'In the gym' }, 'loc-1', false)).toEqual({
      location_id: 'loc-2',
      note: 'In the gym',
    });
    expect(markFoundBody({ location_id: '' }, 'loc-1', true)).toEqual({ location_id: null });
    expect(markFoundBody({ location_id: '', status_id: 's2' }, null, true)).toEqual({
      status_id: 's2',
    });
  });

  it('dispose: reason, date, note and the status when chosen', () => {
    expect(
      disposeBody(
        { reason: 'recycled', disposed_on: '2026-11-20', note: ' R-2210 ', status_id: 'x' },
        false,
      ),
    ).toEqual({ reason: 'recycled', disposed_on: '2026-11-20', note: 'R-2210' });
    expect(disposeBody({ reason: 'sold', disposed_on: '', status_id: 'x' }, true)).toEqual({
      reason: 'sold',
      status_id: 'x',
    });
  });
});

describe('statusHintKind', () => {
  it('flags lost and archived status types only', () => {
    expect(statusHintKind('lost')).toBe('lost');
    expect(statusHintKind('archived')).toBe('archived');
    expect(statusHintKind('undeployable')).toBeNull();
    expect(statusHintKind(undefined)).toBeNull();
  });
});
