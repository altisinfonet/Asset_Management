import type { Asset, AssignmentSummary } from '@/lib/registry/types';

/**
 * Pure helpers of the custody flows (M2-LIFE-07): which actions an asset offers, due dates, the
 * "who holds it" text and the retry key that makes a check-out safe to repeat.
 */
export type CustodyAction = 'checkout' | 'checkin' | 'transfer';

export type CustodyPermission = (permission: string) => boolean;

const PERMISSION: Record<CustodyAction, string> = {
  checkout: 'asset:checkout',
  checkin: 'asset:checkin',
  transfer: 'asset:transfer',
};

/**
 * What can be done to an asset right now. A held asset can be returned or handed on; a deployable
 * asset can be checked out; archived, lost, in-repair and pending assets offer nothing (the API
 * enforces the same rules and answers `409` otherwise). `can` filters by the caller's permissions.
 */
export function availableActions(asset: Asset, can: CustodyPermission): CustodyAction[] {
  if (asset.archived_at) return [];
  const actions: CustodyAction[] = asset.current_assignment
    ? ['checkin', 'transfer']
    : asset.status?.state_type === 'deployable'
      ? ['checkout']
      : [];
  return actions.filter((action) => can(PERMISSION[action]));
}

/** Local calendar date as `YYYY-MM-DD` (what `<input type="date">` and the API use). */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function today(now: Date = new Date()): string {
  return isoDate(now);
}

/** The date `days` after `now`, or `months` calendar months after it. */
export function dateAfter(
  offset: { days?: number; months?: number },
  now: Date = new Date(),
): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (offset.months) date.setMonth(date.getMonth() + offset.months);
  if (offset.days) date.setDate(date.getDate() + offset.days);
  return isoDate(date);
}

/** True when `expected` (a date) is before today: the asset is overdue. */
export function isOverdue(
  assignment: Pick<AssignmentSummary, 'expected_return'> | null | undefined,
  now: Date = new Date(),
): boolean {
  return !!assignment?.expected_return && assignment.expected_return < today(now);
}

export type TargetType = 'person' | 'location' | 'asset';

/** Who or where an asset is: the name the API resolved for the open custody period. */
export function holderOf(asset: Pick<Asset, 'current_assignment'>): {
  type: TargetType;
  id: string;
  name: string;
} | null {
  const assignment = asset.current_assignment;
  if (!assignment) return null;
  return {
    type: assignment.target_type,
    id: assignment.target_id,
    name: assignment.target_name ?? '',
  };
}

/** The condition choices of the check-in form. The API has no condition field: it travels in the note. */
export const CONDITIONS = ['good', 'fair', 'damaged'] as const;
export type Condition = (typeof CONDITIONS)[number];

/** "Condition: Fair. <note>" - the note the check-in is sent with (empty when there is nothing to say). */
export function noteWithCondition(
  note: string,
  condition: Condition | '',
  conditionLabel: (condition: Condition) => string,
  prefix: string,
): string {
  const trimmed = note.trim();
  if (!condition) return trimmed;
  const head = `${prefix}: ${conditionLabel(condition)}.`;
  return trimmed ? `${head} ${trimmed}` : head;
}

/**
 * Retry key for one logical request. The same key may be sent again only with the same body (a
 * different body answers `422 idempotency-key-reuse`), so the key follows the body: it is kept
 * while the payload is unchanged (a retry after a dropped connection replays the first answer) and
 * replaced as soon as the payload differs.
 */
export function createKeyKeeper(newKey: () => string = defaultKey) {
  let signature: string | undefined;
  let key = newKey();
  return {
    keyFor(payload: unknown): string {
      const next = JSON.stringify(payload);
      if (next !== signature) {
        if (signature !== undefined) key = newKey();
        signature = next;
      }
      return key;
    },
    /** Start over (after a success or a definitive refusal that the user will fix). */
    renew(): void {
      key = newKey();
      signature = undefined;
    },
  };
}

function defaultKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
