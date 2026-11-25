'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import {
  Boxes,
  CircleCheck,
  ClockAlert,
  PackageMinus,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
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
  useStateTypeCount,
  useTotalAssets,
  type ChartStateType,
  type TileId,
} from '@/lib/dashboard/queries';
import { routes } from '@/lib/routes';
import { stockLevel } from '@/lib/stock/helpers';

type Tone = 'primary' | 'success' | 'info' | 'warning' | 'danger';

/** Static class names per tone (Tailwind only sees whole class names). */
const TONE: Record<Tone, { bar: string; icon: string; chip: string; text: string }> = {
  primary: {
    bar: 'bg-primary',
    icon: 'text-primary-text',
    chip: 'bg-primary-subtle text-primary-text',
    text: 'text-primary-text',
  },
  success: {
    bar: 'bg-success',
    icon: 'text-success-text',
    chip: 'bg-success-subtle text-success-text',
    text: 'text-success-text',
  },
  info: {
    bar: 'bg-info',
    icon: 'text-info-text',
    chip: 'bg-info-subtle text-info-text',
    text: 'text-info-text',
  },
  warning: {
    bar: 'bg-warning',
    icon: 'text-warning-text',
    chip: 'bg-warning-subtle text-warning-text',
    text: 'text-warning-text',
  },
  danger: {
    bar: 'bg-danger',
    icon: 'text-danger-text',
    chip: 'bg-danger-subtle text-danger-text',
    text: 'text-danger-text',
  },
};

interface TileSpec {
  id: TileId | 'total';
  labelKey: TranslationKey;
  icon: LucideIcon;
  tone: Tone;
  href: string;
}

/** Each tile opens the asset list with the filter that produced its number (see `lib/dashboard/queries`). */
const TILES: TileSpec[] = [
  { id: 'total', labelKey: 'dashboard.total', icon: Boxes, tone: 'primary', href: routes.assets },
  {
    id: 'ready',
    labelKey: 'dashboard.ready',
    icon: CircleCheck,
    tone: 'success',
    href: routes.assetsFiltered({ stateType: 'deployable' }),
  },
  {
    id: 'assigned',
    labelKey: 'dashboard.assigned',
    icon: User,
    tone: 'info',
    href: routes.assetsFiltered({ assigned: true }),
  },
  {
    id: 'inRepair',
    labelKey: 'dashboard.inRepair',
    icon: Wrench,
    tone: 'warning',
    href: routes.assetsFiltered({ stateType: 'undeployable' }),
  },
  {
    id: 'overdue',
    labelKey: 'dashboard.overdue',
    icon: ClockAlert,
    tone: 'danger',
    href: routes.assetsFiltered({ overdue: true }),
  },
];

/** Chart colour per state type: categorical tokens, with the danger role kept for lost assets. */
const STATE_COLORS: Record<ChartStateType, { stroke: string; fill: string }> = {
  deployable: { stroke: 'stroke-chart-5', fill: 'bg-chart-5' },
  deployed: { stroke: 'stroke-chart-2', fill: 'bg-chart-2' },
  pending: { stroke: 'stroke-chart-3', fill: 'bg-chart-3' },
  undeployable: { stroke: 'stroke-chart-4', fill: 'bg-chart-4' },
  lost: { stroke: 'stroke-danger', fill: 'bg-danger' },
  archived: { stroke: 'stroke-border-strong', fill: 'bg-border-strong' },
};

type CountState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; count: number };

function countState(query: { data: number | undefined; isError: boolean }): CountState {
  if (query.data !== undefined) return { kind: 'ready', count: query.data };
  return query.isError ? { kind: 'error' } : { kind: 'loading' };
}

const value = (state: CountState) => (state.kind === 'ready' ? state.count : undefined);

/** `part / whole` when both are known and the whole is not zero. */
function ratio(part: number | undefined, whole: number | undefined): number | undefined {
  return part === undefined || whole === undefined || whole === 0 ? undefined : part / whole;
}

/**
 * The landing page, laid out as an operations console: a strip of counts that open the matching
 * asset list, the fleet by status and its utilisation, then "Needs attention" (overdue check-outs,
 * low stock, open repairs). Whatever the signed-in user may not read is left out rather than shown
 * empty; the API still enforces every request. Colours come from the shared design tokens only, so
 * the page follows the System, Light and Dark themes without per-theme styles.
 */
export function Dashboard() {
  const i18n = useI18n();
  const { t } = i18n;
  const { can } = useAuth();
  const canAssets = can('asset:read');
  const canRepairs = can('repair:read');
  const canLoaners = can('loaner:read');
  const canAccessories = can('accessory:read');
  const canConsumables = can('consumable:read');
  const canStock = canAccessories || canConsumables;

  const total = useTotalAssets(canAssets);
  const ready = useAssetCount('ready', canAssets);
  const assigned = useAssetCount('assigned', canAssets);
  const inRepair = useAssetCount('inRepair', canAssets);
  const deployed = useStateTypeCount('deployed', canAssets);
  const pending = useStateTypeCount('pending', canAssets);
  const lost = useStateTypeCount('lost', canAssets);
  const archived = useStateTypeCount('archived', canAssets);
  const overdue = useOverdueAssets(canAssets);
  const repairs = useOpenRepairs(canRepairs);
  const lowStock = useLowStock({ accessories: canAccessories, consumables: canConsumables });

  const counts = {
    total: countState(total),
    ready: countState(ready),
    assigned: countState(assigned),
    inRepair: countState(inRepair),
    // the overdue panel's request also answers the tile
    overdue: countState({ data: overdue.data?.total, isError: overdue.isError }),
  } satisfies Record<TileSpec['id'], CountState>;
  const states: Record<ChartStateType, CountState> = {
    deployable: counts.ready,
    deployed: countState(deployed),
    pending: countState(pending),
    undeployable: counts.inRepair,
    lost: countState(lost),
    archived: countState(archived),
  };
  const countQueries = [
    total,
    ready,
    assigned,
    inRepair,
    deployed,
    pending,
    lost,
    archived,
    overdue,
  ];
  const failed = countQueries.filter((query) => query.isError);

  const totalCount = value(counts.total);
  const shares: Record<TileSpec['id'], string | undefined> = {
    total: t('dashboard.totalHint'),
    ready: percentText(ratio(value(counts.ready), totalCount), 'dashboard.shareOfAll'),
    assigned: percentText(ratio(value(counts.assigned), totalCount), 'dashboard.shareOfAll'),
    inRepair: percentText(ratio(value(counts.inRepair), totalCount), 'dashboard.shareOfAll'),
    overdue: percentText(
      ratio(value(counts.overdue), value(counts.assigned)),
      'dashboard.shareOfAssigned',
    ),
  };
  const day = (date: string) => i18n.formatDate(`${date}T00:00:00Z`, { timeZone: 'UTC' });

  function percentText(share: number | undefined, key: TranslationKey) {
    if (share === undefined) return undefined;
    return t(key, { percent: formatPercent(share) });
  }
  function formatPercent(share: number) {
    return i18n.formatNumber(share, { style: 'percent', maximumFractionDigits: 0 });
  }

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
                <Button onClick={() => failed.forEach((query) => void query.refetch())}>
                  {t('common.retry')}
                </Button>
              }
            >
              {t('dashboard.countsFailed')}
            </Banner>
          ) : null}
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
            {TILES.map((spec) => (
              <li key={spec.id} className={cn(spec.id === 'total' && 'col-span-2 lg:col-span-1')}>
                <CountTile spec={spec} state={counts[spec.id]} note={shares[spec.id]} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canAssets ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <StatusChart className="xl:col-span-2" states={states} formatPercent={formatPercent} />
          <UtilisationCard
            deployed={value(states.deployed)}
            deployable={value(states.deployable)}
            total={totalCount}
            assigned={value(counts.assigned)}
            overdue={value(counts.overdue)}
            inRepair={value(counts.inRepair)}
            loading={[total, ready, assigned, inRepair, deployed, overdue].some(
              (query) => query.isPending,
            )}
            formatPercent={formatPercent}
          />
        </div>
      ) : null}

      <section aria-labelledby="dashboard-attention" className="flex flex-col gap-3">
        <h2 id="dashboard-attention" className="text-lg font-semibold text-text">
          {t('dashboard.attention')}
        </h2>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 xl:items-start">
          {canAssets ? (
            <Panel
              id="overdue"
              className={canStock || canRepairs ? 'xl:col-span-2' : 'xl:col-span-3'}
              title={t('dashboard.overduePanel.title')}
              query={overdue}
              total={overdue.data?.total}
              count={overdue.data?.rows.length ?? 0}
              href={routes.assetsFiltered({ overdue: true })}
              empty={t('dashboard.overduePanel.empty')}
              columns={[
                t('dashboard.columns.asset'),
                t('dashboard.columns.holder'),
                t('dashboard.columns.due'),
                t('dashboard.columns.status'),
              ]}
              extraLink={
                canLoaners
                  ? { href: routes.loaners, label: t('dashboard.overduePanel.loanerLink') }
                  : undefined
              }
            >
              {overdue.data?.rows.map((asset) => {
                const assignment = asset.current_assignment;
                const due = assignment?.expected_return;
                return (
                  <TableRow
                    key={asset.id}
                    href={routes.assetView(asset.id)}
                    tag={asset.asset_tag}
                    name={asset.name ?? null}
                    holder={assignment?.target_name ?? null}
                    holderText={
                      assignment?.target_name
                        ? t('dashboard.overduePanel.heldBy', { name: assignment.target_name })
                        : t('dashboard.overduePanel.noHolder')
                    }
                    due={due ? day(due) : null}
                    dueText={due ? t('dashboard.overduePanel.due', { date: day(due) }) : null}
                    badge={t('dashboard.overdueBadge')}
                  />
                );
              })}
            </Panel>
          ) : null}
          {canStock || canRepairs ? (
            <div
              className={cn(
                'flex flex-col gap-6',
                !canAssets && 'xl:col-span-3 xl:grid xl:grid-cols-2',
              )}
            >
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
                      <CardRow
                        key={`${item.kind}-${item.id}`}
                        href={routes.stockView(item.kind, item.id)}
                        icon={PackageMinus}
                        tone={level === 'out' ? 'danger' : 'warning'}
                        primary={item.name}
                        secondary={t(`dashboard.stockPanel.kind.${item.kind}`)}
                        aside={`${t(`stock.level.${level}`)}: ${t('dashboard.stockPanel.left', {
                          count: item.left,
                          min: item.min,
                        })}`}
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
                    <CardRow
                      key={repair.id}
                      href={routes.repairs(repair.id)}
                      icon={Wrench}
                      tone="info"
                      primary={
                        repair.asset_tag ? (
                          <span className="font-tag">{repair.asset_tag}</span>
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
          ) : null}
        </div>
      </section>
    </div>
  );
}

/** Card frame shared by the charts and panels. */
function Card({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm',
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

function CardHeading({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: ReactNode;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <h3 id={id} className="text-md font-semibold text-text">
          {title}
        </h3>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** A count that is a link to the list it was counted from, with a coloured top edge. */
function CountTile({
  spec,
  state,
  note,
}: {
  spec: TileSpec;
  state: CountState;
  note: string | undefined;
}) {
  const { t, formatNumber } = useI18n();
  const tone = TONE[spec.tone];
  return (
    <Link
      href={spec.href}
      aria-busy={state.kind === 'loading'}
      data-testid={`tile-${spec.id}`}
      className="relative flex min-h-28 flex-col gap-1 overflow-hidden rounded-xl border border-border bg-surface p-4 pt-5 shadow-sm transition-colors hover:bg-sunken"
    >
      <span aria-hidden className={cn('absolute inset-x-0 top-0 h-1', tone.bar)} />
      {state.kind === 'loading' ? (
        <>
          <Skeleton className="order-2 h-9 w-20" />
          <span className="sr-only">{t('common.loading')}</span>
        </>
      ) : (
        <span
          data-tile-count=""
          className="order-2 text-3xl leading-tight font-semibold text-text tabular-nums"
        >
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
      {/* the label reads after the number for assistive tech ("12 Assigned") but sits above it */}
      <span className="order-1 inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
        <spec.icon aria-hidden className={cn('size-4 shrink-0', tone.icon)} />
        {t(spec.labelKey)}
      </span>
      {note && state.kind === 'ready' ? (
        <span
          className={cn(
            'order-3 mt-auto w-fit rounded-full px-2 py-0.5 text-xs font-medium',
            spec.id === 'total' ? 'bg-sunken text-muted' : tone.chip,
          )}
        >
          {note}
        </span>
      ) : null}
    </Link>
  );
}

/** The fleet by state type: a donut and a legend whose entries open the matching list. */
function StatusChart({
  states,
  className,
  formatPercent,
}: {
  states: Record<ChartStateType, CountState>;
  className?: string;
  formatPercent: (share: number) => string;
}) {
  const { t, formatNumber } = useI18n();
  const entries = (Object.keys(states) as ChartStateType[]).map((type) => ({
    type,
    name: t(`dashboard.statusChart.states.${type}`),
    count: value(states[type]),
  }));
  const loading = Object.values(states).some((state) => state.kind === 'loading');
  const failed = Object.values(states).some((state) => state.kind === 'error');
  const sum = entries.reduce((acc, entry) => acc + (entry.count ?? 0), 0);

  // donut geometry: one circle per segment, drawn with a dash the length of its share
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const shown = entries.filter((entry) => (entry.count ?? 0) > 0);
  const gap = shown.length > 1 ? 2 : 0;
  let offset = 0;
  const segments = shown.map((entry) => {
    const length = ((entry.count ?? 0) / sum) * circumference;
    const segment = { ...entry, length: Math.max(length - gap, 0.5), offset };
    offset += length;
    return segment;
  });
  const summary = entries
    .map((entry) =>
      t('dashboard.statusChart.segment', {
        name: entry.name,
        count: formatNumber(entry.count ?? 0),
        percent: formatPercent(sum ? (entry.count ?? 0) / sum : 0),
      }),
    )
    .join(', ');

  return (
    <Card
      aria-labelledby="dashboard-status-heading"
      aria-busy={loading}
      data-testid="chart-status"
      className={className}
    >
      <CardHeading
        id="dashboard-status-heading"
        title={t('dashboard.statusChart.title')}
        description={t('dashboard.statusChart.description')}
      />
      {loading ? (
        <div className="flex flex-col items-center gap-6 sm:flex-row">
          <Skeleton className="size-44 rounded-full" />
          <div className="flex w-full flex-1 flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
          <span className="sr-only">{t('common.loading')}</span>
        </div>
      ) : failed ? (
        <p className="py-6 text-base text-muted">{t('dashboard.loadFailed')}</p>
      ) : sum === 0 ? (
        <p className="py-6 text-base text-muted">{t('dashboard.statusChart.empty')}</p>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-6 sm:flex-row sm:gap-10 sm:px-4">
          <div className="relative size-52 shrink-0">
            <svg viewBox="0 0 140 140" role="img" aria-label={summary} className="size-full">
              <circle
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                strokeWidth="18"
                className="stroke-chart-track"
              />
              {segments.map((segment) => (
                <circle
                  key={segment.type}
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  strokeWidth="18"
                  strokeDasharray={`${segment.length} ${circumference - segment.length}`}
                  strokeDashoffset={-segment.offset}
                  transform="rotate(-90 70 70)"
                  className={STATE_COLORS[segment.type].stroke}
                />
              ))}
            </svg>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
            >
              <span className="text-2xl font-semibold text-text tabular-nums">
                {formatNumber(sum)}
              </span>
              <span className="text-xs font-medium tracking-wide text-muted uppercase">
                {t('dashboard.statusChart.center')}
              </span>
            </div>
          </div>
          <ul className="grid w-full flex-1 grid-cols-1 gap-1 sm:grid-cols-2">
            {entries.map((entry) => (
              <li key={entry.type}>
                <Link
                  href={routes.assetsFiltered({ stateType: entry.type })}
                  className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-sunken"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1 size-3 shrink-0 rounded-full',
                      STATE_COLORS[entry.type].fill,
                    )}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-base font-medium text-text">{entry.name}</span>
                    <span className="text-sm text-muted tabular-nums">
                      {formatNumber(entry.count ?? 0)} (
                      {formatPercent(sum ? (entry.count ?? 0) / sum : 0)})
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Checked-out share of usable assets as a gauge, with three fleet-health meters below. */
function UtilisationCard({
  deployed,
  deployable,
  total,
  assigned,
  overdue,
  inRepair,
  loading,
  formatPercent,
}: {
  deployed: number | undefined;
  deployable: number | undefined;
  total: number | undefined;
  assigned: number | undefined;
  overdue: number | undefined;
  inRepair: number | undefined;
  loading: boolean;
  formatPercent: (share: number) => string;
}) {
  const { t, formatNumber } = useI18n();
  const usable = deployed !== undefined && deployable !== undefined ? deployed + deployable : 0;
  const share = ratio(deployed, usable);
  const onTime = ratio(
    assigned !== undefined && overdue !== undefined ? assigned - overdue : undefined,
    assigned,
  );
  const meters: Array<{ key: string; label: string; share: number | undefined; tone: Tone }> = [
    {
      key: 'ready',
      label: t('dashboard.utilisation.meters.ready'),
      share: ratio(deployable, total),
      tone: 'success',
    },
    {
      key: 'onTime',
      label: t('dashboard.utilisation.meters.onTime'),
      share: onTime,
      tone: 'primary',
    },
    {
      key: 'notDeployable',
      label: t('dashboard.utilisation.meters.notDeployable'),
      share: ratio(inRepair, total),
      tone: 'warning',
    },
  ];

  // 270° gauge, open at the bottom: centre (80, 80), radius 62, from 135° round to 45°
  const arc = 'M 36.16 123.84 A 62 62 0 1 1 123.84 123.84';

  return (
    <Card
      aria-labelledby="dashboard-utilisation-heading"
      aria-busy={loading}
      data-testid="chart-utilisation"
    >
      <CardHeading
        id="dashboard-utilisation-heading"
        title={t('dashboard.utilisation.title')}
        description={t('dashboard.utilisation.description')}
      />
      {loading ? (
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="size-40 rounded-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <span className="sr-only">{t('common.loading')}</span>
        </div>
      ) : share === undefined ? (
        <p className="py-6 text-base text-muted">{t('dashboard.utilisation.empty')}</p>
      ) : (
        <>
          <div className="relative mx-auto h-40 w-44">
            <svg
              viewBox="0 0 160 140"
              role="img"
              aria-label={t('dashboard.utilisation.gauge', { percent: formatPercent(share) })}
              className="size-full"
            >
              <path
                d={arc}
                fill="none"
                strokeWidth="14"
                strokeLinecap="round"
                className="stroke-chart-track"
              />
              {share > 0 ? (
                <path
                  d={arc}
                  fill="none"
                  strokeWidth="14"
                  strokeLinecap="round"
                  pathLength={100}
                  strokeDasharray={`${share * 100} 100`}
                  className="stroke-chart-1"
                />
              ) : null}
            </svg>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-2"
            >
              <span className="text-3xl font-semibold text-text tabular-nums">
                {formatPercent(share)}
              </span>
              <span className="text-xs font-medium tracking-wide text-muted uppercase">
                {t('dashboard.utilisation.inUse')}
              </span>
            </div>
          </div>
          <p className="-mt-3 text-center text-sm text-muted">
            {t('dashboard.utilisation.ofUsable', {
              used: formatNumber(deployed ?? 0),
              usable: formatNumber(usable),
            })}
          </p>
          <ul aria-label={t('dashboard.utilisation.meters.label')} className="flex flex-col gap-3">
            {meters.map((meter) => (
              <li key={meter.key} className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-text">{meter.label}</span>
                  <span className={cn('font-semibold tabular-nums', TONE[meter.tone].text)}>
                    {meter.share === undefined ? '-' : formatPercent(meter.share)}
                  </span>
                </span>
                <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-chart-track">
                  <span
                    className={cn('block h-full rounded-full', TONE[meter.tone].bar)}
                    style={{ width: `${Math.round((meter.share ?? 0) * 100)}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
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
  columns,
  extraLink,
  className,
  children,
}: {
  id: string;
  title: string;
  query: Pick<UseQueryResult, 'isPending' | 'isError' | 'refetch'>;
  total: number | undefined;
  count: number;
  href: string;
  empty: string;
  /** Column headings when the rows are laid out as a table (visual only; each cell says what it is). */
  columns?: string[];
  /** A second way on from the card (the overdue card links to the loaner dashboard). */
  extraLink?: { href: string; label: string };
  className?: string;
  children: ReactNode;
}) {
  const { t, formatNumber } = useI18n();
  const headingId = `dashboard-${id}-heading`;
  const hasTotal = total !== undefined && total > 0;
  return (
    <Card
      aria-labelledby={headingId}
      aria-busy={query.isPending}
      data-testid={`panel-${id}`}
      className={className}
    >
      <CardHeading
        id={headingId}
        title={
          <>
            {title}
            {hasTotal ? (
              <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 align-middle text-xs font-medium text-muted tabular-nums">
                {formatNumber(total)}
              </span>
            ) : null}
          </>
        }
      >
        {hasTotal ? (
          <Link
            href={href}
            aria-label={t('dashboard.viewAllNamed', { panel: title })}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-primary-text hover:bg-sunken"
          >
            {t('dashboard.viewAll')}
          </Link>
        ) : null}
      </CardHeading>
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
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
      ) : columns ? (
        <div className="flex flex-col">
          <div
            aria-hidden
            className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] gap-3 rounded-md bg-sunken px-3 py-2 text-xs font-semibold tracking-wide text-muted uppercase md:grid"
          >
            {columns.map((column) => (
              <span key={column}>{column}</span>
            ))}
          </div>
          <ul className="flex flex-col">{children}</ul>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
      {extraLink ? (
        <Link
          href={extraLink.href}
          data-testid={`panel-${id}-link`}
          className="w-fit rounded-sm text-sm text-primary-text underline underline-offset-2"
        >
          {extraLink.label}
        </Link>
      ) : null}
    </Card>
  );
}

/** One overdue check-out as a table row. The visible cells are short; the full phrases are for screen readers. */
function TableRow({
  href,
  tag,
  name,
  holder,
  holderText,
  due,
  dueText,
  badge,
}: {
  href: string;
  tag: string;
  name: string | null;
  holder: string | null;
  holderText: string;
  due: string | null;
  dueText: string | null;
  badge: string;
}) {
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        href={href}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-md px-3 py-2.5 hover:bg-sunken md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto]"
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-tag truncate text-base font-semibold text-text">{tag}</span>
          {name ? <span className="truncate text-sm text-muted">{name}</span> : null}
        </span>
        <span className="col-start-1 truncate text-sm text-muted md:col-start-auto md:text-base md:text-text">
          <span className="sr-only">{holderText}</span>
          <span aria-hidden>{holder ?? holderText}</span>
        </span>
        <span className="col-start-1 text-sm font-medium text-danger-text tabular-nums md:col-start-auto">
          {dueText ? (
            <>
              <span className="sr-only">{dueText}</span>
              <span aria-hidden>{due}</span>
            </>
          ) : null}
        </span>
        <span className="col-start-2 row-span-3 row-start-1 md:col-start-auto md:row-span-1 md:row-start-auto">
          <span className="rounded-full bg-danger-subtle px-2.5 py-0.5 text-xs font-semibold text-danger-text">
            {badge}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** A row drawn as its own small card with a tinted icon, like a service-status list. */
function CardRow({
  href,
  icon: Icon,
  tone,
  primary,
  secondary,
  aside,
}: {
  href: string;
  icon: LucideIcon;
  tone: Tone;
  primary: ReactNode;
  secondary: ReactNode;
  aside: ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-sunken"
      >
        <span
          aria-hidden
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full',
            TONE[tone].chip,
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-medium text-text">{primary}</span>
          <span className="truncate text-sm text-muted">{secondary}</span>
        </span>
        {aside ? (
          <span className={cn('max-w-[45%] text-right text-sm font-medium', TONE[tone].text)}>
            {aside}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
