import { describe, expect, it } from 'vitest';
import { ApiProblem } from '../platform/index.js';
import {
  ASSET_ACTIONS,
  type AssetAction,
  assertAssetAction,
  refuseAssetAction,
} from './asset-actions.js';

/**
 * M2-LIFE-05: "All transitions covered by a state-machine table test (which state types allow which
 * actions)". The table below IS the specification (it mirrors the one in `asset-actions.ts`): every
 * (state, action) pair is listed, so a new action or state type without a row fails the test.
 */

type Outcome =
  | 'ok'
  | 'asset-already-checked-out'
  | 'asset-not-checked-out'
  | 'asset-not-deployable'
  | 'conflict';

interface State {
  name: string;
  stateType: string;
  /** an open custody period exists */
  out: boolean;
  archived?: boolean;
}

const STATES: State[] = [
  { name: 'deployable, in stock', stateType: 'deployable', out: false },
  { name: 'deployed, checked out', stateType: 'deployed', out: true },
  { name: 'deployed status, nobody holds it', stateType: 'deployed', out: false },
  { name: 'pending', stateType: 'pending', out: false },
  { name: 'undeployable (in repair, broken)', stateType: 'undeployable', out: false },
  { name: 'lost', stateType: 'lost', out: false },
  { name: 'archived-type status (retired)', stateType: 'archived', out: false },
  { name: 'archived (archived_at set)', stateType: 'deployable', out: false, archived: true },
];

const EXPECTED: Record<string, Record<AssetAction, Outcome>> = {
  'deployable, in stock': {
    checkout: 'ok',
    checkin: 'asset-not-checked-out',
    transfer: 'ok',
    dispose: 'ok',
    mark_lost: 'ok',
    mark_found: 'conflict',
    move: 'ok',
    update: 'ok',
  },
  'deployed, checked out': {
    checkout: 'asset-already-checked-out',
    checkin: 'ok',
    transfer: 'ok',
    dispose: 'asset-already-checked-out',
    mark_lost: 'ok',
    mark_found: 'conflict',
    move: 'ok',
    update: 'ok',
  },
  'deployed status, nobody holds it': {
    checkout: 'asset-not-deployable',
    checkin: 'asset-not-checked-out',
    transfer: 'asset-not-deployable',
    dispose: 'ok',
    mark_lost: 'ok',
    mark_found: 'conflict',
    move: 'ok',
    update: 'ok',
  },
  pending: {
    checkout: 'asset-not-deployable',
    checkin: 'asset-not-checked-out',
    transfer: 'asset-not-deployable',
    dispose: 'ok',
    mark_lost: 'ok',
    mark_found: 'conflict',
    move: 'ok',
    update: 'ok',
  },
  'undeployable (in repair, broken)': {
    checkout: 'asset-not-deployable',
    checkin: 'asset-not-checked-out',
    transfer: 'asset-not-deployable',
    dispose: 'ok',
    mark_lost: 'ok',
    mark_found: 'conflict',
    move: 'ok',
    update: 'ok',
  },
  lost: {
    checkout: 'asset-not-deployable',
    checkin: 'asset-not-checked-out',
    transfer: 'asset-not-deployable',
    dispose: 'ok',
    mark_lost: 'conflict',
    mark_found: 'ok',
    move: 'ok',
    update: 'ok',
  },
  'archived-type status (retired)': {
    checkout: 'asset-not-deployable',
    checkin: 'asset-not-checked-out',
    transfer: 'asset-not-deployable',
    dispose: 'ok',
    mark_lost: 'ok',
    mark_found: 'conflict',
    move: 'ok',
    update: 'ok',
  },
  // an archived asset refuses every action (restore is the only way back)
  'archived (archived_at set)': {
    checkout: 'conflict',
    checkin: 'conflict',
    transfer: 'conflict',
    dispose: 'conflict',
    mark_lost: 'conflict',
    mark_found: 'conflict',
    move: 'conflict',
    update: 'conflict',
  },
};

describe('asset action state machine (M2-LIFE-05)', () => {
  it('the table covers every state and every action', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(STATES.map((s) => s.name).sort());
    for (const s of STATES) {
      expect(Object.keys(EXPECTED[s.name]!).sort(), s.name).toEqual([...ASSET_ACTIONS].sort());
    }
  });

  for (const state of STATES) {
    it.each(ASSET_ACTIONS.map((a) => [a] as const))(`${state.name}: %s`, (action) => {
      const expected = EXPECTED[state.name]![action];
      const refusal = refuseAssetAction(action, {
        archived: state.archived ?? false,
        stateType: state.stateType,
        hasAssignment: state.out,
      });
      expect(refusal?.code ?? 'ok').toBe(expected);
      if (expected === 'ok') {
        expect(() =>
          assertAssetAction(action, {
            archived: false,
            stateType: state.stateType,
            hasAssignment: state.out,
          }),
        ).not.toThrow();
      } else {
        try {
          assertAssetAction(action, {
            archived: state.archived ?? false,
            stateType: state.stateType,
            hasAssignment: state.out,
          });
          expect.unreachable('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(ApiProblem);
          expect((err as ApiProblem).getStatus()).toBe(409);
          expect((err as ApiProblem).code).toBe(expected);
        }
      }
    });
  }

  it('every refusal carries a human sentence that says what to do', () => {
    for (const state of STATES) {
      for (const action of ASSET_ACTIONS) {
        const refusal = refuseAssetAction(action, {
          archived: state.archived ?? false,
          stateType: state.stateType,
          hasAssignment: state.out,
        });
        if (refusal) expect(refusal.detail.length, `${state.name}/${action}`).toBeGreaterThan(10);
      }
    }
  });
});
