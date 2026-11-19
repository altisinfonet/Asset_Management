'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowRightLeft,
  Copy,
  LogIn,
  LogOut,
  PackageSearch,
  Pencil,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useCustody } from '@/components/custody/custody-provider';
import { AttachmentsPanel } from '@/components/files/attachments-panel';
import { AssetDetails, AssetStatusBadge } from '@/components/registry/asset-details';
import {
  HISTORY_FILTERS,
  HistoryTimeline,
  type HistoryFilter,
} from '@/components/registry/history-timeline';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { assetsApi } from '@/lib/registry/api';
import { useLookups } from '@/lib/registry/queries';
import { availableActions, type CustodyAction } from '@/lib/custody/helpers';
import { routes } from '@/lib/routes';
import { uiErrorText } from '@/lib/error-text';

const TABS = ['overview', 'history', 'repairs', 'attachments'] as const;
type Tab = (typeof TABS)[number];

/**
 * Asset detail (WEB-05) on the query-string route `/assets/view?id=<uuid>` (ADR-0002). A scanned
 * code arrives as `?code=` (QR links `/s/<code>` redirect here) and is resolved to the asset, then
 * the URL is replaced by the canonical `?id=`. Tabs are URL-addressable (`?tab=history`).
 */
export function AssetView() {
  const { t } = useI18n();
  const params = useSearchParams();
  const id = params.get('id');
  const code = params.get('code');

  if (!id && !code) {
    return (
      <>
        <PageTitle title={t('assetView.title')} />
        <EmptyState
          headingLevel="h1"
          icon={PackageSearch}
          title={<span data-testid="no-asset">{t('assetView.noneSelected')}</span>}
          description={t('assetView.noneSelectedHint')}
          actions={
            <Button asChild variant="primary">
              <Link href={routes.assets}>{t('assetView.backToList')}</Link>
            </Button>
          }
        />
      </>
    );
  }
  return id ? <AssetById id={id} /> : <AssetByCode code={code!} />;
}

function NotFound({ testId }: { testId: string }) {
  const { t } = useI18n();
  return (
    <>
      <PageTitle title={t('assetView.notFoundTitle')} />
      <EmptyState
        headingLevel="h1"
        icon={PackageSearch}
        title={<span data-testid={testId}>{t('assetView.notFoundTitle')}</span>}
        description={t('assetView.notFoundHint')}
        actions={
          <Button asChild variant="primary">
            <Link href={routes.assets}>{t('assetView.backToList')}</Link>
          </Button>
        }
      />
    </>
  );
}

/** Resolve a scanned tag or QR code, then continue on the canonical `?id=` URL. */
function AssetByCode({ code }: { code: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const resolved = useQuery({
    queryKey: ['asset-code', code],
    queryFn: () => assetsApi.resolve(code),
    retry: false,
  });
  useEffect(() => {
    if (resolved.data) router.replace(routes.assetView(resolved.data.asset.id));
  }, [resolved.data, router]);

  if (resolved.error) {
    const err = getApi().toUiError(resolved.error);
    if (err.kind === 'not_found') return <NotFound testId="asset-not-found" />;
    return <LoadError error={resolved.error} onRetry={() => void resolved.refetch()} />;
  }
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <PageTitle title={t('assetView.title')} />
      <Skeleton className="h-8 w-64" />
      <span className="sr-only" data-testid="asset-code">
        {code}
      </span>
      <span className="sr-only">{t('assetView.resolvingCode', { code })}</span>
    </div>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  const ui = getApi().toUiError(error);
  if (ui.kind === 'forbidden') {
    return <NotFound testId="asset-not-found" />;
  }
  return (
    <Banner
      tone="danger"
      title={t('assetView.loadFailed')}
      action={<Button onClick={onRetry}>{t('common.retry')}</Button>}
    >
      {t(ui.messageKey)}
      {ui.requestId ? (
        <span className="mt-1 block font-tag text-xs">
          {t('access.requestId', { id: ui.requestId })}
        </span>
      ) : null}
    </Banner>
  );
}

function AssetById({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const lookups = useLookups();
  const custody = useCustody();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const primaryAction = useRef<HTMLButtonElement>(null);
  const scanned = params.get('scanned') === '1';
  const tabParam = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as Tab)
    : 'overview';

  const asset = useQuery({
    queryKey: ['asset', id],
    queryFn: () => assetsApi.get(id, ['model', 'category', 'location', 'vendor']),
    retry: false,
  });
  const history = useInfiniteQuery({
    queryKey: ['asset-history', id, historyFilter],
    queryFn: ({ pageParam }) =>
      assetsApi.history(id, {
        cursor: pageParam,
        limit: 20,
        ...(historyFilter === 'all' ? {} : { event_type: HISTORY_FILTERS[historyFilter] }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.has_more ? (last.page.next_cursor ?? undefined) : undefined,
    enabled: asset.isSuccess,
  });

  // Arriving from a scan: the primary custody action takes focus, so Enter starts the hand-over.
  const loaded = asset.isSuccess;
  useEffect(() => {
    if (scanned && loaded) primaryAction.current?.focus();
  }, [scanned, loaded]);

  if (asset.isLoading) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <PageTitle title={t('assetView.title')} />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full max-w-3xl" />
        <span className="sr-only" data-testid="asset-id">
          {id}
        </span>
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }
  if (asset.error || !asset.data) {
    const ui = getApi().toUiError(asset.error);
    if (ui.kind === 'not_found') return <NotFound testId="asset-not-found" />;
    return <LoadError error={asset.error} onRetry={() => void asset.refetch()} />;
  }

  const { value, etag } = asset.data;
  const archived = !!value.archived_at;
  const modelName = lookups.modelById.get(value.model_id ?? '')?.name;
  const title = value.name ?? modelName ?? value.asset_tag;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['asset', id] });
    await queryClient.invalidateQueries({ queryKey: ['asset-history', id] });
    await queryClient.invalidateQueries({ queryKey: ['assets'] });
  };

  const actions = availableActions(value, can);
  const ACTION_ICON: Record<CustodyAction, LucideIcon> = {
    checkout: LogOut,
    checkin: LogIn,
    transfer: ArrowRightLeft,
  };
  const holder = value.current_assignment;

  const setTab = (next: string) => {
    const query = new URLSearchParams(params.toString());
    if (next === 'overview') query.delete('tab');
    else query.set('tab', next);
    router.replace(`${routes.assetView(id).split('?')[0]}?${query.toString()}`);
  };

  const historyEvents = history.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageTitle title={`${value.asset_tag} ${title}`} />
      <p className="sr-only">
        <span data-testid="asset-id">{id}</span>
      </p>
      <PageHeader
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-tag" data-testid="asset-tag">
              {value.asset_tag}
            </span>
            {value.serial ? (
              <span>
                {t('assets.columns.serial')} <span className="font-tag">{value.serial}</span>
              </span>
            ) : null}
            <AssetStatusBadge asset={value} lookups={lookups} />
            {holder ? (
              <span data-testid="asset-holder">
                {holder.target_type === 'person' ? (
                  <Link
                    href={routes.personView(holder.target_id)}
                    className="rounded-sm text-primary-text underline underline-offset-2"
                  >
                    {t('custody.assignedTo', { name: holder.target_name ?? '' })}
                  </Link>
                ) : (
                  t('custody.assignedTo', { name: holder.target_name ?? '' })
                )}
              </span>
            ) : null}
            {archived ? (
              <span className="font-medium text-warning-text">{t('assetView.archivedBadge')}</span>
            ) : null}
          </span>
        }
        actions={
          <>
            {actions.map((action, index) => {
              const Icon = ACTION_ICON[action];
              return (
                <Button
                  key={action}
                  ref={index === 0 ? primaryAction : undefined}
                  variant={index === 0 ? 'primary' : 'secondary'}
                  onClick={() => custody.open({ assets: [value], action, onDone: refresh })}
                >
                  <Icon aria-hidden className="size-4" />
                  {t(`custody.tabs.${action}`)}
                </Button>
              );
            })}
            <Button
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(value.asset_tag)
                  .then(() =>
                    toast({
                      variant: 'success',
                      title: t('assets.tagCopied', { tag: value.asset_tag }),
                    }),
                  )
                  .catch(() => toast({ variant: 'danger', title: t('assets.tagCopyFailed') }));
              }}
            >
              <Copy aria-hidden className="size-4" />
              {t('assetView.copyTag')}
            </Button>
            {can('asset:update') && !archived ? (
              <Button asChild>
                <Link href={routes.assetEdit(id)}>
                  <Pencil aria-hidden className="size-4" />
                  {t('common.edit')}
                </Link>
              </Button>
            ) : null}
            {can('asset:create') ? (
              <Button asChild>
                <Link href={routes.assetClone(id)}>{t('assetView.clone')}</Link>
              </Button>
            ) : null}
            {can('asset:delete') ? (
              archived ? (
                <Button
                  onClick={async () => {
                    try {
                      await assetsApi.restore(id, etag);
                      await refresh();
                      toast({ variant: 'success', title: t('assetView.restored') });
                    } catch (err) {
                      const ui = getApi().toUiError(err);
                      toast({
                        variant: 'danger',
                        title: uiErrorText(t, ui),
                        requestId: ui.requestId,
                      });
                    }
                  }}
                >
                  <RotateCcw aria-hidden className="size-4" />
                  {t('assetView.restore')}
                </Button>
              ) : (
                <Button onClick={() => setArchiveOpen(true)}>
                  <Archive aria-hidden className="size-4" />
                  {t('common.archive')}
                </Button>
              )
            ) : null}
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('assetView.tabsLabel')}>
          <TabsTrigger value="overview">{t('assetView.tabs.overview')}</TabsTrigger>
          <TabsTrigger
            value="history"
            count={history.isSuccess && !history.hasNextPage ? historyEvents.length : undefined}
          >
            {t('assetView.tabs.history')}
          </TabsTrigger>
          <TabsTrigger value="repairs">{t('assetView.tabs.repairs')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('assetView.tabs.attachments')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="max-w-3xl">
            <AssetDetails asset={value} lookups={lookups} />
          </div>
        </TabsContent>
        <TabsContent value="history">
          <HistoryTimeline
            events={historyEvents}
            loading={history.isLoading}
            error={history.error}
            hasMore={!!history.hasNextPage}
            loadingMore={history.isFetchingNextPage}
            onMore={() => void history.fetchNextPage()}
            filter={historyFilter}
            onFilterChange={setHistoryFilter}
            onRetry={() => void history.refetch()}
          />
        </TabsContent>
        <TabsContent value="repairs">
          <p className="text-base text-muted">{t('assetView.tabPlaceholder')}</p>
        </TabsContent>
        <TabsContent value="attachments">
          {can('attachment:read') ? (
            <AttachmentsPanel
              entityType="asset"
              entityId={id}
              canWrite={can('attachment:write') && !archived}
            />
          ) : (
            <p className="text-base text-muted">{t('files.noAccess')}</p>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t('assetView.archiveTitle', { tag: value.asset_tag })}
        description={t('assetView.archiveDescription')}
        confirmLabel={t('common.archive')}
        destructive
        onConfirm={async () => {
          await assetsApi.archive(id, etag);
          await refresh();
          toast({ variant: 'success', title: t('assetView.archived') });
        }}
      />
    </>
  );
}
