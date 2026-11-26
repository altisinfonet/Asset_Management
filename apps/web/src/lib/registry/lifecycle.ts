import type {
  Asset,
  DisposalReason,
  DisposeRequest,
  MarkFoundRequest,
  MarkLostRequest,
  StatusLabel,
} from './types';

/**
 * Pure helpers of the lost, found and dispose actions (M2-LIFE-05): which of them an asset offers,
 * the status labels each may pick from, and the request bodies built from the dialog values.
 * The rules mirror the API's state machine (`registry/asset-actions.ts`), which stays the judge.
 */

/** `DisposeRequest.reason` of the contract, in the order the picker shows them. */
export const DISPOSAL_REASONS: readonly DisposalReason[] = [
  'sold',
  'donated',
  'recycled',
  'scrapped',
  'stolen',
  'returned_to_vendor',
  'other',
];

export type LifecycleAction = 'mark_lost' | 'mark_found' | 'dispose';

const PERMISSION: Record<LifecycleAction, string> = {
  mark_lost: 'asset:update',
  mark_found: 'asset:update',
  dispose: 'asset:delete',
};

/**
 * What the asset page offers: an archived asset nothing; a lost one "Mark as found" (and Dispose);
 * any other "Mark as lost or stolen" (also while checked out: that closes the check-out) and Dispose
 * (while checked out too: the dialog says to check it in first and the API refuses with 409).
 */
export function lifecycleActions(
  asset: Pick<Asset, 'archived_at' | 'status'>,
  can: (permission: string) => boolean,
): LifecycleAction[] {
  if (asset.archived_at) return [];
  const lost = asset.status?.state_type === 'lost';
  const actions: LifecycleAction[] = lost ? ['mark_found', 'dispose'] : ['mark_lost', 'dispose'];
  return actions.filter((action) => can(PERMISSION[action]));
}

/** The live status labels of a state type, as select options, in the catalogue's order. */
export function statusChoices(
  statuses: readonly StatusLabel[],
  stateType: StatusLabel['state_type'],
): Array<{ value: string; label: string }> {
  return statuses
    .filter((s) => s.state_type === stateType && !s.archived_at)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name))
    .map((s) => ({ value: s.id, label: s.name }));
}

type Values = Record<string, string | boolean>;
const text = (value: string | boolean | undefined): string =>
  typeof value === 'string' ? value.trim() : '';

/** `MarkLostRequest`: the note when one was typed, the status only when the user could choose. */
export function markLostBody(values: Values, withStatus: boolean): MarkLostRequest {
  const note = text(values.note);
  const status = text(values.status_id);
  return { ...(note ? { note } : {}), ...(withStatus && status ? { status_id: status } : {}) };
}

/**
 * `MarkFoundRequest`: `location_id` only when it differs from where the asset was (`null` when the
 * user cleared it), the status only when the user could choose.
 */
export function markFoundBody(
  values: Values,
  currentLocationId: string | null,
  withStatus: boolean,
): MarkFoundRequest {
  const note = text(values.note);
  const status = text(values.status_id);
  const location = text(values.location_id) || null;
  return {
    ...(withStatus && status ? { status_id: status } : {}),
    ...(location !== currentLocationId ? { location_id: location } : {}),
    ...(note ? { note } : {}),
  };
}

/** `DisposeRequest`: reason, date (the API defaults to today), note, and the status if chosen. */
export function disposeBody(values: Values, withStatus: boolean): DisposeRequest {
  const note = text(values.note);
  const date = text(values.disposed_on);
  const status = text(values.status_id);
  return {
    reason: text(values.reason) as DisposalReason,
    ...(date ? { disposed_on: date } : {}),
    ...(note ? { note } : {}),
    ...(withStatus && status ? { status_id: status } : {}),
  };
}

/**
 * The hint for a status picked by hand in the asset form or the bulk edit: a lost-type status set
 * that way keeps the check-out open, an archived-type one keeps the asset in the active list. The
 * lifecycle actions do it properly; `null` for every other state type.
 */
export function statusHintKind(
  stateType: StatusLabel['state_type'] | undefined,
): 'lost' | 'archived' | null {
  return stateType === 'lost' || stateType === 'archived' ? stateType : null;
}
