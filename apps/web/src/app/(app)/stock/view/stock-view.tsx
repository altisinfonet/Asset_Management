'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ClipboardList, LogOut, PackagePlus, Pencil, Boxes, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { AttachmentsPanel } from '@/components/files/attachments-panel';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { StockFormDialog } from '@/components/stock/stock-form-dialog';
import {
  CheckoutAccessoryDialog,
  MinimumDialog,
  MovementDialog,
  ReturnAccessoryDialog,
  type MovementMode,
} from '@/components/stock/stock-dialogs';
import { StockBar, StockLevelBadge, useStockCategories } from '@/components/stock/stock-parts';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { assetsApi, peopleApi } from '@/lib/registry/api';
import { useLookups } from '@/lib/registry/queries';
import type { Page, Versioned } from '@/lib/registry/types';
import { routes } from '@/lib/routes';
import {
  accessoriesApi,
  consumablesApi,
  type Accessory,
  type Assignment,
  type Consumable,
  type StockKind,
  type StockMovement,
  type StockReason,
} from '@/lib/stock/api';
import { outstanding, unitsLeft } from '@/lib/stock/helpers';

const ALL = '__all__';
const REASONS: StockReason[] = ['receive', 'issue', 'return', 'adjust', 'correction'];

/**
 * One accessory or consumable (WEB-19): the stock summary with its level bar and minimum, the
 * actions that fit the kind, and tabs for who holds it (accessories) or the stock ledger
 * (consumables), the details and the files. On `/stock/view?kind=&id=` (ADR-0002).
 */
export function StockView() {
  const { t } = useI18n();
  const params = useSearchParams();
  const id = params.get('id');
  const kindParam = params.get('kind');
  const kind: StockKind = kindParam === 'consumable' ? 'consumable' : 'accessory';
  if (!id) {
    return (
      <>
        <PageTitle title={t('stockView.title')} />
        <EmptyState
          headingLevel="h1"
          icon={Boxes}
          title={<span data-testid="no-stock-item">{t('stockView.noneSelected')}</span>}
          description={t('stockView.noneSelectedHint')}
          actions={
            <Button asChild variant="primary">
              <Link href={routes.stock(kind)}>{t('stockView.backToList')}</Link>
            </Button>
          }
        />
      </>
    );
  }
  return <StockItemView kind={kind} id={id} />;
}

function StockItemView({ kind, id }: { kind: StockKind; id: string }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const lookups = useLookups();
  const categories = useStockCategories(kind);
  const [editing, setEditing] = useState(false);
  const [minimumOpen, setMinimumOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [movement, setMovement] = useState<MovementMode | null>(null);
  const [returning, setReturning] = useState<{ assignment: Assignment; holder: string } | null>(
    null,
  );

  const item = useQuery<Versioned<Accessory | Consumable>>({
    queryKey: ['stock', kind, id],
    queryFn: () => (kind === 'accessory' ? accessoriesApi.get(id) : consumablesApi.get(id)),
    retry: false,
  });

  const defaultTab = kind === 'accessory' ? 'holders' : 'movements';
  const tabParam = params.get('tab');
  const tabs =
    kind === 'accessory'
      ? ['holders', 'history', 'details', 'files']
      : ['movements', 'details', 'files'];
  const tab = tabs.includes(tabParam ?? '') ? (tabParam as string) : defaultTab;
  const setTab = (next: string) =>
    router.replace(routes.stockView(kind, id, next === defaultTab ? undefined : next));

  if (item.isLoading) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <PageTitle title={t('stockView.title')} />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full max-w-3xl" />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }
  if (item.error || !item.data) {
    const ui = getApi().toUiError(item.error);
    const missing = ui.kind === 'not_found' || ui.kind === 'forbidden';
    return missing ? (
      <>
        <PageTitle title={t('stockView.notFoundTitle')} />
        <EmptyState
          headingLevel="h1"
          icon={Boxes}
          title={<span data-testid="stock-not-found">{t('stockView.notFoundTitle')}</span>}
          description={t('stockView.notFoundHint')}
          actions={
            <Button asChild variant="primary">
              <Link href={routes.stock(kind)}>{t('stockView.backToList')}</Link>
            </Button>
          }
        />
      </>
    ) : (
      <Banner
        tone="danger"
        title={t('stockView.loadFailed')}
        action={<Button onClick={() => void item.refetch()}>{t('common.retry')}</Button>}
      >
        {t(ui.messageKey)}
      </Banner>
    );
  }

  const { value, etag } = item.data;
  const archived = !!value.archived_at;
  const accessory = kind === 'accessory' ? (value as Accessory) : null;
  const consumable = kind === 'consumable' ? (value as Consumable) : null;
  const left = unitsLeft(value, kind);
  const minimum = value.min_qty ?? 0;
  const manage = can(kind === 'accessory' ? 'accessory:manage' : 'consumable:manage');
  const refresh = () => client.invalidateQueries({ queryKey: ['stock'] });
  const categoryName = categories.data?.find((c) => c.id === value.category_id)?.name ?? '';

  const detailRows: Array<[string, ReactNode]> = [
    [t('stockView.details.category'), categoryName],
    [t('stockView.details.location'), lookups.locationLabel(value.location_id)],
    [
      t('stockView.details.manufacturer'),
      lookups.manufacturerById.get(value.manufacturer_id ?? '')?.name ?? '',
    ],
    [t('stockView.details.vendor'), lookups.vendorById.get(value.vendor_id ?? '')?.name ?? ''],
    [t('stockView.details.modelNumber'), value.model_number ?? ''],
    ...(accessory?.purchase_date
      ? ([
          [
            t('stockView.details.purchaseDate'),
            formatDate(`${accessory.purchase_date}T00:00:00Z`, { timeZone: 'UTC' }),
          ],
        ] as Array<[string, ReactNode]>)
      : []),
    ...(consumable
      ? ([[t('stockView.details.unit'), consumable.unit ?? 'each']] as Array<[string, ReactNode]>)
      : []),
    [t('stockView.details.notes'), value.notes ?? ''],
  ];

  return (
    <>
      <PageTitle title={value.name} />
      <PageHeader
        title={value.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StockLevelBadge available={left} minimum={minimum} />
            {categoryName ? <span>{categoryName}</span> : null}
            {archived ? <Badge tone="warning">{t('stockView.archivedBadge')}</Badge> : null}
          </span>
        }
        actions={
          <>
            {accessory && can('accessory:checkout') && !archived ? (
              <Button
                variant="primary"
                disabled={(accessory.qty_available ?? 0) < 1}
                onClick={() => setCheckoutOpen(true)}
              >
                <LogOut aria-hidden className="size-4" />
                {t('stock.rowActions.checkOut')}
              </Button>
            ) : null}
            {consumable && can('consumable:adjust') && !archived ? (
              <>
                <Button variant="primary" onClick={() => setMovement('receive')}>
                  <PackagePlus aria-hidden className="size-4" />
                  {t('stock.rowActions.receive')}
                </Button>
                <Button
                  disabled={(consumable.qty_on_hand ?? 0) < 1}
                  onClick={() => setMovement('consume')}
                >
                  {t('stock.rowActions.consume')}
                </Button>
                <Button onClick={() => setMovement('adjust')}>
                  <ClipboardList aria-hidden className="size-4" />
                  {t('stockActions.movement.adjust.submit')}
                </Button>
              </>
            ) : null}
            {manage && !archived ? (
              <>
                <Button onClick={() => setEditing(true)}>
                  <Pencil aria-hidden className="size-4" />
                  {t('common.edit')}
                </Button>
                <Button onClick={() => setArchiveOpen(true)}>
                  <Archive aria-hidden className="size-4" />
                  {t('stockView.archive')}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <section
        aria-label={t('stockView.summary')}
        className="mb-4 flex max-w-3xl flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {accessory ? (
            <>
              <Figure label={t('stockView.totals.total')} value={accessory.qty_total} />
              <Figure label={t('stockView.totals.out')} value={accessory.qty_checked_out} />
              <Figure
                label={t('stockView.totals.available')}
                value={accessory.qty_available}
                testId="figure-available"
              />
            </>
          ) : (
            <Figure
              label={t('stockView.totals.onHand')}
              value={`${consumable!.qty_on_hand} ${consumable!.unit ?? ''}`.trim()}
              testId="figure-on-hand"
            />
          )}
          <Figure label={t('stockView.totals.minimum')} value={minimum} testId="figure-minimum" />
        </dl>
        <StockBar
          value={left}
          total={accessory ? accessory.qty_total : Math.max(left, minimum * 2, 1)}
          minimum={minimum}
          label={t('stock.levelBar', {
            name: value.name,
            value: left,
            total: accessory ? accessory.qty_total : Math.max(left, minimum * 2, 1),
          })}
        />
        {manage && !archived ? (
          <div>
            <Button size="sm" onClick={() => setMinimumOpen(true)}>
              {t('stockView.changeMinimum')}
            </Button>
          </div>
        ) : null}
      </section>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('stockView.tabsLabel')}>
          {accessory ? (
            <>
              <TabsTrigger value="holders">{t('stockView.tabs.holders')}</TabsTrigger>
              <TabsTrigger value="history">{t('stockView.tabs.history')}</TabsTrigger>
            </>
          ) : (
            <TabsTrigger value="movements">{t('stockView.tabs.movements')}</TabsTrigger>
          )}
          <TabsTrigger value="details">{t('stockView.tabs.details')}</TabsTrigger>
          <TabsTrigger value="files">{t('stockView.tabs.files')}</TabsTrigger>
        </TabsList>
        {accessory ? (
          <>
            <TabsContent value="holders">
              <AssignmentsList
                accessoryId={id}
                state="open"
                canReturn={can('accessory:checkout') && !archived}
                onReturn={(assignment, holder) => setReturning({ assignment, holder })}
              />
            </TabsContent>
            <TabsContent value="history">
              <AssignmentsList accessoryId={id} state="closed" canReturn={false} />
            </TabsContent>
          </>
        ) : (
          <TabsContent value="movements">
            <MovementsList consumableId={id} />
          </TabsContent>
        )}
        <TabsContent value="details">
          <dl className="grid max-w-3xl grid-cols-[minmax(8rem,12rem)_1fr] gap-x-4 gap-y-2 text-base">
            {detailRows.map(([label, content]) => (
              <div key={label} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd>{content || <span className="text-muted">{'-'}</span>}</dd>
              </div>
            ))}
          </dl>
        </TabsContent>
        <TabsContent value="files">
          {can('attachment:read') ? (
            <AttachmentsPanel
              entityType={kind}
              entityId={id}
              canWrite={can('attachment:write') && !archived}
            />
          ) : (
            <p className="text-base text-muted">{t('files.noAccess')}</p>
          )}
        </TabsContent>
      </Tabs>

      <StockFormDialog
        open={editing}
        onOpenChange={setEditing}
        kind={kind}
        item={
          accessory
            ? { kind: 'accessory', value: accessory, etag }
            : { kind: 'consumable', value: consumable!, etag }
        }
      />
      <MinimumDialog
        open={minimumOpen}
        onOpenChange={setMinimumOpen}
        kind={kind}
        item={value}
        etag={etag}
      />
      <CheckoutAccessoryDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        accessory={accessory}
      />
      <ReturnAccessoryDialog
        open={returning !== null}
        onOpenChange={(open) => !open && setReturning(null)}
        accessory={accessory}
        assignment={returning?.assignment ?? null}
        holder={returning?.holder ?? ''}
      />
      <MovementDialog
        open={movement !== null}
        onOpenChange={(open) => !open && setMovement(null)}
        consumable={consumable}
        mode={movement ?? 'receive'}
      />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t('stockView.archiveTitle', { name: value.name })}
        description={t('stockView.archiveDescription')}
        confirmLabel={t('stockView.archive')}
        destructive
        onConfirm={async () => {
          if (accessory) await accessoriesApi.archive(id, etag);
          else await consumablesApi.archive(id, etag);
          await refresh();
          toast({ variant: 'success', title: t('stockView.archived', { name: value.name }) });
          router.push(routes.stock(kind));
        }}
      />
    </>
  );
}

function Figure({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-2xl font-semibold" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/** Follow `next_cursor` page by page ("Load more"). */
function useCursorList<T>(
  key: readonly unknown[],
  load: (cursor: string | undefined) => Promise<Page<T>>,
) {
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => load(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.has_more ? (last.page.next_cursor ?? undefined) : undefined,
  });
  return { query, rows: query.data?.pages.flatMap((page) => page.data) ?? [] };
}

// ---- who holds an accessory ------------------------------------------------------------------

function AssignmentsList({
  accessoryId,
  state,
  canReturn,
  onReturn,
}: {
  accessoryId: string;
  state: 'open' | 'closed';
  canReturn: boolean;
  onReturn?: (assignment: Assignment, holder: string) => void;
}) {
  const { t, formatDate, formatDateTime } = useI18n();
  const { query, rows } = useCursorList(
    ['stock', 'accessory', accessoryId, 'assignments', state],
    (cursor) => accessoriesApi.assignments(accessoryId, { state, cursor, limit: 50 }),
  );
  if (query.isLoading) return <Skeleton className="h-24 w-full max-w-3xl" />;
  if (query.error) return <Banner tone="danger">{t('stockView.holders.loadFailed')}</Banner>;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title={state === 'open' ? t('stockView.holders.none') : t('stockView.holders.closedNone')}
        description={state === 'open' ? t('stockView.holders.noneHint') : undefined}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-base">
          <caption className="sr-only">{t('stockView.holders.label')}</caption>
          <thead>
            <tr className="border-b border-border text-sm text-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('stockView.holders.who')}
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                {t('stockView.holders.quantity')}
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                {t('stockView.holders.returned')}
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('stockView.holders.since')}
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('stockView.holders.due')}
              </th>
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((assignment) => (
              <tr key={assignment.id} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-2 pr-4 font-normal">
                  <HolderName assignment={assignment} render={(name) => name} />
                </th>
                <td className="py-2 pr-4 text-right">{assignment.quantity}</td>
                <td className="py-2 pr-4 text-right">{assignment.quantity_returned}</td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {formatDateTime(assignment.checked_out_at)}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {assignment.expected_return ? (
                    <span className="inline-flex items-center gap-2">
                      {formatDate(`${assignment.expected_return}T00:00:00Z`, { timeZone: 'UTC' })}
                      {assignment.overdue ? (
                        <Badge tone="danger">{t('stockView.holders.overdue')}</Badge>
                      ) : null}
                    </span>
                  ) : (
                    ''
                  )}
                </td>
                <td className="py-2 text-right">
                  {canReturn && outstanding(assignment) > 0 ? (
                    <HolderName
                      assignment={assignment}
                      render={(name) => (
                        <Button
                          size="sm"
                          aria-label={t('stockView.holders.returnNamed', { name })}
                          onClick={() => onReturn?.(assignment, name)}
                        >
                          <Undo2 aria-hidden className="size-4" />
                          {t('stockView.holders.returnAction')}
                        </Button>
                      )}
                    />
                  ) : state === 'open' ? null : (
                    <span className="text-sm text-muted">
                      {t('stockView.holders.fullyReturned')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.hasNextPage ? (
        <div>
          <Button
            size="sm"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('stockView.movements.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The name of whoever or wherever an assignment points at, resolved (and cached) per id. */
function HolderName({
  assignment,
  render,
}: {
  assignment: Assignment;
  render: (name: string) => ReactNode;
}) {
  const lookups = useLookups();
  const personId = assignment.person_id ?? undefined;
  const assetId = assignment.target_asset_id ?? undefined;
  const person = useQuery({
    queryKey: ['person', personId],
    queryFn: () => peopleApi.get(personId!),
    enabled: !!personId,
    retry: false,
    staleTime: 60_000,
  });
  const asset = useQuery({
    queryKey: ['asset', assetId],
    queryFn: () => assetsApi.get(assetId!),
    enabled: !!assetId,
    retry: false,
    staleTime: 60_000,
  });
  const name = personId
    ? (person.data?.value.display_name ?? '...')
    : assignment.location_id
      ? lookups.locationLabel(assignment.location_id)
      : (asset.data?.value.asset_tag ?? '...');
  const content = render(name);
  if (personId && typeof content === 'string') {
    return (
      <Link
        href={routes.personView(personId)}
        className="rounded-sm text-primary-text underline underline-offset-2"
      >
        {content}
      </Link>
    );
  }
  if (assetId && typeof content === 'string') {
    return (
      <Link
        href={routes.assetView(assetId)}
        className="rounded-sm text-primary-text underline underline-offset-2"
      >
        {content}
      </Link>
    );
  }
  return <>{content}</>;
}

// ---- the stock ledger of a consumable ----------------------------------------------------------

function MovementsList({ consumableId }: { consumableId: string }) {
  const { t, formatDateTime } = useI18n();
  const [reason, setReason] = useState('');
  const { query, rows } = useCursorList(
    ['stock', 'consumable', consumableId, 'movements', reason],
    (cursor) =>
      consumablesApi.movements(consumableId, {
        cursor,
        limit: 50,
        ...(reason ? { reason: [reason as StockReason] } : {}),
      }),
  );
  return (
    <div className="flex flex-col gap-3">
      <label className="flex w-fit flex-col gap-1.5 text-sm font-medium">
        {t('stockView.movements.filter')}
        <Select
          aria-label={t('stockView.movements.filter')}
          value={reason || ALL}
          className="w-52"
          onValueChange={(v) => setReason(v === ALL ? '' : v)}
          options={[
            { value: ALL, label: t('stockView.movements.allReasons') },
            ...REASONS.map((r) => ({ value: r, label: t(`stockView.movements.reasons.${r}`) })),
          ]}
        />
      </label>
      {query.isLoading ? <Skeleton className="h-24 w-full max-w-3xl" /> : null}
      {query.error ? <Banner tone="danger">{t('stockView.movements.loadFailed')}</Banner> : null}
      {query.isSuccess && rows.length === 0 ? (
        <EmptyState icon={Boxes} title={t('stockView.movements.none')} />
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-base">
            <caption className="sr-only">{t('stockView.movements.label')}</caption>
            <thead>
              <tr className="border-b border-border text-sm text-muted">
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t('stockView.movements.date')}
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t('stockView.movements.reason')}
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t('stockView.movements.change')}
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t('stockView.movements.balance')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('stockView.movements.note')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((movement: StockMovement) => (
                <tr key={movement.id} className="border-b border-border last:border-b-0">
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(movement.at)}</td>
                  <td className="py-2 pr-4">
                    {t(`stockView.movements.reasons.${movement.reason}`)}
                  </td>
                  <td className="py-2 pr-4 text-right font-tag">
                    {movement.qty_delta > 0 ? `+${movement.qty_delta}` : movement.qty_delta}
                  </td>
                  <td className="py-2 pr-4 text-right font-tag">{movement.balance_after}</td>
                  <td className="py-2">{movement.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {query.hasNextPage ? (
        <div>
          <Button
            size="sm"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('stockView.movements.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
