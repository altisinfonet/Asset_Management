'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Play, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { AttachmentsPanel } from '@/components/files/attachments-panel';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { uiErrorText } from '@/lib/error-text';
import { useLookups } from '@/lib/registry/queries';
import { repairsApi } from '@/lib/repairs/api';
import { isClosed } from '@/lib/repairs/helpers';
import { routes } from '@/lib/routes';
import { RepairStatusBadge, useMoneyText } from './repair-parts';
import { CompleteRepairDialog } from './repair-dialogs';

/**
 * One repair in a drawer (WEB-17): what was recorded, the quotes, receipts and photos, and the
 * actions that fit its state (start work, close, cancel). Opened from the Repairs page and from an
 * asset's Repairs tab.
 */
export function RepairDrawer({
  repairId,
  onClose,
}: {
  repairId: string | null;
  onClose: () => void;
}) {
  const { t, formatDate } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const lookups = useLookups();
  const money = useMoneyText();
  const [closing, setClosing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const repair = useQuery({
    queryKey: ['repairs', 'one', repairId],
    queryFn: () => repairsApi.get(repairId!),
    enabled: !!repairId,
    retry: false,
  });
  const value = repair.data?.value;
  const etag = repair.data?.etag;
  const manage = can('repair:manage');

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['repairs'] });
    await client.invalidateQueries({ queryKey: ['asset'] });
    await client.invalidateQueries({ queryKey: ['asset-history'] });
    await client.invalidateQueries({ queryKey: ['assets'] });
  };

  const change = async (status: 'in_progress' | 'cancelled', done: string) => {
    if (!value) return;
    await repairsApi.update(value.id, { status }, etag);
    await refresh();
    toast({ variant: 'success', title: done });
  };

  const rows: Array<[string, ReactNode]> = value
    ? [
        [t('repairs.detail.status'), <RepairStatusBadge key="s" status={value.status} />],
        [t('repairs.detail.kind'), t(`repairs.kinds.${value.kind ?? 'repair'}`)],
        [
          t('repairs.detail.asset'),
          value.asset_tag ? (
            <Link
              key="a"
              href={routes.assetView(value.asset_id)}
              className="rounded-sm font-tag text-primary-text underline underline-offset-2"
            >
              {value.asset_tag}
              {value.asset_name ? ` ${value.asset_name}` : ''}
            </Link>
          ) : (
            ''
          ),
        ],
        [t('repairs.detail.reported'), value.reported_at ? formatDate(value.reported_at) : ''],
        [t('repairs.detail.started'), value.started_at ? formatDate(value.started_at) : ''],
        [t('repairs.detail.completed'), value.completed_at ? formatDate(value.completed_at) : ''],
        [t('repairs.detail.vendor'), lookups.vendorById.get(value.vendor_id ?? '')?.name ?? ''],
        [t('repairs.detail.ticket'), value.ticket_ref ?? ''],
        [t('repairs.detail.cost'), money(value.cost)],
        [t('repairs.detail.what'), value.description ?? ''],
        [t('repairs.detail.resolution'), value.resolution_notes ?? ''],
      ]
    : [];

  return (
    <>
      <Drawer open={!!repairId} onOpenChange={(open) => !open && onClose()}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{value?.title ?? t('repairs.detail.title')}</DrawerTitle>
            <DrawerDescription>{t('repairs.detail.description')}</DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            {repair.isLoading ? <Skeleton className="h-40 w-full" /> : null}
            {repair.error ? (
              <Banner tone="danger">
                {getApi().toUiError(repair.error).kind === 'not_found'
                  ? t('repairs.detail.notFound')
                  : uiErrorText(t, getApi().toUiError(repair.error))}
              </Banner>
            ) : null}
            {value ? (
              <div className="flex flex-col gap-5">
                <dl className="grid grid-cols-[minmax(6rem,8rem)_1fr] gap-x-4 gap-y-2 text-base">
                  {rows.map(([label, content]) => (
                    <div key={label} className="contents">
                      <dt className="text-muted">{label}</dt>
                      <dd className="min-w-0 break-words">
                        {content || <span className="text-muted">{'-'}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
                {can('attachment:read') ? (
                  <section aria-label={t('repairs.detail.files')} className="flex flex-col gap-2">
                    <h3 className="text-base font-semibold">{t('repairs.detail.files')}</h3>
                    <AttachmentsPanel
                      entityType="maintenance_record"
                      entityId={value.id}
                      canWrite={can('attachment:write') && !isClosed(value)}
                    />
                  </section>
                ) : null}
              </div>
            ) : null}
          </DrawerBody>
          <DrawerFooter>
            {value && manage && value.status === 'open' ? (
              <Button
                onClick={() =>
                  void change('in_progress', t('repairs.started')).catch((err: unknown) => {
                    const ui = getApi().toUiError(err);
                    toast({
                      variant: 'danger',
                      title: uiErrorText(t, ui),
                      requestId: ui.requestId,
                    });
                  })
                }
              >
                <Play aria-hidden className="size-4" />
                {t('repairs.start')}
              </Button>
            ) : null}
            {value && manage && !isClosed(value) ? (
              <>
                <Button onClick={() => setCancelling(true)}>
                  <XCircle aria-hidden className="size-4" />
                  {t('repairs.cancelRepair')}
                </Button>
                <Button variant="primary" onClick={() => setClosing(true)}>
                  <CircleCheck aria-hidden className="size-4" />
                  {t('repairs.complete')}
                </Button>
              </>
            ) : null}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      <CompleteRepairDialog
        open={closing}
        onOpenChange={setClosing}
        repair={value ?? null}
        etag={etag}
      />
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t('repairs.cancelTitle')}
        description={t('repairs.cancelDescription')}
        confirmLabel={t('repairs.cancelConfirm')}
        destructive
        onConfirm={() => change('cancelled', t('repairs.cancelled'))}
      />
    </>
  );
}
