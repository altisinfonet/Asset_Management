'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Plus, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { repairsApi } from '@/lib/repairs/api';
import { LogRepairDialog } from './repair-dialogs';
import { RepairDrawer } from './repair-drawer';
import { RepairTable, useMoneyText } from './repair-parts';

/**
 * The Repairs tab of an asset (WEB-17, M2-MNT-02): its repairs newest first with the total cost,
 * "Log repair" for people who may, and the same drawer as the Repairs page for details, receipts
 * and closing.
 */
export function AssetRepairs({
  asset,
  archived,
}: {
  asset: { id: string; asset_tag: string };
  archived: boolean;
}) {
  const { t } = useI18n();
  const { can } = useAuth();
  const money = useMoneyText();
  const [logging, setLogging] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['repairs', 'asset', asset.id],
    queryFn: ({ pageParam }) =>
      repairsApi.list({ asset_id: asset.id, limit: 50, cursor: pageParam, sort: ['-reported_at'] }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.has_more ? (last.page.next_cursor ?? undefined) : undefined,
  });
  const rows = list.data?.pages.flatMap((page) => page.data) ?? [];
  // The totals come from the API, per currency and without the cancelled ones, whatever the list shows.
  const summary = useQuery({
    queryKey: ['repairs', 'summary', asset.id],
    queryFn: () => repairsApi.summary(asset.id),
  });
  const count = summary.data?.total_count ?? 0;
  const amount = (summary.data?.total_cost ?? []).map((total) => money(total)).join(', ');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base" data-testid="repairs-summary">
          {count === 0
            ? ''
            : amount
              ? t('repairs.assetTab.summary', { count, amount })
              : t('repairs.assetTab.summaryNoCost', { count })}
        </p>
        {can('repair:manage') && !archived ? (
          <Button variant="primary" onClick={() => setLogging(true)}>
            <Plus aria-hidden className="size-4" />
            {t('repairs.log')}
          </Button>
        ) : null}
      </div>

      {list.error ? (
        <Banner
          tone="danger"
          action={<Button onClick={() => void list.refetch()}>{t('common.retry')}</Button>}
        >
          {t('repairs.loadFailed')}
        </Banner>
      ) : null}
      {list.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <RepairTable
          rows={rows}
          showAsset={false}
          label={t('repairs.tableLabel')}
          onOpen={(repair) => setOpenId(repair.id)}
          empty={
            <EmptyState
              icon={Wrench}
              title={t('repairs.assetTab.none')}
              description={t('repairs.assetTab.noneHint')}
            />
          }
        />
      )}
      {list.hasNextPage ? (
        <div>
          <Button
            size="sm"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('repairs.assetTab.loadMore')}
          </Button>
        </div>
      ) : null}

      <LogRepairDialog open={logging} onOpenChange={setLogging} asset={asset} />
      <RepairDrawer repairId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
