'use client';

import {
  Archive,
  ArrowRightLeft,
  LogIn,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Tag,
  Undo2,
  Upload,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n, type Translator } from '@/i18n';
import type { HistoryEvent } from '@/lib/registry/types';
import { routes } from '@/lib/routes';

type EventType = HistoryEvent['event_type'];

const ICONS: Record<EventType, LucideIcon> = {
  created: Plus,
  updated: Pencil,
  status_changed: Tag,
  location_changed: MapPin,
  checked_out: LogOut,
  checked_in: LogIn,
  transferred: ArrowRightLeft,
  repair_opened: Wrench,
  repair_completed: Wrench,
  archived: Archive,
  restored: RotateCcw,
  label_printed: Printer,
  imported: Upload,
  custody_undone: Undo2,
};

/** The groups of the "event type" filter, each a set of the API's `event_type` values. */
export const HISTORY_FILTERS = {
  all: [] as EventType[],
  custody: ['checked_out', 'checked_in', 'transferred', 'custody_undone'] as EventType[],
  changes: ['status_changed', 'location_changed', 'updated'] as EventType[],
  repairs: ['repair_opened', 'repair_completed'] as EventType[],
  lifecycle: ['created', 'archived', 'restored', 'imported', 'label_printed'] as EventType[],
};
export type HistoryFilter = keyof typeof HISTORY_FILTERS;

const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The facts of an event's `payload`, one short line each, by the shapes the contract documents per
 * `event_type`: a status or location change (`from_name -> to_name`), the due date and status of a
 * check-out, the condition and status of a check-in, the two holders of a transfer, the number of
 * photos. The note has its own line.
 */
export function eventFacts(
  event: Pick<HistoryEvent, 'event_type' | 'payload'>,
  t: Translator['t'],
  formatDate: (value: string, options?: Intl.DateTimeFormatOptions) => string,
): string[] {
  const p = event.payload ?? {};
  const facts: string[] = [];
  const arrow = (from: unknown, to: unknown) =>
    isText(from) && isText(to) ? `${from} → ${to}` : null;
  switch (event.event_type) {
    case 'status_changed':
    case 'location_changed': {
      const line = arrow(p.from_name, p.to_name);
      if (line) facts.push(line);
      break;
    }
    case 'checked_out': {
      if (isText(p.expected_return)) {
        facts.push(
          t('history.due', {
            date: formatDate(`${p.expected_return}T00:00:00Z`, { timeZone: 'UTC' }),
          }),
        );
      }
      if (isRecord(p.status)) {
        const line = arrow(p.status.from, p.status.to);
        if (line) facts.push(t('history.statusLine', { change: line }));
      }
      break;
    }
    case 'checked_in': {
      if (isText(p.condition)) {
        facts.push(
          t('custody.conditionNamed', {
            condition: t(`custody.conditions.${p.condition as 'good'}`),
          }),
        );
      }
      if (isRecord(p.status)) {
        const line = arrow(p.status.from, p.status.to);
        if (line) facts.push(t('history.statusLine', { change: line }));
      }
      break;
    }
    case 'custody_undone': {
      if (isRecord(p.status)) {
        const line = arrow(p.status.from, p.status.to);
        if (line) facts.push(t('history.statusLine', { change: line }));
      }
      break;
    }
    case 'transferred': {
      const from = isRecord(p.from) ? p.from.name : null;
      const to = isRecord(p.to) ? p.to.name : null;
      const line = arrow(from, to);
      if (line) facts.push(line);
      if (isText(p.reason)) facts.push(t('history.reason', { reason: p.reason }));
      break;
    }
  }
  if (Array.isArray(p.attachment_ids) && p.attachment_ids.length > 0) {
    facts.push(t('history.photos', { count: p.attachment_ids.length }));
  }
  return facts;
}

/**
 * One event of a timeline: icon, what happened, who did it, the server's summary, the facts of the
 * payload and the note. `showAsset` adds the asset (tag, linked) for a per-person timeline.
 */
export function HistoryEventItem({
  event,
  showAsset,
}: {
  event: HistoryEvent;
  showAsset?: boolean;
}) {
  const { t, formatDateTime, formatDate } = useI18n();
  const Icon = ICONS[event.event_type] ?? Pencil;
  const facts = eventFacts(event, t, formatDate);
  const note = typeof event.payload?.note === 'string' ? event.payload.note : null;
  const actor =
    event.actor?.display_name ?? (event.actor_type === 'system' ? t('history.system') : null);
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-muted">
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2 text-base">
          <span className="font-medium">{t(`assetView.events.${event.event_type}`)}</span>
          {showAsset ? (
            <Link
              href={routes.assetView(event.asset_id)}
              className="rounded-sm font-tag text-primary-text underline underline-offset-2"
            >
              {event.asset_tag ?? event.asset_id.slice(0, 8)}
            </Link>
          ) : null}
          {actor ? <span className="text-muted">{t('history.by', { name: actor })}</span> : null}
        </p>
        {event.summary ? <p className="break-words text-base">{event.summary}</p> : null}
        {facts.map((fact) => (
          <p key={fact} className="text-sm text-muted">
            {fact}
          </p>
        ))}
        {note ? <p className="break-words text-sm text-muted">{`“${note}”`}</p> : null}
        <time dateTime={event.at} className="font-tag text-xs text-muted">
          {formatDateTime(event.at)}
        </time>
      </div>
    </li>
  );
}

export interface HistoryTimelineProps {
  events: HistoryEvent[];
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  filter: HistoryFilter;
  onFilterChange: (filter: HistoryFilter) => void;
  onRetry: () => void;
}

/**
 * Chain of custody and lifecycle events of an asset (WEB-05 History tab, design system W18): newest
 * first, with an icon per kind of event, who did it (`actor.display_name`), the server's summary and
 * the details of a change. Filter by group of events; "Load more" follows the cursor.
 */
export function HistoryTimeline({
  events,
  loading,
  error,
  hasMore,
  loadingMore,
  onMore,
  filter,
  onFilterChange,
  onRetry,
}: HistoryTimelineProps) {
  const { t } = useI18n();
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <label className="flex w-fit items-center gap-2 text-sm font-medium">
        {t('history.filter')}
        <Select
          aria-label={t('history.filter')}
          value={filter}
          onValueChange={(value) => onFilterChange(value as HistoryFilter)}
          className="w-52"
          options={(Object.keys(HISTORY_FILTERS) as HistoryFilter[]).map((key) => ({
            value: key,
            label: t(`history.filters.${key}`),
          }))}
        />
      </label>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : error ? (
        <Banner tone="danger" action={<Button onClick={onRetry}>{t('common.retry')}</Button>}>
          {t('common.loadFailed')}
        </Banner>
      ) : events.length === 0 ? (
        <p className="text-base text-muted">
          {filter === 'all' ? t('assetView.noHistory') : t('history.noMatch')}
        </p>
      ) : (
        <ol
          aria-label={t('assetView.tabs.history')}
          className="flex flex-col divide-y divide-border"
        >
          {events.map((event) => (
            <HistoryEventItem key={event.id} event={event} />
          ))}
        </ol>
      )}
      {hasMore ? (
        <div>
          <Button loading={loadingMore} onClick={onMore}>
            {t('assetView.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
