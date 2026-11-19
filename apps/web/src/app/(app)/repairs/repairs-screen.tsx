'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Wrench } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { LogRepairDialog } from '@/components/repairs/repair-dialogs';
import { RepairDrawer } from '@/components/repairs/repair-drawer';
import { RepairTable, useMoneyText } from '@/components/repairs/repair-parts';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { useLookups } from '@/lib/registry/queries';
import {
  REPAIR_KINDS,
  REPAIR_STATUSES,
  repairsApi,
  type RepairKind,
  type RepairQuery,
  type RepairStatus,
} from '@/lib/repairs/api';
import { CLOSED_STATUSES, OPEN_STATUSES, dayToInstant, totalCost } from '@/lib/repairs/helpers';
import { routes } from '@/lib/routes';

const ALL = '__all__';
const PAGE_SIZE = 50;

type Scope = 'open' | 'closed' | 'all';

interface Filters {
  scope: Scope;
  status: string;
  kind: string;
  vendor: string;
  from: string;
  to: string;
}
const DEFAULT: Filters = { scope: 'open', status: '', kind: '', vendor: '', from: '', to: '' };

function toQuery(filters: Filters, cursor?: string): RepairQuery {
  const statuses: RepairStatus[] = filters.status
    ? [filters.status as RepairStatus]
    : filters.scope === 'open'
      ? OPEN_STATUSES
      : filters.scope === 'closed'
        ? CLOSED_STATUSES
        : [];
  return {
    limit: PAGE_SIZE,
    include_total: true,
    sort: ['-reported_at'],
    ...(cursor ? { cursor } : {}),
    ...(statuses.length > 0 ? { status: statuses } : {}),
    ...(filters.kind ? { kind: [filters.kind as RepairKind] } : {}),
    ...(filters.vendor ? { vendor_id: filters.vendor } : {}),
    ...(filters.from ? { reported_from: dayToInstant(filters.from) } : {}),
    ...(filters.to ? { reported_to: dayToInstant(filters.to).replace('T12', 'T23') } : {}),
  };
}

/**
 * The tenant-wide repair log (WEB-17, M2-MNT-02): open and closed repairs with their counts,
 * filters (status, kind, supplier, dates), the cost of what is shown, and a drawer per repair with
 * its receipts. "Log repair" opens the same dialog as an asset's Repairs tab.
 */
export function RepairsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const lookups = useLookups();
  const money = useMoneyText();
  const [filters, setFilters] = useState<Filters>(DEFAULT);
  const [cursors, setCursors] = useState<string[]>([]);
  const [logging, setLogging] = useState(false);
  const openId = params.get('id');

  const update = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setCursors([]);
  };

  const cursor = cursors[cursors.length - 1];
  const query = toQuery(filters, cursor);
  const list = useQuery({
    queryKey: ['repairs', 'list', query],
    queryFn: () => repairsApi.list(query),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => list.data?.data ?? [], [list.data]);
  const total = list.data?.page.total;
  const pageStart = cursors.length * PAGE_SIZE;

  // The counts in the tab labels.
  const counts = useQuery({
    queryKey: ['repairs', 'counts'],
    queryFn: async () => {
      const [open, closed] = await Promise.all([
        repairsApi.list({ limit: 1, include_total: true, status: OPEN_STATUSES }),
        repairsApi.list({ limit: 1, include_total: true, status: CLOSED_STATUSES }),
      ]);
      return { open: open.page.total ?? 0, closed: closed.page.total ?? 0 };
    },
    staleTime: 15_000,
  });

  const filtered = !!(
    filters.status ||
    filters.kind ||
    filters.vendor ||
    filters.from ||
    filters.to
  );
  const totals = totalCost(rows.filter((repair) => repair.status !== 'cancelled'));
  const amount = totals.map((value) => money(value)).join(', ');
  const loadFailed = list.error && !list.data;

  const setDrawer = (id: string | null) => router.replace(routes.repairs(id ?? undefined));

  return (
    <>
      <PageTitle title={t('repairs.title')} />
      <PageHeader
        title={t('repairs.title')}
        description={t('repairs.description')}
        actions={
          can('repair:manage') ? (
            <Button variant="primary" onClick={() => setLogging(true)}>
              <Plus aria-hidden className="size-4" />
              {t('repairs.log')}
            </Button>
          ) : null
        }
      />

      <Tabs value={filters.scope} onValueChange={(v) => update({ scope: v as Scope, status: '' })}>
        <TabsList aria-label={t('repairs.tabsLabel')}>
          <TabsTrigger value="open" count={counts.data?.open}>
            {t('repairs.tabs.open')}
          </TabsTrigger>
          <TabsTrigger value="closed" count={counts.data?.closed}>
            {t('repairs.tabs.closed')}
          </TabsTrigger>
          <TabsTrigger value="all">{t('repairs.tabs.all')}</TabsTrigger>
        </TabsList>
        <TabsContent value={filters.scope} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-44 flex-col gap-1.5 text-sm font-medium">
              {t('repairs.filters.status')}
              <Select
                aria-label={t('repairs.filters.status')}
                value={filters.status || ALL}
                onValueChange={(v) => update({ status: v === ALL ? '' : v })}
                options={[
                  { value: ALL, label: t('repairs.filters.anyStatus') },
                  ...REPAIR_STATUSES.filter(
                    (s) =>
                      filters.scope === 'all' ||
                      (filters.scope === 'open' ? OPEN_STATUSES : CLOSED_STATUSES).includes(s),
                  ).map((s) => ({ value: s, label: t(`repairs.status.${s}`) })),
                ]}
              />
            </label>
            <label className="flex min-w-44 flex-col gap-1.5 text-sm font-medium">
              {t('repairs.filters.kind')}
              <Select
                aria-label={t('repairs.filters.kind')}
                value={filters.kind || ALL}
                onValueChange={(v) => update({ kind: v === ALL ? '' : v })}
                options={[
                  { value: ALL, label: t('repairs.filters.anyKind') },
                  ...REPAIR_KINDS.map((k) => ({ value: k, label: t(`repairs.kinds.${k}`) })),
                ]}
              />
            </label>
            <label className="flex min-w-44 flex-col gap-1.5 text-sm font-medium">
              {t('repairs.filters.vendor')}
              <Select
                aria-label={t('repairs.filters.vendor')}
                value={filters.vendor || ALL}
                onValueChange={(v) => update({ vendor: v === ALL ? '' : v })}
                options={[
                  { value: ALL, label: t('repairs.filters.anyVendor') },
                  ...lookups.vendors
                    .filter((v) => !v.archived_at)
                    .map((v) => ({ value: v.id, label: v.name })),
                ]}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t('repairs.filters.from')}
              <Input
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(event) => update({ from: event.target.value })}
                className="w-40"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t('repairs.filters.to')}
              <Input
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(event) => update({ to: event.target.value })}
                className="w-40"
              />
            </label>
            {filtered ? (
              <Button
                size="sm"
                variant="link"
                onClick={() => {
                  setFilters((current) => ({ ...DEFAULT, scope: current.scope }));
                  setCursors([]);
                }}
              >
                {t('repairs.filters.clear')}
              </Button>
            ) : null}
          </div>

          {loadFailed ? (
            <Banner
              tone="danger"
              action={<Button onClick={() => void list.refetch()}>{t('common.retry')}</Button>}
            >
              {t('repairs.loadFailed')}
            </Banner>
          ) : null}

          <RepairTable
            rows={rows}
            loading={list.isLoading}
            showAsset
            label={t('repairs.tableLabel')}
            className={list.isPlaceholderData ? 'opacity-60' : undefined}
            onOpen={(repair) => setDrawer(repair.id)}
            empty={
              filtered || filters.scope !== 'open' ? (
                <EmptyState
                  icon={Wrench}
                  title={t('repairs.empty.noMatchTitle')}
                  description={t('repairs.empty.noMatchDescription')}
                />
              ) : (
                <EmptyState
                  icon={Wrench}
                  title={t('repairs.empty.title')}
                  description={t('repairs.empty.description')}
                  actions={
                    can('repair:manage') ? (
                      <Button variant="primary" onClick={() => setLogging(true)}>
                        <Plus aria-hidden className="size-4" />
                        {t('repairs.log')}
                      </Button>
                    ) : undefined
                  }
                />
              )
            }
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <p
                role="status"
                aria-live="polite"
                className="text-sm text-muted"
                data-testid="repairs-range"
              >
                {rows.length === 0
                  ? ''
                  : total !== undefined && total !== null
                    ? t('repairs.range', {
                        from: pageStart + 1,
                        to: pageStart + rows.length,
                        total,
                      })
                    : t('repairs.rangeNoTotal', {
                        from: pageStart + 1,
                        to: pageStart + rows.length,
                      })}
              </p>
              {rows.length > 0 ? (
                <p className="text-sm" data-testid="repairs-total">
                  {amount
                    ? t(totals.length > 1 ? 'repairs.totalsMixed' : 'repairs.totals', { amount })
                    : t('repairs.noCost')}
                </p>
              ) : null}
            </div>
            <nav aria-label={t('repairs.pagination')} className="flex gap-2">
              <Button
                size="sm"
                disabled={cursors.length === 0}
                onClick={() => setCursors((c) => c.slice(0, -1))}
              >
                <ChevronLeft aria-hidden className="size-4" />
                {t('repairs.previous')}
              </Button>
              <Button
                size="sm"
                disabled={!list.data?.page.has_more || !list.data.page.next_cursor}
                onClick={() => {
                  const next = list.data?.page.next_cursor;
                  if (next) setCursors((c) => [...c, next]);
                }}
              >
                {t('repairs.next')}
                <ChevronRight aria-hidden className="size-4" />
              </Button>
            </nav>
          </div>
        </TabsContent>
      </Tabs>

      <LogRepairDialog open={logging} onOpenChange={setLogging} />
      <RepairDrawer repairId={openId} onClose={() => setDrawer(null)} />
    </>
  );
}
