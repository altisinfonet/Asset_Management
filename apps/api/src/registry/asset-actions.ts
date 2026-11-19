import { ApiProblem } from '../platform/index.js';

/**
 * The asset state machine of the lifecycle actions (M2-LIFE-02..05): which action is allowed in which
 * state. ONE table, used by the services (to refuse), by `GET /v1/scan/resolve` (`allowed_actions`)
 * and by the state-machine test (the table IS the test input).
 *
 * "State" is the asset's status label state type plus two facts: archived or not, and whether a
 * custody period is open. Permissions are separate (the guard); this is only about the asset.
 *
 *   action      deployable  deployed(open) pending  undeployable  lost   archived-type
 *   checkout        yes         no (409)     409        409        409        409
 *   checkin         409*        yes          409*       409*       409*       409*     (* = needs an open custody period)
 *   transfer        yes (hand out) yes       409        409        409        409
 *   dispose         yes         409 (check in first) yes   yes       yes        yes
 *   mark_lost       yes         yes (closes custody) yes   yes       409        yes
 *   mark_found      409         409          409        409        yes        409
 *   move / update   yes         yes          yes        yes        yes        yes
 *   open_repair     yes         409 (check in first, or force)  yes  yes   409        409
 *
 * An archived asset (archived_at set) refuses every action except restore.
 */

export const ASSET_ACTIONS = [
  'checkout',
  'checkin',
  'transfer',
  'dispose',
  'mark_lost',
  'mark_found',
  'move',
  'update',
  /** M2-MNT-01: open a repair / maintenance record (and move the asset to an in-repair status). */
  'open_repair',
] as const;
export type AssetAction = (typeof ASSET_ACTIONS)[number];

export interface AssetActionContext {
  archived: boolean;
  /** `status_label.state_type` of the asset's current status. */
  stateType: string;
  /** An open custody period exists. */
  hasAssignment: boolean;
}

export type Refusal =
  | { code: 'conflict'; detail: string }
  | { code: 'asset-already-checked-out'; detail: string }
  | { code: 'asset-not-checked-out'; detail: string }
  | { code: 'asset-not-deployable'; detail: string };

/** `null` when the action is allowed, otherwise why not (the problem code and a human sentence). */
export function refuseAssetAction(action: AssetAction, ctx: AssetActionContext): Refusal | null {
  if (ctx.archived) {
    return { code: 'conflict', detail: 'The asset is archived. Restore it first.' };
  }
  switch (action) {
    case 'checkout':
      if (ctx.hasAssignment) {
        return { code: 'asset-already-checked-out', detail: 'The asset is already checked out.' };
      }
      return ctx.stateType === 'deployable'
        ? null
        : {
            code: 'asset-not-deployable',
            detail: `The asset cannot be checked out: its status is of type "${ctx.stateType}" (only "deployable" assets can be checked out).`,
          };
    case 'checkin':
      return ctx.hasAssignment
        ? null
        : { code: 'asset-not-checked-out', detail: 'The asset is not checked out.' };
    case 'transfer':
      if (ctx.hasAssignment || ctx.stateType === 'deployable') return null;
      return {
        code: 'asset-not-deployable',
        detail: `The asset cannot be handed out: it is not checked out and its status is of type "${ctx.stateType}" (only "deployable" assets can be).`,
      };
    case 'dispose':
      return ctx.hasAssignment
        ? {
            code: 'asset-already-checked-out',
            detail: 'The asset is checked out. Check it in before disposing of it.',
          }
        : null;
    case 'mark_lost':
      return ctx.stateType === 'lost'
        ? { code: 'conflict', detail: 'The asset is already marked lost.' }
        : null;
    case 'mark_found':
      return ctx.stateType === 'lost'
        ? null
        : { code: 'conflict', detail: 'The asset is not marked lost.' };
    case 'open_repair':
      if (ctx.hasAssignment) {
        return {
          code: 'asset-already-checked-out',
          detail:
            'The asset is checked out. Check it in first, or open the repair with force_checkin and a note.',
        };
      }
      if (ctx.stateType === 'lost') {
        return { code: 'conflict', detail: 'The asset is marked lost. Mark it found before repairing it.' };
      }
      if (ctx.stateType === 'archived') {
        return {
          code: 'conflict',
          detail: 'The asset is retired. Give it another status before repairing it.',
        };
      }
      return null;
    case 'move':
    case 'update':
      return null;
  }
}

/** Throws the refusal as the problem the API answers with. */
export function assertAssetAction(action: AssetAction, ctx: AssetActionContext): void {
  const refusal = refuseAssetAction(action, ctx);
  if (refusal) throw new ApiProblem({ code: refusal.code, detail: refusal.detail });
}
