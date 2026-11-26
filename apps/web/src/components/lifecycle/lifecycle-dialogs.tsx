'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { FormDialog, type FormFieldSpec, type FormValues } from '@/components/registry/form-dialog';
import { LocationPicker } from '@/components/registry/location-picker';
import { Banner } from '@/components/ui/banner';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { createKeyKeeper, today } from '@/lib/custody/helpers';
import { lifecycleApi } from '@/lib/registry/api';
import type { BulkItem, BulkResult } from '@/lib/registry/bulk';
import {
  DISPOSAL_REASONS,
  disposeBody,
  markFoundBody,
  markLostBody,
  statusChoices,
} from '@/lib/registry/lifecycle';
import { useLookups } from '@/lib/registry/queries';
import type { Asset } from '@/lib/registry/types';

/**
 * The lost, found and dispose actions of an asset (M2-LIFE-05, WEB screens of v0.2.8). Each is a
 * form dialog over its own API call (`POST /v1/assets/{id}/mark-lost`, `mark-found`, `dispose`)
 * with a retry key and the ETag the user saw (`If-Match`, a changed asset is `412`). A refusal of
 * the API (409: already lost, checked out, accessories still on it) stays in the dialog.
 */

type DialogBase = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset;
  /** ETag of the asset as the page shows it. */
  etag?: string;
  /** After the action: the asset's queries have been refreshed. */
  onDone?: (asset: Asset) => void;
};

const useAssetRefresh = () => {
  const client = useQueryClient();
  return async (id: string) => {
    await client.invalidateQueries({ queryKey: ['asset', id] });
    await client.invalidateQueries({ queryKey: ['asset-history', id] });
    await client.invalidateQueries({ queryKey: ['assets'] });
    await client.invalidateQueries({ queryKey: ['asset-source'] });
  };
};

/** "Mark as lost or stolen": also offered while the asset is checked out (the check-out is closed). */
export function MarkLostDialog({ open, onOpenChange, asset, etag, onDone }: DialogBase) {
  const { t } = useI18n();
  const { toast } = useToast();
  const lookups = useLookups();
  const refresh = useAssetRefresh();
  const keys = useRef(createKeyKeeper());
  const statuses = statusChoices(lookups.statuses, 'lost');
  const holder = asset.current_assignment;

  const fields: FormFieldSpec[] = [
    ...(statuses.length > 1
      ? [
          {
            name: 'status_id',
            label: t('lifecycle.lost.status'),
            kind: 'select' as const,
            required: true,
            options: statuses,
          },
        ]
      : []),
    {
      name: 'note',
      label: t('lifecycle.lost.note'),
      kind: 'textarea',
      placeholder: t('lifecycle.lost.notePlaceholder'),
      maxLength: 2000,
    },
  ];

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('lifecycle.lost.title', { tag: asset.asset_tag })}
      description={t('lifecycle.lost.description')}
      fields={fields}
      initial={{ status_id: statuses[0]?.value ?? '', note: '' }}
      submitLabel={t('lifecycle.lost.submit')}
      footerNote={
        holder ? (
          <Banner tone="warning">
            <span data-testid="lost-closes-checkout">
              {t('lifecycle.lost.closesCheckout', { name: holder.target_name ?? '' })}
            </span>
          </Banner>
        ) : null
      }
      onSubmit={async (values) => {
        const body = markLostBody(values, statuses.length > 1);
        const result = await lifecycleApi.markLost(asset.id, body, {
          idempotencyKey: keys.current.keyFor(body),
          etag,
        });
        keys.current.renew();
        await refresh(asset.id);
        toast({ variant: 'success', title: t('lifecycle.lost.done', { tag: asset.asset_tag }) });
        onDone?.(result.value);
      }}
    />
  );
}

/** "Mark as found": a ready status again, and where the asset is now. */
export function MarkFoundDialog({ open, onOpenChange, asset, etag, onDone }: DialogBase) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { locationScope } = useAuth();
  const lookups = useLookups();
  const refresh = useAssetRefresh();
  const keys = useRef(createKeyKeeper());
  const statuses = statusChoices(lookups.statuses, 'deployable');
  const defaultStatus =
    lookups.statuses.find((s) => s.state_type === 'deployable' && s.is_default && !s.archived_at)
      ?.id ??
    statuses[0]?.value ??
    '';

  const fields: FormFieldSpec[] = [
    ...(statuses.length > 1
      ? [
          {
            name: 'status_id',
            label: t('lifecycle.found.status'),
            kind: 'select' as const,
            required: true,
            options: statuses,
          },
        ]
      : []),
    {
      name: 'location_id',
      label: t('lifecycle.found.location'),
      kind: 'custom',
      hint: t('lifecycle.found.locationHint'),
      // a location-scoped user keeps the asset inside the scope: no "none" (ED-26)
      required: !!locationScope,
      render: ({ control, value, set, invalid }) => (
        <LocationPicker
          {...control}
          invalid={invalid}
          value={String(value)}
          onChange={set}
          clearable={!locationScope}
          placeholder={locationScope ? undefined : t('common.none')}
        />
      ),
    },
    { name: 'note', label: t('lifecycle.found.note'), kind: 'textarea', maxLength: 2000 },
  ];

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('lifecycle.found.title', { tag: asset.asset_tag })}
      description={t('lifecycle.found.description')}
      fields={fields}
      initial={{ status_id: defaultStatus, location_id: asset.location_id ?? '', note: '' }}
      submitLabel={t('lifecycle.found.submit')}
      onSubmit={async (values) => {
        const body = markFoundBody(values, asset.location_id ?? null, statuses.length > 1);
        const result = await lifecycleApi.markFound(asset.id, body, {
          idempotencyKey: keys.current.keyFor(body),
          etag,
        });
        keys.current.renew();
        await refresh(asset.id);
        toast({ variant: 'success', title: t('lifecycle.found.done', { tag: asset.asset_tag }) });
        onDone?.(result.value);
      }}
    />
  );
}

/**
 * "Dispose": the reason, the date and a note; the asset is archived. With more than one asset (the
 * bulk bar) every asset is disposed of with its own request and the outcome is handed back per
 * asset; a failing one never stops the others.
 */
export function DisposeDialog({
  open,
  onOpenChange,
  assets,
  etag,
  onDone,
  onBulkDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assets: Asset[];
  /** ETag of the asset (single asset only). */
  etag?: string;
  onDone?: (asset: Asset) => void;
  /** Bulk: one result per asset (failures listed by the caller). */
  onBulkDone?: (results: BulkResult[]) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const lookups = useLookups();
  const refresh = useAssetRefresh();
  const keys = useRef(createKeyKeeper());
  const statuses = statusChoices(lookups.statuses, 'archived');
  // the bulk bar always goes the bulk way (results per asset), even for one selected asset
  const single = onBulkDone ? undefined : assets[0];
  const holder = single?.current_assignment;

  const fields: FormFieldSpec[] = [
    {
      name: 'reason',
      label: t('lifecycle.dispose.reason'),
      kind: 'select',
      required: true,
      placeholder: t('common.choose'),
      options: DISPOSAL_REASONS.map((reason) => ({
        value: reason,
        label: t(`lifecycle.dispose.reasons.${reason}`),
      })),
    },
    {
      name: 'disposed_on',
      label: t('lifecycle.dispose.date'),
      kind: 'date',
      hint: t('lifecycle.dispose.dateHint'),
      validate: (value) =>
        typeof value === 'string' && value > today()
          ? t('lifecycle.dispose.dateFuture')
          : undefined,
    },
    ...(statuses.length > 1
      ? [
          {
            name: 'status_id',
            label: t('lifecycle.dispose.status'),
            kind: 'select' as const,
            required: true,
            options: statuses,
          },
        ]
      : []),
    {
      name: 'note',
      label: t('lifecycle.dispose.note'),
      kind: 'textarea',
      placeholder: t('lifecycle.dispose.notePlaceholder'),
      maxLength: 2000,
    },
  ];

  const initial: FormValues = {
    reason: '',
    disposed_on: today(),
    status_id: statuses[0]?.value ?? '',
    note: '',
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        single
          ? t('lifecycle.dispose.title', { tag: single.asset_tag })
          : t('lifecycle.dispose.bulkTitle', { count: assets.length })
      }
      description={t('lifecycle.dispose.description')}
      fields={fields}
      initial={initial}
      submitLabel={
        single
          ? t('lifecycle.dispose.submit')
          : t('lifecycle.dispose.bulkSubmit', { count: assets.length })
      }
      footerNote={
        holder ? (
          <Banner tone="warning">
            <span data-testid="dispose-checked-out">
              {t('lifecycle.dispose.checkedOut', { name: holder.target_name ?? '' })}
            </span>
          </Banner>
        ) : !single ? (
          <p className="rounded-md bg-sunken p-3 font-tag text-sm">
            {assets
              .slice(0, 8)
              .map((a) => a.asset_tag)
              .join(', ')}
            {assets.length > 8 ? ', ...' : ''}
          </p>
        ) : null
      }
      onSubmit={async (values) => {
        const body = disposeBody(values, statuses.length > 1);
        if (single) {
          const result = await lifecycleApi.dispose(single.id, body, {
            idempotencyKey: keys.current.keyFor({ id: single.id, ...body }),
            etag,
          });
          keys.current.renew();
          await refresh(single.id);
          toast({
            variant: 'success',
            title: t('lifecycle.dispose.done', { tag: single.asset_tag }),
          });
          onDone?.(result.value);
          return;
        }
        const results: BulkResult[] = [];
        for (const asset of assets) {
          const item: BulkItem = { id: asset.id, label: asset.asset_tag };
          try {
            await lifecycleApi.dispose(asset.id, body, {
              idempotencyKey: createKeyKeeper().keyFor(body),
            });
            results.push({ item, ok: true });
          } catch (err) {
            results.push({ item, ok: false, error: getApi().toUiError(err) });
          }
        }
        await onBulkDone?.(results);
      }}
    />
  );
}
