'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Printer } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Banner } from '@/components/ui/banner';
import { Button, IconButton } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/cn';
import { createKeyKeeper } from '@/lib/custody/helpers';
import { uiErrorText } from '@/lib/error-text';
import {
  isBatchFinished,
  labelsApi,
  type LabelBatch,
  type LabelBatchCreate,
  type LabelField,
  type LabelTemplate,
} from '@/lib/labels/api';
import {
  LABEL_FIELDS,
  MAX_LABELS,
  codesFrom,
  codesOf,
  isSingleLabel,
  knownFields,
  readLabelChoice,
  sameSet,
  sheetCount,
  showsBarcode,
  showsQr,
  slotsPerSheet,
  toLabelFilter,
  writeLabelChoice,
} from '@/lib/labels/helpers';
import { assetsApi, type AssetListQuery } from '@/lib/registry/api';
import { useLookups } from '@/lib/registry/queries';
import type { Asset } from '@/lib/registry/types';
import { LabelPreview, type LabelSample } from './label-preview';
import { CELL_STYLE, SheetGrid } from './sheet-grid';

/**
 * What to print: assets already chosen (a selection, one asset), everything a list filter shows, or
 * a batch that was already requested (the notification "your labels are ready" opens it).
 */
export type LabelsRequest =
  | { kind: 'assets'; assets: Asset[] }
  | { kind: 'filter'; query: AssetListQuery; total?: number | null }
  | { kind: 'batch'; id: string };

type Phase =
  | { kind: 'edit' }
  | { kind: 'submitting' }
  | { kind: 'tracking'; batch: LabelBatch }
  | { kind: 'failed'; error: unknown };

interface Override {
  template_key?: string;
  qr?: boolean;
  barcode?: boolean;
  fields?: LabelField[];
  start?: number;
}

const PAGE = 200;
/** How often a queued batch is read again. */
const POLL_MS = 1500;
/** A ready batch is read again now and then so its short-lived download link stays valid. */
const REFRESH_READY_MS = 60_000;

interface Source {
  /** The assets to show a sample of (all of them for a selection, the first for a filter). */
  assets: Asset[];
  total: number;
}

/** Assets a filter shows, up to one more than a batch holds (so "too many" can be told apart). */
async function collectAssets(query: AssetListQuery): Promise<Source> {
  const found: Asset[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < MAX_LABELS / PAGE + 1; guard += 1) {
    const page = await assetsApi.list({
      ...query,
      cursor,
      limit: PAGE,
      include_total: false,
      expand: undefined,
    });
    found.push(...page.data);
    if (!page.page.has_more || !page.page.next_cursor || found.length > MAX_LABELS) break;
    cursor = page.page.next_cursor;
  }
  return { assets: found, total: found.length };
}

/** The first asset of a filter (for the preview) and how many assets the filter matches. */
async function headOfFilter(query: AssetListQuery): Promise<Source> {
  const page = await assetsApi.list({
    ...query,
    cursor: undefined,
    limit: 1,
    include_total: true,
    expand: undefined,
  });
  return { assets: page.data, total: page.page.total ?? page.data.length };
}

export interface LabelDialogProps {
  request: LabelsRequest | null;
  onClose: () => void;
}

/**
 * Print labels (WEB-15, M2-TAG-03): pick a sheet template, the first free position on a partly used
 * sheet (a visual grid), the codes and the text lines, check one label at its real size, then queue
 * the batch. The PDF is made in the background; the dialog follows the batch until it is ready (or
 * failed) and offers the download. The last template is remembered in this browser.
 */
export function LabelDialog({ request, onClose }: LabelDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" className="max-w-[960px]">
        {request ? (
          request.kind === 'batch' ? (
            <BatchOnly id={request.id} onClose={onClose} />
          ) : (
            <LabelBody request={request} onClose={onClose} />
          )
        ) : (
          <>
            <DialogTitle className="sr-only">{t('labels.title')}</DialogTitle>
            <DialogDescription className="sr-only">{t('labels.description')}</DialogDescription>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LabelBody({
  request,
  onClose,
}: {
  request: Exclude<LabelsRequest, { kind: 'batch' }>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { me } = useAuth();
  const lookups = useLookups();
  const remembered = useMemo(() => readLabelChoice(), []);
  const [override, setOverride] = useState<Override>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' });
  const [sheet, setSheet] = useState(1);
  const keys = useRef(createKeyKeeper());

  const templates = useQuery({
    queryKey: ['label-templates'],
    queryFn: () => labelsApi.templates(),
    staleTime: 5 * 60_000,
  });

  // A filter is sent as the filter itself unless it holds something a batch filter cannot say.
  const labelFilter = request.kind === 'filter' ? toLabelFilter(request.query) : null;
  const viaFilter = request.kind === 'filter' && labelFilter !== null;
  const rememberedTotal = request.kind === 'filter' ? (request.total ?? 0) : 0;
  const source = useQuery({
    queryKey: ['label-assets', request.kind === 'filter' ? request.query : null],
    queryFn: () =>
      viaFilter
        ? headOfFilter((request as { query: AssetListQuery }).query)
        : collectAssets((request as { query: AssetListQuery }).query),
    enabled: request.kind === 'filter' && rememberedTotal <= MAX_LABELS,
    staleTime: 0,
    gcTime: 0,
  });

  const assets: Asset[] = request.kind === 'assets' ? request.assets : (source.data?.assets ?? []);
  const knownTotal =
    request.kind === 'assets'
      ? request.assets.length
      : (request.total ?? source.data?.total ?? assets.length);
  const tooMany = (knownTotal ?? 0) > MAX_LABELS;
  const collecting = request.kind === 'filter' && !tooMany && source.isLoading;
  const count = tooMany ? (knownTotal ?? 0) : (source.data?.total ?? knownTotal ?? assets.length);

  const list = templates.data ?? [];
  const rememberedTemplate = list.find((tpl) => tpl.key === remembered?.template_key);
  const template: LabelTemplate | undefined =
    list.find((tpl) => tpl.key === override.template_key) ?? rememberedTemplate ?? list[0];
  const fromRemembered = !!template && remembered?.template_key === template.key;

  // What the template prints unless the user changed it (or the remembered choice for this template).
  const baseCodes =
    (fromRemembered && remembered?.codes) || (template ? codesOf(template) : ['qr']);
  const qr = override.qr ?? showsQr(baseCodes);
  const barcode = override.barcode ?? showsBarcode(baseCodes);
  const codes = codesFrom(qr, barcode);
  const fields: LabelField[] =
    override.fields ?? ((fromRemembered && remembered?.fields) || knownFields(template?.fields));
  const perSheet = template ? slotsPerSheet(template) : 1;
  const single = template ? isSingleLabel(template) : false;
  const start = single ? 1 : Math.min(override.start ?? 1, perSheet);
  const sheets = template ? sheetCount(count, start, template) : 0;
  const currentSheet = Math.min(sheet, Math.max(sheets, 1));

  const first = assets[0];
  const sample: LabelSample | null = first
    ? {
        tag: first.asset_tag,
        name: first.name ?? null,
        location: lookups.locationLabel(first.location_id).split(' > ').pop() ?? '',
        serial: first.serial ?? null,
        model: lookups.modelById.get(first.model_id ?? '')?.name ?? null,
        organisation: me?.tenant.name ?? '',
        code: first.label_code ?? first.asset_tag,
      }
    : null;

  const set = (patch: Override) => setOverride((current) => ({ ...current, ...patch }));

  const generate = async () => {
    if (!template || count === 0 || tooMany) return;
    const body: LabelBatchCreate = {
      template_key: template.key,
      ...(viaFilter && labelFilter
        ? { filter: labelFilter }
        : { asset_ids: assets.map((asset) => asset.id) }),
      ...(!single && start > 1 ? { start_position: start } : {}),
      // Only what differs from the template is sent, so a plain request stays a plain request.
      ...(sameSet(codes, codesOf(template)) ? {} : { codes }),
      ...(sameSet(fields, template.fields) ? {} : { fields }),
    };
    setPhase({ kind: 'submitting' });
    try {
      const batch = await labelsApi.createBatch(body, keys.current.keyFor(body));
      keys.current.renew();
      writeLabelChoice({ template_key: template.key, codes, fields });
      setSheet(1);
      setPhase({ kind: 'tracking', batch });
    } catch (err) {
      setPhase({ kind: 'failed', error: err });
    }
  };

  const labelsText = t('labels.labelCount', { count });
  const sourceText =
    request.kind === 'assets'
      ? t('labels.sourceSelection', { count })
      : t('labels.sourceFilter', { count });
  const busy = phase.kind === 'submitting';
  const canGenerate =
    !!template && count > 0 && !tooMany && !collecting && !busy && (!!sample || viaFilter);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {request.kind === 'assets' && request.assets.length === 1
            ? t('labels.titleOne', { tag: request.assets[0]!.asset_tag })
            : t('labels.title')}
        </DialogTitle>
        <DialogDescription>{t('labels.description')}</DialogDescription>
      </DialogHeader>

      {phase.kind === 'tracking' ? (
        <BatchProgress
          initial={phase.batch}
          onAgain={() => setPhase({ kind: 'edit' })}
          onClose={onClose}
        />
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
          className="flex flex-col gap-4"
        >
          {phase.kind === 'failed' ? (
            <FormError
              message={uiErrorText(t, getApi().toUiError(phase.error))}
              requestId={getApi().toUiError(phase.error).requestId}
            />
          ) : null}
          {tooMany ? (
            <Banner tone="warning">{t('labels.tooMany', { max: MAX_LABELS })}</Banner>
          ) : null}
          {request.kind === 'filter' && source.error ? (
            <Banner tone="danger">{t('labels.collectFailed')}</Banner>
          ) : null}
          {templates.error ? <Banner tone="danger">{t('labels.templatesFailed')}</Banner> : null}
          {request.kind === 'filter' && source.isSuccess && count === 0 ? (
            <Banner tone="info">{t('labels.nothingToPrint')}</Banner>
          ) : null}

          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              <p className="text-base font-medium" data-testid="labels-source">
                {collecting ? t('labels.collecting') : sourceText}
              </p>

              <Field label={t('labels.template')} hint={templateHint(t, template)}>
                {(control) => (
                  <Select
                    {...control}
                    disabled={busy || templates.isLoading}
                    value={template?.key ?? ''}
                    placeholder={templates.isLoading ? t('common.loading') : undefined}
                    onValueChange={(key) => {
                      setOverride({ template_key: key });
                      setSheet(1);
                    }}
                    options={list.map((tpl) => ({ value: tpl.key, label: tpl.name }))}
                  />
                )}
              </Field>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-base font-medium">{t('labels.codes')}</legend>
                <Checkbox
                  label={t('labels.codeQr')}
                  checked={qr}
                  disabled={busy}
                  onCheckedChange={(v) => set({ qr: v === true })}
                />
                <Checkbox
                  label={t('labels.codeBarcode')}
                  checked={barcode}
                  disabled={busy}
                  onCheckedChange={(v) => set({ barcode: v === true })}
                />
                {!qr && !barcode ? (
                  <p role="status" className="text-sm text-muted">
                    {t('labels.codesNone')}
                  </p>
                ) : null}
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-base font-medium">{t('labels.fields')}</legend>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {LABEL_FIELDS.map((field) => (
                    <Checkbox
                      key={field}
                      label={t(`labels.fieldNames.${field}`)}
                      checked={fields.includes(field)}
                      disabled={busy}
                      onCheckedChange={(v) =>
                        set({
                          fields: LABEL_FIELDS.filter((f) =>
                            f === field ? v === true : fields.includes(f),
                          ),
                        })
                      }
                    />
                  ))}
                </div>
              </fieldset>

              <div className="flex flex-col gap-1.5">
                <p className="text-base font-medium">{t('labels.preview')}</p>
                {template && sample ? (
                  <div className="overflow-x-auto pb-1">
                    <LabelPreview
                      template={template}
                      codes={codes}
                      fields={fields}
                      sample={sample}
                    />
                  </div>
                ) : (
                  <Skeleton className="h-24 w-48" />
                )}
                <p className="text-sm text-muted">{t('labels.previewNote')}</p>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-medium">{t('labels.sheetPreview')}</p>
                {template && sheets > 1 ? (
                  <span className="flex items-center gap-1">
                    <IconButton
                      icon={ChevronLeft}
                      size="icon-sm"
                      label={t('labels.previousSheet')}
                      disabled={currentSheet <= 1}
                      onClick={() => setSheet(currentSheet - 1)}
                    />
                    <span className="text-sm" aria-live="polite">
                      {t('labels.sheetOf', { sheet: currentSheet, sheets })}
                    </span>
                    <IconButton
                      icon={ChevronRight}
                      size="icon-sm"
                      label={t('labels.nextSheet')}
                      disabled={currentSheet >= sheets}
                      onClick={() => setSheet(currentSheet + 1)}
                    />
                  </span>
                ) : null}
              </div>
              {template && !single ? (
                <>
                  <p className="text-sm text-muted">{t('labels.startHint')}</p>
                  <SheetGrid
                    template={template}
                    start={start}
                    onStartChange={(slot) => set({ start: slot })}
                    count={count}
                    sheet={currentSheet}
                    sheets={Math.max(sheets, 1)}
                  />
                  <p className="text-sm" data-testid="labels-start">
                    {t('labels.start')} <strong>{start}</strong>
                  </p>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                    {(['used', 'label', 'empty'] as const).map((state) => (
                      <li key={state} className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={cn('size-3.5 shrink-0 rounded-sm border', CELL_STYLE[state])}
                        />
                        {t(`labels.legend.${state}`)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : template ? (
                <p className="text-base text-muted">{t('labels.singleLabelPage')}</p>
              ) : (
                <Skeleton className="h-64 w-full max-w-[22rem]" />
              )}
              <p className="text-sm text-muted">{t('labels.rememberedHint')}</p>
            </div>
          </div>

          {busy ? (
            <div role="status" className="flex flex-col gap-2" data-testid="labels-working">
              <p className="text-base">{t('labels.generating', { labels: labelsText })}</p>
              <Progress />
            </div>
          ) : null}

          <DialogFooter>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!canGenerate && !busy}>
              <Printer aria-hidden className="size-4" />
              {phase.kind === 'failed' ? t('labels.retry') : t('labels.generate')}
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}

/** A batch that was requested earlier (the notification opens it): only its progress is shown. */
function BatchOnly({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('labels.title')}</DialogTitle>
        <DialogDescription>{t('labels.batchDescription')}</DialogDescription>
      </DialogHeader>
      <BatchProgress batchId={id} onClose={onClose} />
    </>
  );
}

function Progress() {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
      <div className="h-full w-1/3 animate-[at-pulse_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
    </div>
  );
}

/**
 * Follows a label batch until it has an outcome: queued (a progress bar; the dialog may be closed,
 * a notification arrives), ready (download), failed (the reason and a way back) or expired.
 */
function BatchProgress({
  initial,
  batchId,
  onAgain,
  onClose,
}: {
  initial?: LabelBatch;
  batchId?: string;
  onAgain?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const id = initial?.id ?? batchId!;
  const query = useQuery({
    queryKey: ['label-batch', id],
    queryFn: () => labelsApi.batch(id),
    initialData: initial,
    // the batch handed over by the create call is only the start: read it again at once
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: (state) => {
      const batch = state.state.data;
      if (!batch || !isBatchFinished(batch)) return POLL_MS;
      return batch.status === 'ready' ? REFRESH_READY_MS : false;
    },
    retry: false,
  });
  const batch = query.data;
  const status = batch?.status;

  // Every printed asset gets a "label printed" history entry, and the bell may have a new entry.
  useEffect(() => {
    if (status === 'ready') {
      void client.invalidateQueries({ queryKey: ['asset-history'] });
      void client.invalidateQueries({ queryKey: ['notifications'] });
    }
    if (status === 'failed') void client.invalidateQueries({ queryKey: ['notifications'] });
  }, [status, client]);

  if (!batch) {
    return query.error ? (
      <>
        <Banner tone="danger">{t('labels.batchLoadFailed')}</Banner>
        <DialogFooter>
          <Button onClick={onClose}>{t('labels.close')}</Button>
          <Button variant="primary" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        </DialogFooter>
      </>
    ) : (
      <div role="status" className="flex flex-col gap-2">
        <Skeleton className="h-6 w-64" />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }

  const labels = t('labels.labelCount', { count: batch.label_count });
  const sheets = t('labels.sheetCount', { count: batch.page_count ?? 0 });

  if (batch.status === 'ready') {
    const url = batch.download_url;
    return (
      <div role="status" className="flex flex-col gap-4" data-testid="labels-ready">
        <Banner tone="success" title={t('labels.readyTitle')}>
          {t('labels.readyDescription', { labels, sheets })}
        </Banner>
        {batch.filename ? (
          <p className="flex items-center gap-2 text-base">
            <FileText aria-hidden className="size-5 text-muted" />
            <span className="font-tag">{batch.filename}</span>
          </p>
        ) : null}
        <p className="text-sm text-muted">{t('labels.printedHint')}</p>
        <DialogFooter>
          {onAgain ? <Button onClick={onAgain}>{t('labels.another')}</Button> : null}
          <Button onClick={onClose}>{t('labels.close')}</Button>
          {url ? (
            <>
              <Button asChild>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden className="size-4" />
                  {t('labels.open')}
                </a>
              </Button>
              <Button asChild variant="primary">
                <a href={url} download={batch.filename ?? undefined}>
                  <Download aria-hidden className="size-4" />
                  {t('labels.download')}
                </a>
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </div>
    );
  }

  if (batch.status === 'failed') {
    const code = batch.error?.code;
    const known =
      code && code in FAILURE_KEYS ? FAILURE_KEYS[code as keyof typeof FAILURE_KEYS] : null;
    return (
      <div className="flex flex-col gap-4" data-testid="labels-failed">
        <Banner tone="danger" title={t('labels.failedTitle')}>
          {known ? t(known) : (batch.error?.detail ?? t('labels.failed'))}
        </Banner>
        <DialogFooter>
          <Button onClick={onClose}>{t('labels.close')}</Button>
          {onAgain ? (
            <Button variant="primary" onClick={onAgain}>
              {t('labels.retry')}
            </Button>
          ) : null}
        </DialogFooter>
      </div>
    );
  }

  if (batch.status === 'expired') {
    return (
      <div className="flex flex-col gap-4" data-testid="labels-expired">
        <Banner tone="warning" title={t('labels.expiredTitle')}>
          {t('labels.expiredDescription')}
        </Banner>
        <DialogFooter>
          <Button onClick={onClose}>{t('labels.close')}</Button>
          {onAgain ? (
            <Button variant="primary" onClick={onAgain}>
              {t('labels.another')}
            </Button>
          ) : null}
        </DialogFooter>
      </div>
    );
  }

  return (
    <div role="status" className="flex flex-col gap-3" data-testid="labels-queued">
      <p className="text-base font-medium">{t('labels.queuedTitle')}</p>
      <p className="text-base">{t('labels.working', { labels })}</p>
      <Progress />
      <p className="text-sm text-muted">{t('labels.queuedHint')}</p>
      <DialogFooter>
        <Button onClick={onClose}>{t('labels.close')}</Button>
      </DialogFooter>
    </div>
  );
}

const FAILURE_KEYS = {
  'logo-invalid': 'labels.failedCodes.logo-invalid',
  'render-failed': 'labels.failedCodes.render-failed',
} as const;

function templateHint(t: ReturnType<typeof useI18n>['t'], template: LabelTemplate | undefined) {
  if (!template) return undefined;
  const width = template.label_width_mm ?? 0;
  const height = template.label_height_mm ?? 0;
  return isSingleLabel(template)
    ? t('labels.templateOne', { width, height })
    : t('labels.templateHint', { cols: template.cols, rows: template.rows, width, height });
}
