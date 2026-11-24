'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { CircleCheck, ClockAlert, User, Wrench, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n, type TranslationKey } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/cn';
import {
  useAssetCount,
  useLowStock,
  useOpenRepairs,
  useOverdueAssets,
  type TileId,
} from '@/lib/dashboard/queries';
import { routes } from '@/lib/routes';
import { stockLevel } from '@/lib/stock/helpers';

interface TileSpec {
  id: TileId;
  labelKey: TranslationKey;
  icon: LucideIcon;
  iconClass: string;
  href: string;
}

/** Each tile opens the asset list with the filter that produced its number (see `lib/dashboard/queries`). */
const TILES: TileSpec[] = [
  {
    id: 'ready',
    labelKey: 'dashboard.ready',
    icon: CircleCheck,
    iconClass: 'text-success-text',
    href: routes.assetsFiltered({ stateType: 'deployable' }),
  },
  {
    id: 'assigned',
    labelKey: 'dashboard.assigned',
    icon: User,
    iconClass: 'text-primary-text',
    href: routes.assetsFiltered({ assigned: true }),
  },
  {
    id: 'inRepair',
    labelKey: 'dashboard.inRepair',
    icon: Wrench,
    iconClass: 'text-warning-text',
    href: routes.assetsFiltered({ stateType: 'undeployable' }),
  },
  {
    id: 'overdue',
    labelKey: 'dashboard.overdue',
    icon: ClockAlert,
    iconClass: 'text-danger-text',
    href: routes.assetsFiltered({ overdue: true }),
  },
];

type TileState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; count: number };

function tileState(query: { data: number | undefined; isError: boolean }): TileState {
  if (query.data !== undefined) return { kind: 'ready', count: query.data };
  return query.isError ? { kind: 'error' } : { kind: 'loading' };
}

/**
 * The landing page: four counts that open the matching asset list, then "Needs attention" panels
 * (overdue check-outs, low stock, open repairs). Whatever the signed-in user may not read is left
 * out rather than shown empty; the API still enforces every request.
 */
export function Dashboard() {
  const i18n = useI18n();
  const { t } = i18n;
  const { can } = useAuth();
  const canAssets = can('asset:read');
  const canRepairs = can('repair:read');
  const canAccessories = can('accessory:read');
  const canConsumables = can('consumable:read');
  const canStock = canAccessories || canConsumables;

  const ready = useAssetCount('ready', canAssets);
  const assigned = useAssetCount('assigned', canAssets);
  const inRepair = useAssetCount('inRepair', canAssets);
  const overdue = useOverdueAssets(canAssets);
  const repairs = useOpenRepairs(canRepairs);
  const lowStock = useLowStock({ accessories: canAccessories, consumables: canConsumables });

  const tiles: Array<{ spec: TileSpec; state: TileState; refetch: () => unknown }> = [
    { spec: TILES[0]!, state: tileState(ready), refetch: ready.refetch },
    { spec: TILES[1]!, state: tileState(assigned), refetch: assigned.refetch },
    { spec: TILES[2]!, state: tileState(inRepair), refetch: inRepair.refetch },
    // the overdue panel's request also answers the tile
    {
      spec: TILES[3]!,
      state: tileState({ data: overdue.data?.total, isError: overdue.isError }),
      refetch: overdue.refetch,
    },
  ];
  const failed = tiles.filter((tile) => tile.state.kind === 'error');
  const day = (value: string) => i18n.formatDate(`${value}T00:00:00Z`, { timeZone: 'UTC' });

  if (!canAssets && !canStock && !canRepairs) {
    return <p className="text-base text-muted">{t('dashboard.noAccess')}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {canAssets ? (
        <section aria-label={t('dashboard.tilesLabel')} className="flex flex-col gap-3">
          {failed.length > 0 ? (
            <Banner
              tone="danger"
              action={
                <Button onClick={() => failed.forEach((tile) => void tile.refetch())}>
                  {t('common.retry')}
                </Button>
              }
            >
              {t('dashboard.countsFailed')}
            </Banner>
          ) : null}
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {tiles.map(({ spec, state }) => (
              <li key={spec.id}>
                <CountTile spec={spec} state={state} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="dashboard-attention" className="flex flex-col gap-3">
        <h2 id="dashboard-attention" className="text-lg font-semibold text-text">
          {t('dashboard.attention')}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {canAssets ? (
            <Panel
              id="overdue"
              title={t('dashboard.overduePanel.title')}
              query={overdue}
              total={overdue.data?.total}
              count={overdue.data?.rows.length ?? 0}
              href={routes.assetsFiltered({ overdue: true })}
              empty={t('dashboard.overduePanel.empty')}
            >
              {overdue.data?.rows.map((asset) => {
                const assignment = asset.current_assignment;
                const due = assignment?.expected_return;
                return (
                  <PanelRow
                    key={asset.id}
                    href={routes.assetView(asset.id)}
                    primary={<span className="font-mono">{asset.asset_tag}</span>}
                    secondary={
                      assignment?.target_name
                        ? t('dashboard.overduePanel.heldBy', { name: assignment.target_name })
                        : t('dashboard.overduePanel.noHolder')
                    }
                    aside={due ? t('dashboard.overduePanel.due', { date: day(due) }) : null}
                    asideClass="text-danger-text"
                  />
                );
              })}
            </Panel>
          ) : null}
          {canStock ? (
            <Panel
              id="stock"
              title={t('dashboard.stockPanel.title')}
              query={lowStock}
              total={lowStock.data?.total}
              count={lowStock.data?.rows.length ?? 0}
              href={routes.stock()}
              empty={t('dashboard.stockPanel.empty')}
            >
              {lowStock.data?.rows.map((item) => {
                const level = stockLevel(item.left, item.min) === 'out' ? 'out' : 'low';
                return (
                  <PanelRow
                    key={`${item.kind}-${item.id}`}
                    href={routes.stockView(item.kind, item.id)}
                    primary={item.name}
                    secondary={t(`dashboard.stockPanel.kind.${item.kind}`)}
                    aside={`${t(`stock.level.${level}`)}: ${t('dashboard.stockPanel.left', {
                      count: item.left,
                      min: item.min,
                    })}`}
                    asideClass={level === 'out' ? 'text-danger-text' : 'text-warning-text'}
                  />
                );
              })}
            </Panel>
          ) : null}
          {canRepairs ? (
            <Panel
              id="repairs"
              title={t('dashboard.repairsPanel.title')}
              query={repairs}
              total={repairs.data?.total}
              count={repairs.data?.rows.length ?? 0}
              href={routes.repairs()}
              empty={t('dashboard.repairsPanel.empty')}
            >
              {repairs.data?.rows.map((repair) => (
                <PanelRow
                  key={repair.id}
                  href={routes.repairs(repair.id)}
                  primary={
                    repair.asset_tag ? (
                      <span className="font-mono">{repair.asset_tag}</span>
                    ) : (
                      t('dashboard.repairsPanel.noAsset')
                    )
                  }
                  secondary={repair.title}
                  aside={
                    repair.reported_at
                      ? t('dashboard.repairsPanel.reported', {
                          date: i18n.formatDate(repair.reported_at),
                        })
                      : null
                  }
                />
              ))}
            </Panel>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/** A count that is a link to the list it was counted from. */
function CountTile({ spec, state }: { spec: TileSpec; state: TileState }) {
  const { t, formatNumber } = useI18n();
  return (
    <Link
      href={spec.href}
      aria-busy={state.kind === 'loading'}
      data-testid={`tile-${spec.id}`}
      className="flex min-h-24 flex-col gap-1 rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-sunken"
    >
      {state.kind === 'loading' ? (
        <>
          <Skeleton className="h-9 w-16" />
          <span className="sr-only">{t('common.loading')}</span>
        </>
      ) : (
        <span className="text-3xl leading-tight font-semibold text-text tabular-nums">
          {state.kind === 'ready' ? (
            formatNumber(state.count)
          ) : (
            <>
              <span aria-hidden>{'-'}</span>
              <span className="sr-only">{t('dashboard.tileUnavailable')}</span>
            </>
          )}
        </span>
      )}
      <span className="inline-flex items-center gap-1.5 text-sm text-muted">
        <spec.icon aria-hidden className={cn('size-4 shrink-0', spec.iconClass)} />
        {t(spec.labelKey)}
      </span>
    </Link>
  );
}

/** A "Needs attention" card: heading with the total, up to five rows, the way into the full list. */
function Panel({
  id,
  title,
  query,
  total,
  count,
  href,
  empty,
  children,
}: {
  id: string;
  title: string;
  query: Pick<UseQueryResult, 'isPending' | 'isError' | 'refetch'>;
  total: number | undefined;
  count: number;
  href: string;
  empty: string;
  children: ReactNode;
}) {
  const { t, formatNumber } = useI18n();
  const headingId = `dashboard-${id}-heading`;
  const hasTotal = total !== undefined && total > 0;
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={query.isPending}
      data-testid={`panel-${id}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-base font-semibold text-text">
          {title}
          {hasTotal ? (
            <span className="ml-2 text-sm font-normal text-muted">{formatNumber(total)}</span>
          ) : null}
        </h3>
        {hasTotal ? (
          <Link
            href={href}
            aria-label={t('dashboard.viewAllNamed', { panel: title })}
            className="rounded-sm text-sm text-primary-text underline underline-offset-2"
          >
            {t('dashboard.viewAll')}
          </Link>
        ) : null}
      </div>
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <span className="sr-only">{t('common.loading')}</span>
        </div>
      ) : query.isError ? (
        <Banner
          tone="danger"
          action={
            <Button size="sm" onClick={() => void query.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('dashboard.loadFailed')}
        </Banner>
      ) : count === 0 ? (
        <p className="py-2 text-base text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col">{children}</ul>
      )}
    </section>
  );
}

function PanelRow({
  href,
  primary,
  secondary,
  aside,
  asideClass,
}: {
  href: string;
  primary: ReactNode;
  secondary: ReactNode;
  aside: ReactNode;
  asideClass?: string;
}) {
  return (
    <li className="border-t border-border first:border-t-0">
      <Link
        href={href}
        className="flex min-h-(--size-control) flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-md px-2 py-1.5 hover:bg-sunken"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-base font-medium text-text">{primary}</span>
          <span className="truncate text-sm text-muted">{secondary}</span>
        </span>
        {aside ? <span className={cn('text-sm font-medium', asideClass)}>{aside}</span> : null}
      </Link>
    </li>
  );
}
