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
import { uiErrorText } from '@/lib/error-text';
import {
  labelsApi,
  type LabelCodeType,
  type LabelField,
  type LabelRenderRequest,
  type LabelTemplate,
  type RenderedLabels,
} from '@/lib/labels/api';
import {
  LABEL_FIELDS,
  MAX_LABELS,
  codeTypeFrom,
  isSingleLabel,
  knownFields,
  readLabelChoice,
  sheetCount,
  showsBarcode,
  showsQr,
  slotsPerSheet,
  writeLabelChoice,
} from '@/lib/labels/helpers';
import { assetsApi, type AssetListQuery } from '@/lib/registry/api';
import { useLookups } from '@/lib/registry/queries';
import type { Asset } from '@/lib/registry/types';
import { LabelPreview, type LabelSample } from './label-preview';
import { SheetGrid } from './sheet-grid';

/** What to print: assets already chosen (a selection, one asset), or everything a list filter shows. */
export type LabelsRequest =
  | { kind: 'assets'; assets: Asset[] }
  | { kind: 'filter'; query: AssetListQuery; total?: number | null };

type Phase =
  | { kind: 'edit' }
  | { kind: 'working' }
  | { kind: 'ready'; url: string; rendered: RenderedLabels; labels: number; sheets: number }
  | { kind: 'failed'; error: unknown };

interface Override {
  template_key?: string;
  qr?: boolean;
  barcode?: boolean;
  fields?: LabelField[];
  start?: number;
}

const samePage = 200;

/** Assets a filter shows, up to one more than a PDF holds (so "too many" can be told apart). */
async function collectAssets(query: AssetListQuery): Promise<Asset[]> {
  const found: Asset[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 4; guard += 1) {
    const page = await assetsApi.list({
      ...query,
      cursor,
      limit: samePage,
      include_total: false,
      expand: undefined,
    });
    found.push(...page.data);
    if (!page.page.has_more || !page.page.next_cursor || found.length > MAX_LABELS) break;
    cursor = page.page.next_cursor;
  }
  return found;
}

export interface LabelDialogProps {
  request: LabelsRequest | null;
  onClose: () => void;
}

/**
 * Print labels (WEB-15, M2-TAG-03): pick a sheet template, the first free position on a partly used
 * sheet (a visual grid), the codes and the text lines, check one label at its real size, then
 * generate the PDF and download it. The last template is remembered in this browser.
 */
export function LabelDialog({ request, onClose }: LabelDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" className="max-w-[960px]">
        {request ? (
          <LabelBody request={request} onClose={onClose} />
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

function LabelBody({ request, onClose }: { request: LabelsRequest; onClose: () => void }) {
  const { t } = useI18n();
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const lookups = useLookups();
  const remembered = useMemo(() => readLabelChoice(), []);
  const [override, setOverride] = useState<Override>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' });
  const [sheet, setSheet] = useState(1);
  const [codeError, setCodeError] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const templates = useQuery({
    queryKey: ['label-templates'],
    queryFn: () => labelsApi.templates(),
    staleTime: 5 * 60_000,
  });
  const collected = useQuery({
    queryKey: ['label-assets', request.kind === 'filter' ? request.query : null],
    queryFn: () => collectAssets((request as { query: AssetListQuery }).query),
    enabled: request.kind === 'filter' && (request.total ?? 0) <= MAX_LABELS,
    staleTime: 0,
    gcTime: 0,
  });

  const assets: Asset[] = request.kind === 'assets' ? request.assets : (collected.data ?? []);
  const knownTotal =
    request.kind === 'assets' ? request.assets.length : (request.total ?? collected.data?.length);
  const tooMany = (knownTotal ?? 0) > MAX_LABELS;
  const collecting = request.kind === 'filter' && !tooMany && collected.isLoading;
  const count = tooMany ? (knownTotal ?? 0) : assets.length;

  const list = templates.data ?? [];
  const rememberedTemplate = list.find((tpl) => tpl.key === remembered?.template_key);
  const template: LabelTemplate | undefined =
    list.find((tpl) => tpl.key === override.template_key) ?? rememberedTemplate ?? list[0];
  const fromRemembered = !!template && remembered?.template_key === template.key;

  // What the template prints unless the user changed it (or the remembered choice for this template).
  const baseType: LabelCodeType = (fromRemembered && remembered?.code_type) || template?.code_type || 'qr';
  const qr = override.qr ?? showsQr(baseType);
  const barcode = override.barcode ?? showsBarcode(baseType);
  const codeType = codeTypeFrom(qr, barcode);
  const fields: LabelField[] =
    override.fields ??
    ((fromRemembered && remembered?.fields) || knownFields(template?.fields));
  const perSheet = template ? slotsPerSheet(template) : 1;
  const single = template ? isSingleLabel(template) : false;
  const start = single ? 1 : Math.min(override.start ?? 1, perSheet);
  const sheets = template ? sheetCount(count, start, template) : 0;
  const currentSheet = Math.min(sheet, Math.max(sheets, 1));

  const first = assets[0];
  const sample: LabelSample | null = first
    ? {
        tag: first.asset_tag,
        name: first.name ?? lookups.modelById.get(first.model_id ?? '')?.name ?? null,
        location: lookups.locationLabel(first.location_id).split(' > ').pop() ?? '',
        serial: first.serial ?? null,
        organisation: me?.tenant.name ?? '',
        code: first.label_code ?? first.asset_tag,
      }
    : null;

  // Release the PDF's object URL when it is replaced or the dialog closes.
  const url = phase.kind === 'ready' ? phase.url : null;
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  useEffect(() => () => abort.current?.abort(), []);

  const set = (patch: Override) => {
    setOverride((current) => ({ ...current, ...patch }));
    setCodeError(false);
  };

  const generate = async () => {
    if (!template || !codeType) {
      setCodeError(true);
      return;
    }
    if (assets.length === 0 || assets.length > MAX_LABELS) return;
    const body: LabelRenderRequest = {
      template_key: template.key,
      asset_ids: assets.map((asset) => asset.id),
      ...(!single && start > 1 ? { start_position: start } : {}),
      // Only what differs from the template is sent, so a plain request stays a plain request.
      ...(codeType !== template.code_type ? { code_type: codeType } : {}),
      ...(sameFields(fields, knownFields(template.fields)) ? {} : { fields }),
    };
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: 'working' });
    try {
      const rendered = await labelsApi.render(body, controller.signal);
      writeLabelChoice({ template_key: template.key, code_type: codeType, fields });
      setSheet(1);
      setPhase({
        kind: 'ready',
        url: URL.createObjectURL(rendered.blob),
        rendered,
        labels: assets.length,
        sheets,
      });
      void queryClient.invalidateQueries({ queryKey: ['asset-history'] });
    } catch (err) {
      if (controller.signal.aborted) setPhase({ kind: 'edit' });
      else setPhase({ kind: 'failed', error: err });
    }
  };

  const labelsText = t('labels.labelCount', { count });
  const sheetsText = t('labels.sheetCount', { count: sheets });
  const sourceText =
    request.kind === 'assets'
      ? t('labels.sourceSelection', { count })
      : t('labels.sourceFilter', { count });
  const busy = phase.kind === 'working';
  const canGenerate =
    !!template && !!codeType && count > 0 && !tooMany && !collecting && !busy && !!sample;

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

      {phase.kind === 'ready' ? (
        <div role="status" className="flex flex-col gap-4" data-testid="labels-ready">
          <Banner tone="success" title={t('labels.readyTitle')}>
            {t('labels.readyDescription', {
              labels: t('labels.labelCount', { count: phase.labels }),
              sheets: t('labels.sheetCount', { count: phase.sheets }),
            })}
          </Banner>
          <p className="flex items-center gap-2 text-base">
            <FileText aria-hidden className="size-5 text-muted" />
            <span className="font-tag">{phase.rendered.filename}</span>
          </p>
          <p className="text-sm text-muted">{t('labels.printedHint')}</p>
          <DialogFooter>
            <Button onClick={() => setPhase({ kind: 'edit' })}>{t('labels.another')}</Button>
            <Button asChild>
              <a href={phase.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden className="size-4" />
                {t('labels.open')}
              </a>
            </Button>
            <Button asChild variant="primary">
              <a href={phase.url} download={phase.rendered.filename}>
                <Download aria-hidden className="size-4" />
                {t('labels.download')}
              </a>
            </Button>
          </DialogFooter>
        </div>
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
          {request.kind === 'filter' && collected.error ? (
            <Banner tone="danger">{t('labels.collectFailed')}</Banner>
          ) : null}
          {templates.error ? <Banner tone="danger">{t('labels.templatesFailed')}</Banner> : null}
          {request.kind === 'filter' && collected.isSuccess && assets.length === 0 ? (
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
                      setCodeError(false);
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
                {codeError || (!qr && !barcode) ? (
                  <p role="alert" className="text-sm text-danger-text">
                    {t('labels.codesRequired')}
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
                      codeType={codeType ?? 'qr'}
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
                      <li key={state}>{t(`labels.legend.${state}`)}</li>
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
              <p className="text-base">{t('labels.generating', { labels: labelsText, sheets: sheetsText })}</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                <div className="h-full w-1/3 animate-[at-pulse_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              onClick={() => {
                abort.current?.abort();
                onClose();
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!canGenerate && !busy}
            >
              <Printer aria-hidden className="size-4" />
              {phase.kind === 'failed' ? t('labels.retry') : t('labels.generate')}
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}

function sameFields(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((field) => b.includes(field));
}

function templateHint(t: ReturnType<typeof useI18n>['t'], template: LabelTemplate | undefined) {
  if (!template) return undefined;
  const width = template.label_width_mm ?? 0;
  const height = template.label_height_mm ?? 0;
  return isSingleLabel(template)
    ? t('labels.templateOne', { width, height })
    : t('labels.templateHint', { cols: template.cols, rows: template.rows, width, height });
}
