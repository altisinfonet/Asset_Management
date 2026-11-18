'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
  Package,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AssetDetails, AssetStatusBadge } from '@/components/registry/asset-details';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { FormDialog } from '@/components/registry/form-dialog';
import { Banner } from '@/components/ui/banner';
import { Button, IconButton } from '@/components/ui/button';
import {
  BulkActionBar,
  DataTable,
  type DataTableColumn,
  type SortState,
} from '@/components/ui/data-table';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { assetsApi } from '@/lib/registry/api';
import {
  COLUMN_BY_SORT_KEY,
  PAGE_SIZE,
  SORT_KEY_BY_COLUMN,
  defaultViewState,
  deleteView,
  hasActiveFilters,
  readSavedViews,
  saveView,
  toAssetQuery,
  type AssetViewState,
  type SavedView,
} from '@/lib/registry/asset-view';
import { runBulk, type BulkItem, type BulkResult } from '@/lib/registry/bulk';
import { formatValue } from '@/lib/registry/custom-fields';
import { useLookups, type Lookups } from '@/lib/registry/queries';
import type { Asset } from '@/lib/registry/types';
import { routes } from '@/lib/routes';
import { useDebounced } from '@/lib/use-debounced';
import { BulkEditDialog, BulkResultsDialog, type BulkEditPatch } from './bulk-dialogs';
import { ColumnsDialog } from './columns-dialog';
import { uiErrorText } from '@/lib/error-text';

const ALL = '__all__';
const DEFAULT_VIEW = '__default__';

/**
 * Assets list (WEB-04): server-side search, filters (status, category, location, archived and one
 * custom field), sort and cursor pagination; a column picker; saved views kept in this browser;
 * row selection with bulk edit / archive / restore; a 480px quick-view drawer on row click and the
 * full page on Enter. Keyboard: arrows move between rows, Space selects, Enter opens.
 */
export function AssetsTable() {
  const i18n = useI18n();
  const { t } = i18n;
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const lookups = useLookups();

  const [state, setState] = useState<AssetViewState>(defaultViewState);
  const [searchText, setSearchText] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<Asset | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeView, setActiveView] = useState(DEFAULT_VIEW);
  const [saveOpen, setSaveOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<{ title: string; results: BulkResult[] } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage
    setViews(readSavedViews());
  }, []);

  /** Any change of search, filters or sort starts again from page one with nothing selected. */
  const update = useCallback((patch: Partial<AssetViewState>) => {
    setState((current) => ({ ...current, ...patch }));
    setCursors([]);
    setSelected(new Set());
  }, []);

  const debouncedSearch = useDebounced(searchText, 300);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- debounced text drives the query
    update({ q: debouncedSearch });
  }, [debouncedSearch, update]);

  const cursor = cursors[cursors.length - 1];
  const query = toAssetQuery(state, cursor);
  const list = useQuery({
    queryKey: ['assets', 'list', query],
    queryFn: () => assetsApi.list(query),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => list.data?.data ?? [], [list.data]);
  const total = list.data?.page.total;
  const pageStart = cursors.length * PAGE_SIZE;

  const refreshList = () => queryClient.invalidateQueries({ queryKey: ['assets'] });

  // ---- columns ------------------------------------------------------------------------------------
  const columns = useMemo<DataTableColumn<Asset>[]>(() => {
    const copyTag = async (tag: string) => {
      try {
        await navigator.clipboard.writeText(tag);
        toast({ variant: 'success', title: t('assets.tagCopied', { tag }) });
      } catch {
        toast({ variant: 'danger', title: t('assets.tagCopyFailed') });
      }
    };
    const byId: Record<string, DataTableColumn<Asset>> = {
      tag: {
        id: 'tag',
        header: t('assets.columns.tag'),
        mono: true,
        sticky: true,
        width: '150px',
        sortable: true,
        cell: (row) => (
          <span className="inline-flex items-center gap-1">
            <Link
              href={routes.assetView(row.id)}
              onClick={(e) => e.stopPropagation()}
              className="rounded-sm text-primary-text underline underline-offset-2"
            >
              {row.asset_tag}
            </Link>
            <IconButton
              icon={Copy}
              size="icon-sm"
              label={t('assets.copyTag', { tag: row.asset_tag })}
              onClick={(e) => {
                e.stopPropagation();
                void copyTag(row.asset_tag);
              }}
            />
          </span>
        ),
      },
      name: {
        id: 'name',
        header: t('assets.columns.name'),
        sortable: true,
        cell: (row) => row.name ?? lookups.modelById.get(row.model_id ?? '')?.name ?? '',
      },
      model: {
        id: 'model',
        header: t('assets.columns.model'),
        cell: (row) => lookups.modelById.get(row.model_id ?? '')?.name ?? '',
      },
      category: {
        id: 'category',
        header: t('assets.columns.category'),
        cell: (row) => lookups.categoryById.get(row.category_id)?.name ?? '',
      },
      status: {
        id: 'status',
        header: t('assets.columns.status'),
        cell: (row) => <AssetStatusBadge asset={row} lookups={lookups} />,
      },
      location: {
        id: 'location',
        header: t('assets.columns.location'),
        cell: (row) => lookups.locationLabel(row.location_id),
      },
      serial: {
        id: 'serial',
        header: t('assets.columns.serial'),
        mono: true,
        cell: (row) => row.serial ?? '',
      },
      vendor: {
        id: 'vendor',
        header: t('assets.columns.vendor'),
        cell: (row) => lookups.vendorById.get(row.vendor_id ?? '')?.name ?? '',
      },
      purchase_date: {
        id: 'purchase_date',
        header: t('assets.columns.purchase_date'),
        sortable: true,
        cell: (row) => row.purchase_date ?? '',
      },
      warranty_end: {
        id: 'warranty_end',
        header: t('assets.columns.warranty_end'),
        sortable: true,
        cell: (row) => row.warranty_end ?? '',
      },
      created_at: {
        id: 'created_at',
        header: t('assets.columns.created_at'),
        sortable: true,
        cell: (row) => (row.created_at ? i18n.formatDate(row.created_at) : ''),
      },
    };
    return state.columns.flatMap((id): DataTableColumn<Asset>[] => {
      if (id.startsWith('cf:')) {
        const def = lookups.fields.find((f) => `cf:${f.key}` === id);
        return def
          ? [
              {
                id,
                header: def.label,
                cell: (row) => formatValue(def, row.custom_data?.[def.key], i18n),
              },
            ]
          : [];
      }
      return byId[id] ? [byId[id]] : [];
    });
    // `i18n` carries `t` and the formatters; the lookups object changes when any list loads.
  }, [state.columns, lookups, i18n, t, toast]);

  const sort: SortState | null = state.sort
    ? {
        columnId: COLUMN_BY_SORT_KEY[state.sort.replace(/^-/, '')] ?? '',
        direction: state.sort.startsWith('-') ? 'desc' : 'asc',
      }
    : null;

  // ---- saved views --------------------------------------------------------------------------------
  const applyView = (id: string) => {
    setActiveView(id);
    const next = id === DEFAULT_VIEW ? defaultViewState() : views.find((v) => v.id === id)?.state;
    if (!next) return;
    setSearchText(next.q);
    setState(next);
    setCursors([]);
    setSelected(new Set());
  };

  // ---- bulk actions -------------------------------------------------------------------------------
  const selectedItems: BulkItem[] = rows
    .filter((r) => selected.has(r.id))
    .map((r) => ({ id: r.id, label: r.asset_tag }));

  const finishBulk = async (title: string, outcome: BulkResult[]) => {
    await refreshList();
    setProgress(null);
    const failed = outcome.filter((r) => !r.ok);
    setSelected(new Set(failed.map((r) => r.item.id)));
    if (failed.length > 0) setResults({ title, results: outcome });
    else toast({ variant: 'success', title: t('assets.bulk.done', { count: outcome.length }) });
  };

  const applyEdit = async (patch: BulkEditPatch) => {
    setProgress({ done: 0, total: selectedItems.length });
    const outcome = await runBulk(selectedItems, (ids) => assetsApi.bulkUpdate(ids, patch), {
      onProgress: (done, totalCount) => setProgress({ done, total: totalCount }),
    });
    setBulkEditOpen(false);
    await finishBulk(t('assets.bulk.editResultsTitle'), outcome);
  };

  const archiveSelected = async () => {
    setProgress({ done: 0, total: selectedItems.length });
    const restoring = state.archived === 'only';
    const outcome = await runBulk(
      selectedItems,
      (ids) => (restoring ? assetsApi.bulkRestore(ids) : assetsApi.bulkArchive(ids)),
      { onProgress: (done, totalCount) => setProgress({ done, total: totalCount }) },
    );
    await finishBulk(
      restoring ? t('assets.bulk.restoreResultsTitle') : t('assets.bulk.archiveResultsTitle'),
      outcome,
    );
  };

  const filtered = hasActiveFilters(state);
  const canUpdate = can('asset:update');
  const canArchive = can('asset:delete');
  const loadFailed = list.error && !list.data;
  const catOptions = lookups.categories.map((c) => ({ value: c.id, label: c.name }));
  const filterableFields = lookups.fields.filter((f) =>
    ['text', 'select', 'boolean', 'number', 'date'].includes(f.data_type),
  );
  const cfDef = filterableFields.find((f) => f.key === state.cf?.key);

  return (
    <div className="flex flex-col gap-3">
      {/* Search, filters and view controls */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-medium">
          {t('assets.search')}
          <Input
            type="search"
            value={searchText}
            placeholder={t('assets.searchPlaceholder')}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </label>
        <FilterSelect
          label={t('assets.filters.status')}
          value={state.status_id}
          allLabel={t('assets.filters.allStatuses')}
          options={lookups.statuses
            .filter((s) => !s.archived_at)
            .map((s) => ({ value: s.id, label: s.name }))}
          onChange={(v) => update({ status_id: v })}
        />
        <FilterSelect
          label={t('assets.filters.category')}
          value={state.category_id}
          allLabel={t('assets.filters.allCategories')}
          options={catOptions}
          onChange={(v) => update({ category_id: v })}
        />
        <FilterSelect
          label={t('assets.filters.location')}
          value={state.location_id}
          allLabel={t('assets.filters.allLocations')}
          options={lookups.locations.map((l) => ({
            value: l.id,
            label: lookups.locationLabel(l.id),
          }))}
          onChange={(v) => update({ location_id: v })}
        />
        <label className="flex min-w-40 flex-col gap-1.5 text-sm font-medium">
          {t('assets.filters.archived')}
          <Select
            aria-label={t('assets.filters.archived')}
            value={state.archived}
            onValueChange={(v) => update({ archived: v as AssetViewState['archived'] })}
            options={[
              { value: 'exclude', label: t('assets.filters.activeOnly') },
              { value: 'include', label: t('assets.filters.includeArchived') },
              { value: 'only', label: t('assets.filters.archivedOnly') },
            ]}
          />
        </label>
        {filterableFields.length > 0 ? (
          <div className="flex items-end gap-2">
            <label className="flex min-w-44 flex-col gap-1.5 text-sm font-medium">
              {t('assets.filters.customField')}
              <Select
                aria-label={t('assets.filters.customField')}
                value={state.cf?.key ?? ALL}
                onValueChange={(key) => update({ cf: key === ALL ? null : { key, value: '' } })}
                options={[
                  { value: ALL, label: t('assets.filters.noCustomField') },
                  ...filterableFields.map((f) => ({ value: f.key, label: f.label })),
                ]}
              />
            </label>
            {cfDef ? (
              cfDef.data_type === 'select' || cfDef.data_type === 'boolean' ? (
                <Select
                  aria-label={t('assets.filters.customValue', { field: cfDef.label })}
                  value={state.cf?.value || ALL}
                  onValueChange={(v) =>
                    update({ cf: { key: cfDef.key, value: v === ALL ? '' : v } })
                  }
                  options={[
                    { value: ALL, label: t('common.any') },
                    ...(cfDef.data_type === 'boolean'
                      ? [
                          { value: 'true', label: t('common.yes') },
                          { value: 'false', label: t('common.no') },
                        ]
                      : (cfDef.options ?? []).map((o) => ({
                          value: o.value,
                          label: o.label ?? o.value,
                        }))),
                  ]}
                />
              ) : (
                <Input
                  aria-label={t('assets.filters.customValue', { field: cfDef.label })}
                  value={state.cf?.value ?? ''}
                  onChange={(e) => update({ cf: { key: cfDef.key, value: e.target.value } })}
                />
              )
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          {t('assets.views.label')}
          <Select
            aria-label={t('assets.views.label')}
            value={activeView}
            onValueChange={applyView}
            className="w-52"
            options={[
              { value: DEFAULT_VIEW, label: t('assets.views.all') },
              ...views.map((v) => ({ value: v.id, label: v.name })),
            ]}
          />
        </label>
        <Button size="sm" onClick={() => setSaveOpen(true)}>
          <Save aria-hidden className="size-4" />
          {t('assets.views.save')}
        </Button>
        {activeView !== DEFAULT_VIEW ? (
          <Button
            size="sm"
            onClick={() => {
              setViews(deleteView(activeView));
              setActiveView(DEFAULT_VIEW);
            }}
          >
            <Trash2 aria-hidden className="size-4" />
            {t('assets.views.delete')}
          </Button>
        ) : null}
        {filtered ? (
          <Button
            size="sm"
            variant="link"
            onClick={() => {
              setSearchText('');
              update({ ...defaultViewState(), columns: state.columns, sort: state.sort });
            }}
          >
            {t('assets.filters.clearAll')}
          </Button>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => setColumnsOpen(true)}>
            <Columns3 aria-hidden className="size-4" />
            {t('assets.columnsButton')}
          </Button>
          <Select
            aria-label={t('table.density')}
            value={density}
            onValueChange={(v) => setDensity(v as typeof density)}
            options={[
              { value: 'comfortable', label: t('table.comfortable') },
              { value: 'compact', label: t('table.compact') },
            ]}
            className="w-44"
          />
        </span>
      </div>

      {loadFailed ? (
        <Banner
          tone="danger"
          action={<Button onClick={() => void list.refetch()}>{t('common.retry')}</Button>}
        >
          {t('assets.loadFailed')}
        </Banner>
      ) : null}

      <DataTable
        label={t('assets.tableLabel')}
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.asset_tag}
        density={density}
        selectable
        selectedIds={selected}
        onSelectedIdsChange={setSelected}
        onRowClick={setOpen}
        onRowOpen={(row) => router.push(routes.assetView(row.id))}
        sort={sort}
        onSortChange={(next) =>
          update({
            sort: next
              ? `${next.direction === 'desc' ? '-' : ''}${SORT_KEY_BY_COLUMN[next.columnId] ?? ''}`
              : '',
          })
        }
        loading={list.isLoading || lookups.loading}
        className={list.isPlaceholderData ? 'opacity-60' : undefined}
        empty={
          filtered ? (
            <EmptyState
              icon={Package}
              title={t('assets.noMatchTitle')}
              description={t('assets.noMatchDescription')}
              actions={
                <Button
                  onClick={() => {
                    setSearchText('');
                    update({ ...defaultViewState(), columns: state.columns });
                  }}
                >
                  {t('assets.filters.clearAll')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Package}
              title={t('assets.emptyTitle')}
              description={t('assets.emptyDescription')}
              actions={
                can('asset:create') ? (
                  <Button asChild variant="primary">
                    <Link href={routes.assetNew}>
                      <Plus aria-hidden className="size-4" />
                      {t('assets.newAsset')}
                    </Link>
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
          data-testid="assets-range"
        >
          {rows.length === 0
            ? ''
            : total !== undefined && total !== null
              ? t('assets.range', { from: pageStart + 1, to: pageStart + rows.length, total })
              : t('assets.rangeNoTotal', { from: pageStart + 1, to: pageStart + rows.length })}
        </p>
        <nav aria-label={t('assets.pagination')} className="flex gap-2">
          <Button
            size="sm"
            disabled={cursors.length === 0}
            onClick={() => {
              setCursors((c) => c.slice(0, -1));
              setSelected(new Set());
            }}
          >
            <ChevronLeft aria-hidden className="size-4" />
            {t('assets.previousPage')}
          </Button>
          <Button
            size="sm"
            disabled={!list.data?.page.has_more || !list.data.page.next_cursor}
            onClick={() => {
              const next = list.data?.page.next_cursor;
              if (next) setCursors((c) => [...c, next]);
              setSelected(new Set());
            }}
          >
            {t('assets.nextPage')}
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </nav>
      </div>

      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
        {state.archived === 'only' ? (
          canArchive ? (
            <Button size="sm" onClick={() => setArchiveOpen(true)}>
              {t('assets.bulk.restore')}
            </Button>
          ) : null
        ) : (
          <>
            {canUpdate ? (
              <Button size="sm" onClick={() => setBulkEditOpen(true)}>
                {t('assets.bulk.edit')}
              </Button>
            ) : null}
            {canArchive ? (
              <Button size="sm" onClick={() => setArchiveOpen(true)}>
                {t('common.archive')}
              </Button>
            ) : null}
          </>
        )}
      </BulkActionBar>

      <QuickView asset={open} lookups={lookups} onClose={() => setOpen(null)} />
      <ColumnsDialog
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        columns={state.columns}
        fields={lookups.fields}
        onChange={(next) => setState((s) => ({ ...s, columns: next }))}
      />
      <FormDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title={t('assets.views.saveTitle')}
        description={t('assets.views.saveDescription')}
        fields={[{ name: 'name', label: t('assets.views.name'), kind: 'text', required: true }]}
        initial={{ name: '' }}
        submitLabel={t('assets.views.save')}
        onSubmit={async (values) => {
          const next = saveView(String(values.name), state);
          setViews(next);
          setActiveView(
            next.find((v) => v.name === String(values.name).trim())?.id ?? DEFAULT_VIEW,
          );
        }}
      />
      <BulkEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        items={selectedItems}
        lookups={lookups}
        progress={progress}
        onApply={(patch) => void applyEdit(patch)}
      />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={
          state.archived === 'only'
            ? t('assets.bulk.restoreTitle', { count: selectedItems.length })
            : t('assets.bulk.archiveTitle', { count: selectedItems.length })
        }
        description={
          state.archived === 'only'
            ? t('assets.bulk.restoreDescription')
            : t('assets.bulk.archiveDescription')
        }
        confirmLabel={state.archived === 'only' ? t('assets.bulk.restore') : t('common.archive')}
        destructive={state.archived !== 'only'}
        onConfirm={archiveSelected}
      >
        <p className="rounded-md bg-sunken p-3 font-tag text-sm">
          {selectedItems
            .slice(0, 8)
            .map((i) => i.label)
            .join(', ')}
          {selectedItems.length > 8 ? ', ...' : ''}
        </p>
      </ConfirmDialog>
      <BulkResultsDialog
        results={results?.results ?? null}
        title={results?.title ?? ''}
        onClose={() => setResults(null)}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-44 flex-col gap-1.5 text-sm font-medium">
      {label}
      <Select
        aria-label={label}
        value={value || ALL}
        onValueChange={(v) => onChange(v === ALL ? '' : v)}
        options={[{ value: ALL, label: allLabel }, ...options]}
      />
    </label>
  );
}

/** The 480px drawer behind a row click: the key fields, with a link to the full page. */
function QuickView({
  asset,
  lookups,
  onClose,
}: {
  asset: Asset | null;
  lookups: Lookups;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { can } = useAuth();
  const detail = useQuery({
    queryKey: ['asset', asset?.id],
    queryFn: () => assetsApi.get(asset!.id, ['model', 'category', 'location', 'vendor']),
    enabled: !!asset,
  });
  const shown = detail.data?.value ?? asset;
  return (
    <Drawer open={asset !== null} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="font-tag">{asset?.asset_tag}</DrawerTitle>
          <DrawerDescription>
            {asset?.name ??
              lookups.modelById.get(asset?.model_id ?? '')?.name ??
              t('assets.drawerDescription')}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          {shown ? (
            detail.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <AssetDetails asset={shown} lookups={lookups} />
            )
          ) : null}
          {detail.error ? (
            <Banner tone="danger">{uiErrorText(t, getApi().toUiError(detail.error))}</Banner>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          {asset && can('asset:update') ? (
            <Button asChild>
              <Link href={routes.assetEdit(asset.id)}>{t('common.edit')}</Link>
            </Button>
          ) : null}
          {asset ? (
            <Button asChild variant="primary">
              <Link href={routes.assetView(asset.id)}>{t('common.openFullPage')}</Link>
            </Button>
          ) : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
