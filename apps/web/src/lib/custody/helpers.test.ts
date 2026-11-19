import { describe, expect, it } from 'vitest';
import type { Asset } from '@/lib/registry/types';
import {
  availableActions,
  createKeyKeeper,
  dateAfter,
  holderOf,
  CONDITIONS,
  isOverdue,
} from './helpers';

const everything = () => true;
const nothing = () => false;

function asset(extra: Partial<Asset> & { state?: string }): Asset {
  const { state = 'deployable', ...rest } = extra;
  return {
    id: 'a',
    asset_tag: 'AT-1',
    category_id: 'c',
    status_id: 's',
    custom_data: {},
    status: { id: 's', name: 'x', state_type: state },
    current_assignment: null,
    ...rest,
  } as Asset;
}

const held = {
  assignment_id: 'x',
  target_type: 'person' as const,
  target_id: 'p',
  target_name: 'Maria Reyes',
  checked_out_at: '2026-11-01T09:00:00Z',
  expected_return: '2026-11-10',
  overdue: true,
};

describe('availableActions', () => {
  it('a ready asset in stock can be checked out', () => {
    expect(availableActions(asset({}), everything)).toEqual(['checkout']);
  });

  it('a held asset can be checked in or transferred', () => {
    expect(
      availableActions(asset({ state: 'deployed', current_assignment: held }), everything),
    ).toEqual(['checkin', 'transfer']);
  });

  it('archived, pending, lost and in-repair assets offer nothing', () => {
    expect(availableActions(asset({ archived_at: '2026-01-01T00:00:00Z' }), everything)).toEqual(
      [],
    );
    for (const state of ['pending', 'lost', 'undeployable', 'archived']) {
      expect(availableActions(asset({ state }), everything)).toEqual([]);
    }
  });

  it('only offers what the role may do', () => {
    expect(availableActions(asset({}), nothing)).toEqual([]);
    const onlyIn = (p: string) => p === 'asset:checkin';
    expect(
      availableActions(asset({ state: 'deployed', current_assignment: held }), onlyIn),
    ).toEqual(['checkin']);
  });
});

describe('dates', () => {
  const now = new Date(2026, 10, 17, 15, 30); // 17 Nov 2026, local
  it('adds days and months to a local date', () => {
    expect(dateAfter({ days: 1 }, now)).toBe('2026-11-18');
    expect(dateAfter({ days: 7 }, now)).toBe('2026-11-24');
    expect(dateAfter({ months: 1 }, now)).toBe('2026-12-17');
    expect(dateAfter({ days: 20 }, now)).toBe('2026-12-07');
  });

  it('overdue is the server flag, never derived from the date here', () => {
    expect(isOverdue({ overdue: true })).toBe(true);
    expect(isOverdue({ overdue: false })).toBe(false);
    expect(isOverdue({})).toBe(false);
    expect(isOverdue(null)).toBe(false);
    // a due date in the past does not make it overdue without the flag
    expect(isOverdue({ expected_return: '2020-01-01' } as { overdue?: boolean })).toBe(false);
  });
});

describe('holderOf', () => {
  it('names the person, location or asset that has it', () => {
    expect(holderOf(asset({ current_assignment: held }))).toEqual({
      type: 'person',
      id: 'p',
      name: 'Maria Reyes',
    });
    expect(holderOf(asset({}))).toBeNull();
  });
});

describe('CONDITIONS', () => {
  it('are the four values of CheckinRequest.condition', () => {
    expect([...CONDITIONS]).toEqual(['good', 'fair', 'poor', 'damaged']);
  });
});

describe('createKeyKeeper', () => {
  const counter = () => {
    let n = 0;
    return () => `key-${(n += 1)}`;
  };

  it('keeps the key while the payload is unchanged, so a retry replays the first answer', () => {
    const keeper = createKeyKeeper(counter());
    const first = keeper.keyFor({ person_id: 'p' });
    expect(keeper.keyFor({ person_id: 'p' })).toBe(first);
    expect(keeper.keyFor({ person_id: 'p' })).toBe(first);
  });

  it('takes a new key as soon as the payload differs (the API refuses a reused key with another body)', () => {
    const keeper = createKeyKeeper(counter());
    const first = keeper.keyFor({ person_id: 'p' });
    const second = keeper.keyFor({ person_id: 'q' });
    expect(second).not.toBe(first);
    expect(keeper.keyFor({ person_id: 'q' })).toBe(second);
  });

  it('renew starts over after a success', () => {
    const keeper = createKeyKeeper(counter());
    const first = keeper.keyFor({ a: 1 });
    keeper.renew();
    expect(keeper.keyFor({ a: 1 })).not.toBe(first);
  });
});
