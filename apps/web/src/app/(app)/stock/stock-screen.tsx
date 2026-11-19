'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, LogOut, PackagePlus, Plus, Boxes } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { LocationPicker } from '@/components/registry/location-picker';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { StockFormDialog } from '@/components/stock/stock-form-dialog';
import {
  CheckoutAccessoryDialog,
  MovementDialog,
  type MovementMode,
} from '@/components/stock/stock-dialogs';
import { StockLevelBadge, useStockCategories } from '@/components/stock/stock-parts';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { useLookups } from '@/lib/registry/queries';
import type { Page } from '@/lib/registry/types';
import { routes } from '@/lib/routes';
import {
  accessoriesApi,
  consumablesApi,
  type Accessory,
  type Consumable,
  type StockKind,
} from '@/lib/stock/api';
import { levelOf, unitsLeft } from '@/lib/stock/helpers';
import { useDebounced } from '@/lib/use-debounced';

const ALL = '__all__';
const PAGE_SIZE = 50;
const KINDS: StockKind[] = ['accessory', 'consumable'];

const READ_PERMISSION: Record<StockKind, string> = {
  accessory: 'accessory:read',
  consumable: 'consumable:read',
};
const MANAGE_PERMISSION: Record<StockKind, string> = {
  accessory: 'accessory:manage',
  consumable: 'consumable:manage',
};

/**
 * Accessories and consumables (WEB-19, M2-ACC-04): one screen with a tab for each kind. Each list
 * has server-side search, category / location / low-stock filters and cursor pagination, shows the
 * stock level with an icon and words, and offers the everyday action on the row (check out, receive,
 * use); everything else is on the item's page.
 */
export function StockScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const [creating, setCreating] = useState<StockKind | null>(null);
  const allowed = KINDS.filter((kind) => can(READ_PERMISSION[kind]));
  const requested = params.get('kind');
  const kind: StockKind =
    allowed.find((candidate) => candidate === requested) ?? allowed[0] ?? 'accessory';

  const setKind = (next: string) => router.replace(routes.stock(next as StockKind));

  return (
    <>
      <PageTitle title={t('stock.title')} />
      <PageHeader
        title={t('stock.title')}
        description={t('stock.description')}
        actions={
          can(MANAGE_PERMISSION[kind]) ? (
            <Button variant="primary" onClick={() => setCreating(kind)}>
              <Plus aria-hidden className="size-4" />
              {kind === 'accessory' ? t('stock.newItem.accessory') : t('stock.newItem.consumable')}
            </Button>
          ) : null
        }
      />
      <Tabs value={kind} onValueChange={setKind}>
        <TabsList aria-label={t('stock.tabsLabel')}>
          {allowed.map((candidate) => (
            <TabsTrigger key={candidate} value={candidate}>
              {t(`stock.tabs.${candidate}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {allowed.map((candidate) => (
          <TabsContent key={candidate} value={candidate}>
            <StockList kind={candidate} onCreate={() => setCreating(candidate)} />
          </TabsContent>
        ))}
      </Tabs>
      <StockFormDialog
        open={creating !== null}
        onOpenChange={(open) => !open && setCreating(null)}
        kind={creating ?? kind}
        onSaved={(id) => router.push(routes.stockView(creating ?? kind, id))}
      />
    </>
  );
}

interface Filters {
  q: string;
  category_id: string;
  location_id: string;
  low: boolean;
}
const NO_FILTERS: Filters = { q: '', category_id: '', location_id: '', low: false };

function StockList({ kind, onCreate }: { kind: StockKind; onCreate: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const { can } = useAuth();
  const lookups = useLookups();
  const categories = useStockCategories(kind);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [searchText, setSearchText] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [checkout, setCheckout] = useState<Accessory | null>(null);
  const [movement, setMovement] = useState<{ item: Consumable; mode: MovementMode } | null>(null);

  const update = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setCursors([]);
  };
  const debounced = useDebounced(searchText, 300);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- debounced text drives the query
    setFilters((current) => (current.q === debounced ? current : { ...current, q: debounced }));
    setCursors([]);
  }, [debounced]);

  const cursor = cursors[cursors.length - 1];
  const query = {
    limit: PAGE_SIZE,
    include_total: true,
    ...(cursor ? { cursor } : {}),
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.category_id ? { category_id: filters.category_id } : {}),
    ...(filters.location_id ? { location_id: filters.location_id } : {}),
    ...(filters.low ? { low_stock: true } : {}),
  };
  const list = useQuery<Page<Accessory | Consumable>>({
    queryKey: ['stock', kind, 'list', query],
    queryFn: () => (kind === 'accessory' ? accessoriesApi.list(query) : consumablesApi.list(query)),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo<Array<Accessory | Consumable>>(() => list.data?.data ?? [], [list.data]);
  const total = list.data?.page.total;
  const pageStart = cursors.length * PAGE_SIZE;
  const filtered = !!(filters.q || filters.category_id || filters.location_id || filters.low);
  const lowCount = rows.filter((row) => levelOf(row, kind) !== 'ok').length;

  const link = (row: Accessory | Consumable) => routes.stockView(kind, row.id);

  const columns = useMemo<DataTableColumn<Accessory | Consumable>[]>(() => {
    const name: DataTableColumn<Accessory | Consumable> = {
      id: 'name',
      header: t('stock.columns.name'),
      sticky: true,
      cell: (row) => (
        <Link
          href={link(row)}
          onClick={(event) => event.stopPropagation()}
          className="rounded-sm text-primary-text underline underline-offset-2"
        >
          {row.name}
        </Link>
      ),
    };
    const category: DataTableColumn<Accessory | Consumable> = {
      id: 'category',
      header: t('stock.columns.category'),
      cell: (row) => lookupCategory(categories.data, row.category_id),
    };
    const level: DataTableColumn<Accessory | Consumable> = {
      id: 'level',
      header: t('stock.columns.level'),
      cell: (row) => (
        <StockLevelBadge available={unitsLeft(row, kind)} minimum={row.min_qty ?? 0} />
      ),
    };
    const minimum: DataTableColumn<Accessory | Consumable> = {
      id: 'minimum',
      header: t('stock.columns.minimum'),
      align: 'end',
      cell: (row) => row.min_qty ?? 0,
    };
    const location: DataTableColumn<Accessory | Consumable> = {
      id: 'location',
      header: t('stock.columns.location'),
      cell: (row) => lookups.locationLabel(row.location_id),
    };
    const actions: DataTableColumn<Accessory | Consumable> = {
      id: 'actions',
      header: t('stock.columns.actions'),
      srOnlyHeader: true,
      align: 'end',
      cell: (row) =>
        kind === 'accessory' ? (
          can('accessory:checkout') ? (
            <Button
              size="sm"
              aria-label={t('stock.rowActions.checkOutNamed', { name: row.name })}
              disabled={((row as Accessory).qty_available ?? 0) < 1}
              onClick={(event) => {
                event.stopPropagation();
                setCheckout(row as Accessory);
              }}
            >
              <LogOut aria-hidden className="size-4" />
              {t('stock.rowActions.checkOut')}
            </Button>
          ) : null
        ) : can('consumable:adjust') ? (
          <span className="inline-flex gap-1.5">
            <Button
              size="sm"
              aria-label={t('stock.rowActions.receiveNamed', { name: row.name })}
              onClick={(event) => {
                event.stopPropagation();
                setMovement({ item: row as Consumable, mode: 'receive' });
              }}
            >
              <PackagePlus aria-hidden className="size-4" />
              {t('stock.rowActions.receive')}
            </Button>
            <Button
              size="sm"
              aria-label={t('stock.rowActions.consumeNamed', { name: row.name })}
              disabled={((row as Consumable).qty_on_hand ?? 0) < 1}
              onClick={(event) => {
                event.stopPropagation();
                setMovement({ item: row as Consumable, mode: 'consume' });
              }}
            >
              {t('stock.rowActions.consume')}
            </Button>
          </span>
        ) : null,
    };
    if (kind === 'accessory') {
      return [
        name,
        category,
        {
          id: 'total',
          header: t('stock.columns.total'),
          align: 'end',
          cell: (row) => (row as Accessory).qty_total,
        },
        {
          id: 'out',
          header: t('stock.columns.out'),
          align: 'end',
          cell: (row) => (row as Accessory).qty_checked_out,
        },
        {
          id: 'available',
          header: t('stock.columns.available'),
          align: 'end',
          cell: (row) => (row as Accessory).qty_available,
        },
        level,
        minimum,
        location,
        actions,
      ];
    }
    return [
      name,
      category,
      {
        id: 'onHand',
        header: t('stock.columns.onHand'),
        align: 'end',
        cell: (row) =>
          `${(row as Consumable).qty_on_hand} ${(row as Consumable).unit ?? ''}`.trim(),
      },
      level,
      minimum,
      location,
      actions,
    ];
    // `link` only depends on `kind`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, kind, can, categories.data, lookups]);

  const loadFailed = list.error && !list.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-medium">
          {t('stock.search')}
          <Input
            type="search"
            value={searchText}
            placeholder={t('stock.searchPlaceholder')}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </label>
        <label className="flex min-w-44 flex-col gap-1.5 text-sm font-medium">
          {t('stock.filters.category')}
          <Select
            aria-label={t('stock.filters.category')}
            value={filters.category_id || ALL}
            onValueChange={(v) => update({ category_id: v === ALL ? '' : v })}
            options={[
              { value: ALL, label: t('stock.filters.allCategories') },
              ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </label>
        <div className="flex min-w-56 flex-col gap-1.5 text-sm font-medium">
          <label htmlFor={`stock-location-${kind}`}>{t('stock.filters.location')}</label>
          <LocationPicker
            id={`stock-location-${kind}`}
            clearable
            value={filters.location_id}
            placeholder={t('stock.filters.allLocations')}
            onChange={(id) => update({ location_id: id })}
          />
        </div>
        <Checkbox
          label={t('stock.filters.lowOnly')}
          checked={filters.low}
          onCheckedChange={(v) => update({ low: v === true })}
        />
        {filtered ? (
          <Button
            size="sm"
            variant="link"
            onClick={() => {
              setSearchText('');
              setFilters(NO_FILTERS);
              setCursors([]);
            }}
          >
            {t('stock.filters.clear')}
          </Button>
        ) : null}
      </div>

      {loadFailed ? (
        <Banner
          tone="danger"
          action={<Button onClick={() => void list.refetch()}>{t('common.retry')}</Button>}
        >
          {t('stock.loadFailed')}
        </Banner>
      ) : null}
      {!filters.low && lowCount > 0 ? (
        <Banner tone="warning">
          <span data-testid="stock-low-banner">
            {t('stock.lowStockBanner', { count: lowCount })}
          </span>
        </Banner>
      ) : null}

      <DataTable
        label={t(`stock.tableLabel.${kind}`)}
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        onRowOpen={(row) => router.push(link(row))}
        onRowClick={(row) => router.push(link(row))}
        loading={list.isLoading}
        className={list.isPlaceholderData ? 'opacity-60' : undefined}
        empty={
          filtered ? (
            <EmptyState
              icon={Boxes}
              title={t('stock.empty.none.title')}
              description={t('stock.empty.none.description')}
            />
          ) : (
            <EmptyState
              icon={Boxes}
              title={
                kind === 'accessory'
                  ? t('stock.empty.accessory.title')
                  : t('stock.empty.consumable.title')
              }
              description={
                kind === 'accessory'
                  ? t('stock.empty.accessory.description')
                  : t('stock.empty.consumable.description')
              }
              actions={
                can(MANAGE_PERMISSION[kind]) ? (
                  <Button variant="primary" onClick={onCreate}>
                    <Plus aria-hidden className="size-4" />
                    {kind === 'accessory'
                      ? t('stock.newItem.accessory')
                      : t('stock.newItem.consumable')}
                  </Button>
                ) : undefined
              }
            />
          )
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-muted"
          data-testid="stock-range"
        >
          {rows.length === 0
            ? ''
            : total !== undefined && total !== null
              ? t('stock.range', { from: pageStart + 1, to: pageStart + rows.length, total })
              : t('stock.rangeNoTotal', { from: pageStart + 1, to: pageStart + rows.length })}
        </p>
        <nav aria-label={t('stock.pagination')} className="flex gap-2">
          <Button
            size="sm"
            disabled={cursors.length === 0}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            <ChevronLeft aria-hidden className="size-4" />
            {t('stock.previous')}
          </Button>
          <Button
            size="sm"
            disabled={!list.data?.page.has_more || !list.data.page.next_cursor}
            onClick={() => {
              const next = list.data?.page.next_cursor;
              if (next) setCursors((c) => [...c, next]);
            }}
          >
            {t('stock.next')}
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </nav>
      </div>

      <CheckoutAccessoryDialog
        open={checkout !== null}
        onOpenChange={(open) => !open && setCheckout(null)}
        accessory={checkout}
      />
      <MovementDialog
        open={movement !== null}
        onOpenChange={(open) => !open && setMovement(null)}
        consumable={movement?.item ?? null}
        mode={movement?.mode ?? 'receive'}
      />
    </div>
  );
}

function lookupCategory(
  categories: ReadonlyArray<{ id: string; name: string }> | undefined,
  id: string,
): string {
  return categories?.find((category) => category.id === id)?.name ?? '';
}
