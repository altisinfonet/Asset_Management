import { today } from '@/lib/custody/helpers';
import { sumMoney, type Money } from '@/lib/money';
import type { Repair, RepairStatus } from './api';

/** Statuses of a repair that still hold the asset, and the ones that ended it. */
export const OPEN_STATUSES: RepairStatus[] = ['open', 'in_progress'];
export const CLOSED_STATUSES: RepairStatus[] = ['completed', 'cancelled'];

/** A calendar day typed in a date field as the instant the API stores (noon UTC, so it stays that day everywhere). */
export function dayToInstant(day: string): string {
  return `${day}T12:00:00.000Z`;
}

/** The calendar day of a stored instant, for a date field. */
export function instantToDay(instant: string | null | undefined): string {
  return instant ? instant.slice(0, 10) : '';
}

export function todayInstant(): string {
  return dayToInstant(today());
}

/** Total cost of repairs, per currency (`Money` of the repairs that have a cost). */
export function totalCost(repairs: ReadonlyArray<Pick<Repair, 'cost'>>): Money[] {
  return sumMoney(repairs.map((repair) => repair.cost));
}

/** A status that ends a repair cannot be changed again. */
export const isClosed = (repair: Pick<Repair, 'status'>): boolean =>
  repair.status === 'completed' || repair.status === 'cancelled';
