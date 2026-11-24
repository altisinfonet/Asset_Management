'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ClockAlert,
  Plus,
  Repeat,
  ScanLine,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Banner } from '@/components/ui/banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n, type TranslationKey } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/cn';
import {
  loanersApi,
  type LoanActivity,
  type LoanerPool,
  type OverdueCheckout,
} from '@/lib/loaners/api';
import { poolCounts, sumCounts, type PoolCounts } from '@/lib/loaners/helpers';
import { loanKeys, usePools } from '@/lib/loaners/queries';
import { routes } from '@/lib/routes';

const OVERDUE_PAGE = 10;
const ALL_POOLS = '__all__';
const ACTIVITY_SIZE = 8;

type CountKey = 'available' | 'onLoan' | 'overdue' | 'dueToday';
const SHOW_OF: Record<CountKey, 'available' | 'on_loan' | 'overdue' | 'due_today'> = {
  available: 'available',
  onLoan: 'on_loan',
  overdue: 'overdue',
  dueToday: 'due_today',
};
const LABEL_OF: Record<CountKey, TranslationKey> = {
  available: 'loaners.counts.available',
  onLoan: 'loaners.counts.onLoan',
  overdue: 'loaners.counts.overdue',
  dueToday: 'loaners.counts.dueToday',
};

/**
 * The loaner dashboard (WEB-16, M2-LOAN-04): totals and one card per pool (available, on loan,
 * overdue, due today; each number opens that list in the pool), the overdue loans with the
 * borrower's contact, and what happened lately. The desk and the bulk return are one click away.
 */
export function LoanersScreen() {
  const { t } = useI18n();
  const { can } = useAuth();
  const pools = usePools();
  const list = useMemo(() => pools.data ?? [], [pools.data]);
  const totals = useMemo(() => sumCounts(list), [list]);

  return (
    <>
      <PageTitle title={t('loaners.title')} />
      <PageHeader
        title={t('loaners.title')}
        description={t('loaners.description')}
        actions={
          can('loaner:checkout') ? (
            <>
              <Button asChild variant="primary">
                <Link href={routes.loanerDesk()}>
                  <ScanLine aria-hidden className="size-4" />
                  {t('loaners.deskLink')}
                </Link>
              </Button>
              <Button asChild>
                <Link href={routes.loanerDesk('return')}>
                  <ArrowDownLeft aria-hidden className="size-4" />
                  {t('loaners.bulkReturnLink')}
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      <div className="flex flex-col gap-8">
        {pools.isError ? (
          <Banner
            tone="danger"
            action={<Button onClick={() => void pools.refetch()}>{t('common.retry')}</Button>}
          >
            {t('loaners.loadFailed')}
          </Banner>
        ) : null}

        <section aria-labelledby="loaners-totals" className="flex flex-col gap-3">
          <h2 id="loaners-totals" className="sr-only">
            {t('loaners.totalsLabel')}
          </h2>
          <TotalTiles totals={totals} loading={pools.isPending} />
        </section>

        <section aria-labelledby="loaners-pools" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="loaners-pools" className="text-lg font-semibold text-text">
              {t('loaners.pools.heading')}
            </h2>
            <Button asChild variant="link" size="sm">
              <Link href={routes.loanerPools}>{t('loaners.managePools')}</Link>
            </Button>
          </div>
          {pools.isPending ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : list.length === 0 && !pools.isError ? (
            <div className="rounded-lg border border-border bg-surface">
              <EmptyState
                icon={Repeat}
                title={t('loaners.pools.empty.title')}
                description={t('loaners.pools.empty.description')}
                actions={
                  can('loaner:manage') ? (
                    <Button asChild variant="primary">
                      <Link href={routes.loanerPools}>
                        <Plus aria-hidden className="size-4" />
                        {t('loaners.pools.empty.create')}
                      </Link>
                    </Button>
                  ) : (
                    <p className="text-sm text-muted">{t('loaners.pools.empty.noAccess')}</p>
                  )
                }
              />
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((pool) => (
                <li key={pool.id}>
                  <PoolCard pool={pool} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <OverdueSection pools={list} />
        <ActivitySection />
      </div>
    </>
  );
}

function TotalTiles({ totals, loading }: { totals: PoolCounts; loading: boolean }) {
  const { t, formatNumber } = useI18n();
  const tiles: Array<{ key: string; label: TranslationKey; value: number; tone?: string }> = [
    { key: 'inPool', label: 'loaners.counts.inPool', value: totals.total },
    { key: 'available', label: 'loaners.counts.available', value: totals.available },
    { key: 'onLoan', label: 'loaners.counts.onLoan', value: totals.onLoan },
    {
      key: 'overdue',
      label: 'loaners.counts.overdue',
      value: totals.overdue,
      tone: totals.overdue > 0 ? 'text-danger-text' : undefined,
    },
  ];
  return (
    <ul className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {tiles.map((tile) => (
        <li
          key={tile.key}
          data-testid={`loaner-total-${tile.key}`}
          className="flex min-h-24 flex-col gap-1 rounded-lg border border-border bg-surface p-4"
        >
          {loading ? (
            <Skeleton className="h-9 w-16" />
          ) : (
            <span
              className={cn(
                'text-3xl leading-tight font-semibold tabular-nums',
                tile.tone ?? 'text-text',
              )}
            >
              {formatNumber(tile.value)}
            </span>
          )}
          <span className="text-sm text-muted">{t(tile.label)}</span>
        </li>
      ))}
    </ul>
  );
}

const COUNT_ICONS: Partial<Record<CountKey, LucideIcon>> = {
  overdue: ClockAlert,
  onLoan: ArrowUpRight,
  available: ArrowDownLeft,
};

/** One pool: its name, size and the four numbers, each a link to the matching devices. */
function PoolCard({ pool }: { pool: LoanerPool }) {
  const { t, formatNumber } = useI18n();
  const counts = poolCounts(pool);
  const keys: CountKey[] = ['available', 'onLoan', 'overdue', 'dueToday'];
  return (
    <article
      aria-labelledby={`pool-${pool.id}`}
      data-testid={`pool-card-${pool.id}`}
      className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`pool-${pool.id}`} className="text-base font-semibold text-text">
            <Link
              href={routes.loanerPool(pool.id)}
              aria-label={t('loaners.pools.open', { name: pool.name })}
              className="rounded-sm text-primary-text underline underline-offset-2"
            >
              {pool.name}
            </Link>
          </h3>
          <p className="text-sm text-muted">
            {t('loaners.pools.devices', { count: counts.total })}
          </p>
        </div>
        {pool.is_active === false ? <Badge>{t('loaners.pools.switchedOff')}</Badge> : null}
      </header>
      <ul className="grid grid-cols-2 gap-2">
        {keys.map((key) => {
          const Icon = COUNT_ICONS[key];
          const value = counts[key];
          const alarming = (key === 'overdue' && value > 0) || (key === 'dueToday' && value > 0);
          return (
            <li key={key}>
              <Link
                href={routes.loanerPool(pool.id, SHOW_OF[key])}
                data-testid={`pool-${pool.id}-${key}`}
                className="flex min-h-14 flex-col rounded-md border border-border px-3 py-2 hover:bg-sunken"
              >
                <span
                  className={cn(
                    'order-1 text-2xl leading-tight font-semibold tabular-nums',
                    key === 'overdue' && value > 0
                      ? 'text-danger-text'
                      : key === 'dueToday' && value > 0
                        ? 'text-warning-text'
                        : 'text-text',
                  )}
                >
                  {formatNumber(value)}
                </span>
                <span className="order-2 inline-flex items-center gap-1.5 text-sm text-muted">
                  {Icon && alarming ? <Icon aria-hidden className="size-3.5" /> : null}
                  {t(LABEL_OF[key])}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function OverdueSection({ pools }: { pools: LoanerPool[] }) {
  const { t, formatDate, formatNumber } = useI18n();
  const [poolFilter, setPoolFilter] = useState(ALL_POOLS);
  const query = useInfiniteQuery({
    queryKey: [...loanKeys.overdue, poolFilter],
    queryFn: ({ pageParam }) =>
      loanersApi.overdue({
        limit: OVERDUE_PAGE,
        sort: ['expected_return'],
        ...(poolFilter !== ALL_POOLS ? { loaner_pool_id: poolFilter } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (last) =>
      last.page.has_more ? (last.page.next_cursor ?? undefined) : undefined,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
  const day = (value: string) => formatDate(`${value}T00:00:00Z`, { timeZone: 'UTC' });
  const poolName = (id: string | null | undefined) =>
    pools.find((pool) => pool.id === id)?.name ?? t('loaners.overdue.noPool');

  const columns: DataTableColumn<OverdueCheckout>[] = [
    {
      id: 'device',
      header: t('loaners.overdue.columns.device'),
      sticky: true,
      cell: (row) => (
        <Link
          href={routes.assetView(row.asset_id)}
          className="rounded-sm font-tag text-primary-text underline underline-offset-2"
        >
          {row.asset_tag}
          {row.asset_name ? <span className="sr-only">{`, ${row.asset_name}`}</span> : null}
        </Link>
      ),
    },
    {
      id: 'borrower',
      header: t('loaners.overdue.columns.borrower'),
      cell: (row) =>
        row.person_id && row.person_name ? (
          <Link
            href={routes.personView(row.person_id)}
            className="rounded-sm text-primary-text underline underline-offset-2"
          >
            {row.person_name}
          </Link>
        ) : (
          <span className="text-muted">{t('loaners.overdue.noBorrower')}</span>
        ),
    },
    {
      id: 'contact',
      header: t('loaners.overdue.columns.contact'),
      cell: (row) =>
        row.person_email || row.person_phone ? (
          <span className="flex flex-col">
            {row.person_email ? (
              <a
                href={`mailto:${row.person_email}`}
                className="rounded-sm text-primary-text underline underline-offset-2"
              >
                {row.person_email}
              </a>
            ) : null}
            {row.person_phone ? <span>{row.person_phone}</span> : null}
          </span>
        ) : (
          <span className="text-muted">{t('loaners.overdue.noContact')}</span>
        ),
    },
    {
      id: 'pool',
      header: t('loaners.overdue.columns.pool'),
      cell: (row) => poolName(row.loaner_pool_id),
    },
    {
      id: 'due',
      header: t('loaners.overdue.columns.due'),
      cell: (row) => day(row.expected_return),
    },
    {
      id: 'late',
      header: t('loaners.overdue.columns.late'),
      cell: (row) => (
        <Badge tone="danger" icon={ClockAlert}>
          {t('loaners.overdue.late', { count: row.days_overdue })}
        </Badge>
      ),
    },
  ];

  return (
    <section aria-labelledby="loaners-overdue" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="loaners-overdue" className="text-lg font-semibold text-text">
          {t('loaners.overdue.heading')}
        </h2>
        {pools.length > 1 ? (
          <Select
            size="sm"
            className="min-w-48"
            aria-label={t('loaners.overdue.poolFilter')}
            value={poolFilter}
            onValueChange={setPoolFilter}
            options={[
              { value: ALL_POOLS, label: t('loaners.overdue.allPools') },
              ...pools.map((pool) => ({ value: pool.id, label: pool.name })),
            ]}
          />
        ) : null}
      </div>
      {query.isError && rows.length === 0 ? (
        <Banner
          tone="danger"
          action={<Button onClick={() => void query.refetch()}>{t('common.retry')}</Button>}
        >
          {t('loaners.overdue.loadFailed')}
        </Banner>
      ) : null}
      <DataTable
        label={t('loaners.overdue.tableLabel')}
        columns={columns}
        rows={rows}
        getRowId={(row) => row.assignment_id}
        getRowLabel={(row) => row.asset_tag}
        loading={query.isPending}
        skeletonRows={3}
        empty={
          <p className="px-4 py-6 text-base text-muted" data-testid="loaners-overdue-empty">
            {t('loaners.overdue.empty')}
          </p>
        }
      />
      {query.hasNextPage ? (
        <div>
          <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {t('loaners.overdue.showMore')}
          </Button>
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {formatNumber(rows.length)}
      </p>
    </section>
  );
}

function ActivitySection() {
  const { t, formatDateTime, formatDate } = useI18n();
  const query = useQuery({
    queryKey: loanKeys.activity,
    queryFn: () => loanersApi.activity({ limit: ACTIVITY_SIZE }),
    select: (page) => page.data,
  });
  const text = (item: LoanActivity) => {
    const tag = item.asset_tag;
    if (item.kind === 'checked_out') {
      return item.person_name
        ? t('loaners.activity.lent', { tag, name: item.person_name })
        : t('loaners.activity.lentAnonymous', { tag });
    }
    return item.person_name
      ? t('loaners.activity.returned', { tag, name: item.person_name })
      : t('loaners.activity.returnedAnonymous', { tag });
  };
  return (
    <section aria-labelledby="loaners-activity" className="flex flex-col gap-3">
      <h2 id="loaners-activity" className="text-lg font-semibold text-text">
        {t('loaners.activity.heading')}
      </h2>
      {query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError ? (
        <Banner
          tone="danger"
          action={<Button onClick={() => void query.refetch()}>{t('common.retry')}</Button>}
        >
          {t('loaners.activity.loadFailed')}
        </Banner>
      ) : query.data.length === 0 ? (
        <p className="text-base text-muted">{t('loaners.activity.empty')}</p>
      ) : (
        <ul className="flex flex-col rounded-lg border border-border bg-surface">
          {query.data.map((item) => {
            const Icon = item.kind === 'checked_out' ? ArrowUpRight : ArrowDownLeft;
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border px-3 py-2 first:border-t-0"
              >
                <Icon aria-hidden className="size-4 shrink-0 text-muted" />
                <Link
                  href={routes.assetView(item.asset_id)}
                  className="rounded-sm text-base text-text hover:underline"
                >
                  {text(item)}
                </Link>
                {item.kind === 'checked_out' && item.expected_return ? (
                  <span className="text-sm text-muted">
                    {t('loaners.activity.due', {
                      date: formatDate(`${item.expected_return}T00:00:00Z`, { timeZone: 'UTC' }),
                    })}
                  </span>
                ) : null}
                <time dateTime={item.at} className="ml-auto text-sm text-muted">
                  {formatDateTime(item.at)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
