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
  Upload,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/i18n';
import type { HistoryEvent } from '@/lib/registry/types';

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
};

/** The groups of the "event type" filter, each a set of the API's `event_type` values. */
export const HISTORY_FILTERS = {
  all: [] as EventType[],
  custody: ['checked_out', 'checked_in', 'transferred'] as EventType[],
  changes: ['status_changed', 'location_changed', 'updated'] as EventType[],
  repairs: ['repair_opened', 'repair_completed'] as EventType[],
  lifecycle: ['created', 'archived', 'restored', 'imported', 'label_printed'] as EventType[],
};
export type HistoryFilter = keyof typeof HISTORY_FILTERS;

/** "from -> to" of a change event when the payload carries plain values for both. */
function change(payload: HistoryEvent['payload']): string | null {
  const from = payload?.from;
  const to = payload?.to;
  const plain = (v: unknown): v is string | number =>
    typeof v === 'string' || typeof v === 'number';
  return plain(from) && plain(to) ? `${from} → ${to}` : null;
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
  const { t, formatDateTime } = useI18n();
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
          {events.map((event) => {
            const Icon = ICONS[event.event_type] ?? Pencil;
            const detail = change(event.payload);
            const note = typeof event.payload?.note === 'string' ? event.payload.note : null;
            const actor =
              event.actor?.display_name ??
              (event.actor_type === 'system' ? t('history.system') : null);
            return (
              <li key={event.id} className="flex items-start gap-3 py-3">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-muted">
                  <Icon aria-hidden className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-base">
                    <span className="font-medium">{t(`assetView.events.${event.event_type}`)}</span>
                    {actor ? (
                      <span className="text-muted">{t('history.by', { name: actor })}</span>
                    ) : null}
                  </p>
                  {event.summary ? <p className="break-words text-base">{event.summary}</p> : null}
                  {detail ? <p className="text-sm text-muted">{detail}</p> : null}
                  {note ? <p className="break-words text-sm text-muted">{`“${note}”`}</p> : null}
                  <time dateTime={event.at} className="font-tag text-xs text-muted">
                    {formatDateTime(event.at)}
                  </time>
                </div>
              </li>
            );
          })}
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
