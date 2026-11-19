'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { BulkResultsDialog } from '@/app/(app)/assets/bulk-dialogs';
import { UploadSlot } from '@/components/files/upload-slot';
import { AssetStatusBadge } from '@/components/registry/asset-details';
import { LocationPicker } from '@/components/registry/location-picker';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import {
  availableActions,
  CONDITIONS,
  createKeyKeeper,
  holderOf,
  noteWithCondition,
  today,
  type Condition,
  type CustodyAction,
} from '@/lib/custody/helpers';
import { uiErrorText } from '@/lib/error-text';
import { assetsApi, custodyApi } from '@/lib/registry/api';
import type { BulkResult } from '@/lib/registry/bulk';
import { useLookups, type Lookups } from '@/lib/registry/queries';
import type {
  Asset,
  CheckinRequest,
  CheckoutRequest,
  CustodyResult,
  TransferRequest,
  TransferResult,
} from '@/lib/registry/types';
import {
  EMPTY_TARGET,
  ReturnDateField,
  TargetFields,
  targetBody,
  targetId,
  type TargetState,
} from './target-fields';

/** What opens the dialog: the assets, and which tab to start on. More than one asset is a bulk action. */
export interface CustodyRequest {
  assets: Asset[];
  action: CustodyAction;
  /** Called after at least one asset changed hands (refresh whatever lists them). */
  onDone?: () => void;
}

const NONE = '__none__';
const ASSET_EXPAND = ['model', 'category', 'location', 'vendor'] as const;

export interface CustodyDialogProps {
  request: CustodyRequest | null;
  onClose: () => void;
}

/**
 * Check out, check in and transfer (WEB-13, M2-LIFE-07). One dialog for one asset (tabs by what its
 * state allows) or for a selection (bulk check-out to one person, bulk check-in). Every request
 * carries an `Idempotency-Key` (kept while the body is unchanged, so a retry after a dropped
 * connection cannot apply twice) and the asset's `If-Match`; a changed asset (`412`) or one that
 * is already out (`409`) shows a banner with a refresh path instead of failing silently.
 */
export function CustodyDialog({ request, onClose }: CustodyDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        {request ? (
          <CustodyBody request={request} onClose={onClose} />
        ) : (
          <>
            <DialogTitle className="sr-only">{t('custody.title')}</DialogTitle>
            <DialogDescription className="sr-only">{t('custody.title')}</DialogDescription>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CustodyBody({ request, onClose }: { request: CustodyRequest; onClose: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const lookups = useLookups();
  const bulk = request.assets.length > 1;
  const first = request.assets[0]!;

  // One asset: load it fresh, so the form acts on its current state and ETag.
  const detail = useQuery({
    queryKey: ['asset', first.id],
    queryFn: () => assetsApi.get(first.id, [...ASSET_EXPAND]),
    enabled: !bulk,
    retry: false,
  });
  const asset = detail.data?.value ?? first;
  const etag = bulk ? undefined : detail.data?.etag;
  const reload = async () => {
    await detail.refetch();
  };

  const tabs = bulk ? [request.action] : availableActions(asset, can);
  const [chosen, setChosen] = useState<CustodyAction>(request.action);
  const action: CustodyAction = tabs.includes(chosen) ? chosen : (tabs[0] ?? request.action);
  const loading = !bulk && detail.isLoading;

  const title = bulk
    ? t(`custody.bulkTitles.${action}`, { count: request.assets.length })
    : t(`custody.titles.${action}`, { tag: asset.asset_tag });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{tabs.length === 0 ? t('custody.title') : title}</DialogTitle>
        <DialogDescription>{t(`custody.description.${action}`)}</DialogDescription>
      </DialogHeader>

      <AssetSummary assets={request.assets} asset={asset} lookups={lookups} bulk={bulk} />

      {loading ? (
        <div role="status" className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <span className="sr-only">{t('common.loading')}</span>
        </div>
      ) : detail.error && !detail.data ? (
        <Banner
          tone="danger"
          action={<Button onClick={() => void reload()}>{t('common.retry')}</Button>}
        >
          {uiErrorText(t, getApi().toUiError(detail.error))}
        </Banner>
      ) : tabs.length === 0 ? (
        <>
          <Banner tone="info">{t('custody.noneAvailable')}</Banner>
          <DialogFooter>
            <Button onClick={onClose}>{t('common.close')}</Button>
          </DialogFooter>
        </>
      ) : (
        <Tabs value={action} onValueChange={(value) => setChosen(value as CustodyAction)}>
          {tabs.length > 1 ? (
            <TabsList aria-label={t('custody.tabsLabel')}>
              {tabs.map((tab) => (
                <TabsTrigger key={tab} value={tab}>
                  {t(`custody.tabs.${tab}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          ) : null}
          {tabs.map((tab) => (
            <TabsContent key={tab} value={tab} className={tabs.length > 1 ? 'pt-4' : 'pt-0'}>
              <CustodyForm
                action={tab}
                assets={request.assets}
                asset={asset}
                etag={etag}
                lookups={lookups}
                onReload={reload}
                onClose={onClose}
                onDone={request.onDone}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </>
  );
}

function AssetSummary({
  assets,
  asset,
  lookups,
  bulk,
}: {
  assets: Asset[];
  asset: Asset;
  lookups: Lookups;
  bulk: boolean;
}) {
  const { t } = useI18n();
  if (bulk) {
    const shown = assets.slice(0, 6).map((a) => a.asset_tag);
    return (
      <div className="rounded-md bg-sunken p-3 text-base">
        <p className="font-medium">{t('custody.bulkSelected', { count: assets.length })}</p>
        <p className="font-tag text-sm">
          {shown.join(', ')}
          {assets.length > shown.length
            ? `, ${t('custody.andMore', { count: assets.length - shown.length })}`
            : ''}
        </p>
      </div>
    );
  }
  const holder = holderOf(asset);
  const location = lookups.locationLabel(asset.location_id);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-sunken p-3 text-base">
      <span className="font-tag font-medium" data-testid="custody-asset-tag">
        {asset.asset_tag}
      </span>
      <span className="min-w-0 truncate">{asset.name ?? ''}</span>
      <AssetStatusBadge asset={asset} lookups={lookups} />
      {holder ? (
        <span className="text-muted">{t('custody.heldBy', { name: holder.name })}</span>
      ) : location ? (
        <span className="text-muted">{location}</span>
      ) : null}
    </div>
  );
}

// ---- the three forms -------------------------------------------------------------------------------

interface FormProps {
  action: CustodyAction;
  assets: Asset[];
  asset: Asset;
  etag: string | undefined;
  lookups: Lookups;
  onReload: () => Promise<void>;
  onClose: () => void;
  onDone?: () => void;
}

function CustodyForm(props: FormProps) {
  return props.action === 'checkout' ? (
    <CheckoutForm {...props} />
  ) : props.action === 'checkin' ? (
    <CheckinForm {...props} />
  ) : (
    <TransferForm {...props} />
  );
}

type FieldErrors = Record<string, string>;

/** `errors[].pointer` (`/person_id`) of a 422, by member name. */
function fieldErrorsOf(ui: UiError): FieldErrors {
  const out: FieldErrors = {};
  for (const fe of ui.fieldErrors) out[fe.pointer.replace(/^\//, '')] = fe.message;
  return out;
}

/** Shared mechanics of the three forms: submit state, the banner for an error, refresh after success. */
function useCustodyFlow({ assets, asset, etag, onClose, onDone, onReload }: FormProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  // The refusal and the version of the asset it was about: a reload (new ETag) makes it obsolete.
  const [failure, setFailure] = useState<{ ui: UiError; atEtag: string | undefined } | null>(null);
  const error = failure && failure.atEtag === etag ? failure.ui : null;
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const keeper = useRef(createKeyKeeper());
  const bulkKeys = useRef(new Map<string, ReturnType<typeof createKeyKeeper>>());

  const refresh = async () => {
    await Promise.all(
      [
        'asset',
        'assets',
        'asset-history',
        'people',
        'person-held',
        'person-history',
        'locations',
      ].map((key) => client.invalidateQueries({ queryKey: [key] })),
    );
  };

  /**
   * Run `call` for the asset (or each asset of a bulk action) and report. `describe` is the toast
   * text of one success. Returns after closing the dialog on success.
   */
  const submit = async <R,>(
    body: object,
    call: (asset: Asset, key: string, etag: string | undefined) => Promise<R>,
    describe: (asset: Asset, result: R) => string,
    bulkDone: (count: number) => string,
  ) => {
    setBusy(true);
    setFailure(null);
    setFieldErrors({});
    try {
      if (assets.length === 1) {
        const target = assets[0]!;
        const result = await call(target, keeper.current.keyFor(body), etag);
        keeper.current.renew();
        await refresh();
        toast({ variant: 'success', title: describe(target, result) });
        onDone?.();
        onClose();
        return;
      }
      const outcome: BulkResult[] = [];
      for (const item of assets) {
        const keyKeeper = bulkKeys.current.get(item.id) ?? createKeyKeeper();
        bulkKeys.current.set(item.id, keyKeeper);
        try {
          await call(item, keyKeeper.keyFor(body), undefined);
          bulkKeys.current.delete(item.id);
          outcome.push({ item: { id: item.id, label: item.asset_tag }, ok: true });
        } catch (err) {
          outcome.push({
            item: { id: item.id, label: item.asset_tag },
            ok: false,
            error: getApi().toUiError(err),
          });
        }
      }
      await refresh();
      const failed = outcome.filter((r) => !r.ok);
      if (outcome.length > failed.length) onDone?.();
      if (failed.length === 0) {
        toast({ variant: 'success', title: bulkDone(outcome.length) });
        onClose();
      } else {
        setResults(outcome);
      }
    } catch (err) {
      const ui = getApi().toUiError(err);
      setFieldErrors(fieldErrorsOf(ui));
      setFailure({ ui, atEtag: etag });
      // A definitive refusal changes the situation; a dropped connection keeps the key for the retry.
      if (ui.kind !== 'network' && ui.kind !== 'server') keeper.current.renew();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  };

  const banner = error ? <CustodyError error={error} asset={asset} onReload={onReload} /> : null;
  const resultsDialog = (
    <BulkResultsDialog
      results={results}
      title={t('custody.resultsTitle')}
      onClose={() => {
        const failedIds = new Set((results ?? []).filter((r) => !r.ok).map((r) => r.item.id));
        setResults(null);
        if (failedIds.size === 0) onClose();
      }}
    />
  );
  return { busy, error, fieldErrors, submit, onKeyDown, banner, resultsDialog };
}

function CustodyError({
  error,
  asset,
  onReload,
}: {
  error: UiError;
  asset: Asset;
  onReload: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [reloading, setReloading] = useState(false);
  const holder = holderOf(asset);
  const reloadButton = (
    <Button
      loading={reloading}
      onClick={async () => {
        setReloading(true);
        try {
          await onReload();
        } finally {
          setReloading(false);
        }
      }}
    >
      {t('custody.reload')}
    </Button>
  );
  if (error.code === 'asset-already-checked-out') {
    return (
      <Banner tone="danger" title={t('custody.errors.alreadyOutTitle')} action={reloadButton}>
        {t('custody.errors.alreadyOut', { holder: holder?.name ?? t('custody.errors.someone') })}
      </Banner>
    );
  }
  if (error.code === 'asset-not-checked-out') {
    return (
      <Banner tone="danger" title={t('custody.errors.notOutTitle')} action={reloadButton}>
        {t('custody.errors.notOut')}
      </Banner>
    );
  }
  if (error.kind === 'stale') {
    return (
      <Banner tone="warning" title={t('custody.errors.staleTitle')} action={reloadButton}>
        {t('custody.errors.stale')}
      </Banner>
    );
  }
  return (
    <Banner tone="danger" title={uiErrorText(t, error)}>
      {error.kind === 'network' ? t('custody.errors.retrySafe') : null}
      {error.requestId ? (
        <span className="mt-1 block font-tag text-xs">
          {t('access.requestId', { id: error.requestId })}
        </span>
      ) : null}
    </Banner>
  );
}

function Footer({
  busy,
  disabled,
  label,
  onCancel,
  hint,
}: {
  busy: boolean;
  disabled?: boolean;
  label: string;
  onCancel: () => void;
  hint?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <DialogFooter className="items-center">
      {hint ? <p className="mr-auto text-sm text-muted">{hint}</p> : null}
      <Button onClick={onCancel}>{t('common.cancel')}</Button>
      <Button type="submit" variant="primary" loading={busy} disabled={disabled}>
        {label}
      </Button>
    </DialogFooter>
  );
}

function NoteField({
  value,
  onChange,
  error,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  label: string;
}) {
  return (
    <Field label={label} error={error}>
      {(control) => (
        <Textarea
          {...control}
          invalid={!!error}
          maxLength={2000}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

// ---- check out -------------------------------------------------------------------------------------

function CheckoutForm(props: FormProps) {
  const { t } = useI18n();
  const flow = useCustodyFlow(props);
  const [target, setTarget] = useState<TargetState>(EMPTY_TARGET);
  const [expected, setExpected] = useState('');
  const [note, setNote] = useState('');
  const [local, setLocal] = useState<FieldErrors>({});
  const errors = { ...flow.fieldErrors, ...local };
  const targetError =
    local.target ?? errors.person_id ?? errors.location_id ?? errors.target_asset_id;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next: FieldErrors = {};
    if (!targetId(target)) next.target = t('custody.errors.targetRequired');
    if (expected && expected < today()) next.expected_return = t('custody.errors.pastDate');
    setLocal(next);
    if (Object.keys(next).length > 0) return;
    const body: CheckoutRequest = {
      ...targetBody(target),
      ...(expected ? { expected_return: expected } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const who =
      target.type === 'person'
        ? (target.person?.display_name ?? '')
        : target.type === 'location'
          ? props.lookups.locationLabel(target.location)
          : (target.asset?.label ?? '');
    void flow.submit<CustodyResult>(
      body,
      (asset, key, etag) =>
        custodyApi.checkout(asset.id, body, { idempotencyKey: key, etag }).then((o) => o.result),
      (asset) => t('custody.toast.checkedOut', { tag: asset.asset_tag, name: who }),
      (count) => t('custody.toast.bulkCheckedOut', { count, name: who }),
    );
  };

  return (
    <form onSubmit={onSubmit} onKeyDown={flow.onKeyDown} noValidate className="flex flex-col gap-4">
      {flow.banner}
      <TargetFields
        legend={t('custody.checkout.to')}
        value={target}
        onChange={setTarget}
        error={targetError}
        excludeAssetId={props.assets[0]?.id}
        autoFocus
      />
      <ReturnDateField
        label={t('custody.expectedReturn')}
        value={expected}
        onChange={setExpected}
        error={errors.expected_return}
      />
      <NoteField label={t('custody.note')} value={note} onChange={setNote} error={errors.note} />
      <Footer
        busy={flow.busy}
        label={t('custody.checkout.submit')}
        onCancel={props.onClose}
        hint={t('custody.shortcut')}
      />
      {flow.resultsDialog}
    </form>
  );
}

// ---- check in --------------------------------------------------------------------------------------

function CheckinForm(props: FormProps) {
  const { t } = useI18n();
  const flow = useCustodyFlow(props);
  const single = props.assets.length === 1;
  const [condition, setCondition] = useState<Condition | ''>('');
  const [statusId, setStatusId] = useState('');
  const [locationId, setLocationId] = useState(single ? (props.asset.location_id ?? '') : '');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const errors = flow.fieldErrors;

  const returnable = props.lookups.statuses.filter(
    (s) => !s.archived_at && ['deployable', 'pending', 'undeployable'].includes(s.state_type),
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = noteWithCondition(
      note,
      condition,
      (c) => t(`custody.conditions.${c}`),
      t('custody.checkin.conditionPrefix'),
    );
    const body: CheckinRequest = {
      ...(statusId ? { status_id: statusId } : {}),
      ...(locationId ? { checkin_location_id: locationId } : {}),
      ...(text ? { note: text } : {}),
      ...(photos.length > 0 ? { attachment_ids: photos } : {}),
    };
    void flow.submit<CustodyResult>(
      body,
      (asset, key, etag) =>
        custodyApi.checkin(asset.id, body, { idempotencyKey: key, etag }).then((o) => o.result),
      (asset) => t('custody.toast.checkedIn', { tag: asset.asset_tag }),
      (count) => t('custody.toast.bulkCheckedIn', { count }),
    );
  };

  return (
    <form onSubmit={onSubmit} onKeyDown={flow.onKeyDown} noValidate className="flex flex-col gap-4">
      {flow.banner}
      <Field label={t('custody.checkin.condition')} hint={t('custody.checkin.conditionHint')}>
        {(control) => (
          <Select
            {...control}
            value={condition || NONE}
            onValueChange={(v) => setCondition(v === NONE ? '' : (v as Condition))}
            options={[
              { value: NONE, label: t('custody.conditions.none') },
              ...CONDITIONS.map((c) => ({ value: c, label: t(`custody.conditions.${c}`) })),
            ]}
          />
        )}
      </Field>
      <Field label={t('custody.checkin.statusAfter')} error={errors.status_id}>
        {(control) => (
          <Select
            {...control}
            value={statusId || NONE}
            onValueChange={(v) => setStatusId(v === NONE ? '' : v)}
            options={[
              { value: NONE, label: t('custody.checkin.statusDefault') },
              ...returnable.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        )}
      </Field>
      <Field
        label={t('custody.checkin.locationAfter')}
        hint={single ? undefined : t('custody.checkin.locationBulkHint')}
        error={errors.checkin_location_id}
      >
        {(control) => (
          <LocationPicker
            {...control}
            invalid={!!errors.checkin_location_id}
            clearable
            value={locationId}
            onChange={setLocationId}
            placeholder={single ? undefined : t('custody.checkin.keepLocation')}
          />
        )}
      </Field>
      <NoteField label={t('custody.note')} value={note} onChange={setNote} error={errors.note} />
      {single ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-base font-medium">{t('custody.checkin.photo')}</span>
          <UploadSlot
            entityType="asset"
            entityId={props.asset.id}
            kind="photo"
            value={photos}
            onChange={setPhotos}
            onBusyChange={setUploading}
          />
        </div>
      ) : null}
      <Footer
        busy={flow.busy}
        disabled={uploading}
        label={t('custody.checkin.submit')}
        onCancel={props.onClose}
        hint={uploading ? t('custody.waitingForPhoto') : t('custody.shortcut')}
      />
      {flow.resultsDialog}
    </form>
  );
}

// ---- transfer --------------------------------------------------------------------------------------

function TransferForm(props: FormProps) {
  const { t } = useI18n();
  const flow = useCustodyFlow(props);
  const holder = holderOf(props.asset);
  const [target, setTarget] = useState<TargetState>(EMPTY_TARGET);
  const [toLocation, setToLocation] = useState('');
  const [expected, setExpected] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [local, setLocal] = useState<FieldErrors>({});
  const errors = { ...flow.fieldErrors, ...local };
  const targetError =
    local.target ?? errors.person_id ?? errors.location_id ?? errors.target_asset_id;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next: FieldErrors = {};
    if (!targetId(target)) next.target = t('custody.errors.targetRequired');
    if (expected && expected < today()) next.expected_return = t('custody.errors.pastDate');
    setLocal(next);
    if (Object.keys(next).length > 0) return;
    const body: TransferRequest = {
      ...targetBody(target),
      ...(toLocation ? { to_location_id: toLocation } : {}),
      ...(expected ? { expected_return: expected } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const who =
      target.type === 'person'
        ? (target.person?.display_name ?? '')
        : target.type === 'location'
          ? props.lookups.locationLabel(target.location)
          : (target.asset?.label ?? '');
    void flow.submit<TransferResult>(
      body,
      (asset, key, etag) =>
        custodyApi.transfer(asset.id, body, { idempotencyKey: key, etag }).then((o) => o.result),
      (asset) => t('custody.toast.transferred', { tag: asset.asset_tag, name: who }),
      (count) => t('custody.toast.bulkCheckedOut', { count, name: who }),
    );
  };

  return (
    <form onSubmit={onSubmit} onKeyDown={flow.onKeyDown} noValidate className="flex flex-col gap-4">
      {flow.banner}
      <p className="text-base">
        <span className="text-muted">{t('custody.transfer.from')} </span>
        <span className="font-medium">{holder?.name ?? ''}</span>
      </p>
      <TargetFields
        legend={t('custody.transfer.to')}
        value={target}
        onChange={setTarget}
        error={targetError}
        excludeAssetId={props.asset.id}
        autoFocus
      />
      <Field
        label={t('custody.transfer.toLocation')}
        hint={t('custody.transfer.toLocationHint')}
        error={errors.to_location_id}
      >
        {(control) => (
          <LocationPicker
            {...control}
            invalid={!!errors.to_location_id}
            clearable
            value={toLocation}
            onChange={setToLocation}
          />
        )}
      </Field>
      <ReturnDateField
        label={t('custody.expectedReturn')}
        value={expected}
        onChange={setExpected}
        error={errors.expected_return}
      />
      <Field label={t('custody.transfer.reason')} error={errors.reason}>
        {(control) => (
          <input
            {...control}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-(--size-control) w-full rounded-md border border-border-strong bg-surface px-3 text-md text-text sm:text-base"
          />
        )}
      </Field>
      <NoteField label={t('custody.note')} value={note} onChange={setNote} error={errors.note} />
      <Footer
        busy={flow.busy}
        label={t('custody.transfer.submit')}
        onCancel={props.onClose}
        hint={t('custody.shortcut')}
      />
      {flow.resultsDialog}
    </form>
  );
}
