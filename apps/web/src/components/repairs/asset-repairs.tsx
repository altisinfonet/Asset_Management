'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Plus, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { repairsApi } from '@/lib/repairs/api';
import { totalCost } from '@/lib/repairs/helpers';
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
  const totals = totalCost(rows.filter((repair) => repair.status !== 'cancelled'));
  const amount = totals.map((total) => money(total)).join(', ');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base" data-testid="repairs-summary">
          {rows.length === 0
            ? ''
            : amount
              ? t('repairs.assetTab.summary', { count: rows.length, amount })
              : t('repairs.assetTab.summaryNoCost', { count: rows.length })}
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
