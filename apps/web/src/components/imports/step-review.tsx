'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  Download,
  Pencil,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { createKeyKeeper } from '@/lib/custody/helpers';
import {
  downloadErrorReport,
  importKeys,
  importsApi,
  type ImportJob,
  type ImportRow,
} from '@/lib/imports/api';
import { importErrorText, type ImportErrorText } from '@/lib/imports/error-text';
import {
  CHROMEBOOK_CATEGORY,
  deferredRowsOf,
  errorGroupsOf,
  isKnownCode,
  nothingChanged,
  progressPercent,
  rowKey,
  rowQueryFor,
  rowsToWrite,
  rowWarnings,
  setupOf,
  willCreateOf,
  type RowFilter,
} from '@/lib/imports/helpers';
import { routes } from '@/lib/routes';

const PAGE_SIZE = 50;
const FILTERS: readonly RowFilter[] = ['all', 'error', 'warnings', 'skip', 'create', 'update'];

type Plan = NonNullable<ImportRow['plan']>;
const OUTCOME: Record<Plan, { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon }> = {
  create: { tone: 'success', icon: CircleCheck },
  update: { tone: 'info', icon: Pencil },
  skip: { tone: 'neutral', icon: CircleMinus },
  error: { tone: 'danger', icon: CircleAlert },
};

/** The row's problems and notes, errors first; each with the field it is about when it has one. */
export function RowProblems({ row }: { row: ImportRow }) {
  const { t } = useI18n();
  const warnings = rowWarnings(row.warnings);
  if (row.errors.length === 0 && warnings.length === 0) {
    return <span className="text-muted">{t('importReview.noProblem')}</span>;
  }
  return (
    <span className="flex flex-col whitespace-normal">
      {row.errors.map((e) => (
        <span key={`e-${e.code}-${e.field}-${e.message}`} className="text-danger-text">
          {e.message}
        </span>
      ))}
      {warnings.map((w) => (
        <span key={`w-${w.code}-${w.field}-${w.message}`} className="text-muted">
          {w.message}
        </span>
      ))}
    </span>
  );
}

/**
 * Step "Dry run" (WEB-14 step 3, W22): the worker is checking the file (a progress bar fed by polling),
 * then the result. A banner says nothing is saved yet; four counts; why rows were rejected and what the
 * import would create on the way (the job's summary); the rows filtered by result and paged from the
 * server (a file can have 100,000); the error report as a CSV; and the way on: import, or fix the file
 * and go again. Importing needs the digest of the dry run the person reviewed. Without `import:run`
 * the counts are shown, the rows and the import are not.
 */
export function StepReview({ job, canRun }: { job: ImportJob; canRun: boolean }) {
  const { t, formatNumber } = useI18n();
  const client = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<RowFilter>('all');
  const [cursors, setCursors] = useState<string[]>([]);
  const [committing, setCommitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ImportErrorText | null>(null);
  const [reportFailed, setReportFailed] = useState(false);
  const keys = useRef(createKeyKeeper());

  const done = job.state === 'dry_run_done';
  const counts = job.counts.dry_run;
  const cursor = cursors[cursors.length - 1];
  const rows = useQuery({
    queryKey: [...importKeys.rows(job.id), filter, cursor ?? '', job.dry_run_digest ?? ''],
    queryFn: () =>
      importsApi.rows(job.id, {
        phase: 'dry_run',
        limit: PAGE_SIZE,
        ...rowQueryFor(filter, 'dry_run'),
        ...(cursor ? { cursor } : {}),
      }),
    enabled: done && canRun,
    placeholderData: keepPreviousData,
  });

  const total = filter === 'all' ? job.rows_total : filter === 'warnings' ? null : counts[filter];
  const pageStart = cursors.length * PAGE_SIZE;
  const shown = rows.data?.data.length ?? 0;
  const toWrite = rowsToWrite(job);
  const unchanged = toWrite === 0 && nothingChanged(job);
  const errorGroups = errorGroupsOf(job);
  const willCreate = willCreateOf(job);
  const deferred = deferredRowsOf(job);
  const setup = setupOf(job);
  const reasonOf = (code: string) => (isKnownCode(code) ? t(`importCodes.${code}`) : code);
  const setupText = setup
    ? setup.customFieldsCreated.length > 0
      ? t('importReview.setupCreated', {
          category: CHROMEBOOK_CATEGORY,
          fields: setup.customFieldsCreated.join(', '),
        })
      : setup.categoryCreated
        ? t('importReview.setupCategoryOnly', { category: CHROMEBOOK_CATEGORY })
        : null
    : null;

  const columns: DataTableColumn<ImportRow>[] = [
    {
      id: 'row',
      header: t('importReview.columns.row'),
      align: 'end',
      sticky: true,
      cell: (row) => (
        <span title={t('importReview.line', { line: row.line_no })}>
          {formatNumber(row.row_no)}
        </span>
      ),
    },
    {
      id: 'outcome',
      header: t('importReview.columns.outcome'),
      cell: (row) => {
        const plan = row.plan ?? 'skip';
        const style = OUTCOME[plan];
        return (
          <Badge tone={style.tone} icon={style.icon}>
            {t(`importReview.outcomes.${plan}`)}
          </Badge>
        );
      },
    },
    {
      id: 'key',
      header: t('importReview.columns.key'),
      mono: true,
      cell: (row) => rowKey(row) || '-',
    },
    {
      id: 'problem',
      header: t('importReview.columns.problem'),
      cell: (row) => <RowProblems row={row} />,
    },
  ];

  const commit = async () => {
    if (!job.dry_run_digest) return;
    setCommitting(true);
    setError(null);
    try {
      await importsApi.commit(job.id, job.dry_run_digest, keys.current.keyFor(job.dry_run_digest));
      await client.invalidateQueries({ queryKey: importKeys.job(job.id) });
    } catch (err) {
      const text = importErrorText(t, err, t('importReview.commitFailed'));
      setError(text);
      // the import may have moved on (another state): the screen follows it, so the reason also goes to a toast
      if (text.code === 'import-wrong-state') {
        toast({ variant: 'danger', title: text.message, requestId: text.requestId });
      }
      // show what is true now
      void client.invalidateQueries({ queryKey: importKeys.job(job.id) });
    } finally {
      setCommitting(false);
    }
  };

  const runAgain = async () => {
    setBusy(true);
    setError(null);
    try {
      await importsApi.startDryRun(job.id);
      await client.invalidateQueries({ queryKey: importKeys.job(job.id) });
    } catch (err) {
      setError(importErrorText(t, err, t('importReview.rerunFailed')));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await importsApi.cancel(job.id);
      await client.invalidateQueries({ queryKey: importKeys.job(job.id) });
    } catch (err) {
      setError(importErrorText(t, err, t('importReview.cancelFailed')));
    } finally {
      setBusy(false);
    }
  };

  // ---- the worker is still checking ----------------------------------------------------------------

  if (!done) {
    return (
      <section aria-labelledby="import-review-heading" aria-busy className="flex flex-col gap-4">
        <h2 id="import-review-heading" className="text-lg font-semibold text-text">
          {t('importReview.heading')}
        </h2>
        <Banner tone="info">{t('importReview.banner')}</Banner>
        <p role="status" className="text-base text-text" data-testid="import-check-text">
          {job.progress.processed > 0
            ? t('importReview.progress', {
                done: formatNumber(job.progress.processed),
                total: formatNumber(job.progress.total),
              })
            : t('importReview.checking')}
        </p>
        <progress
          className="h-2 w-full max-w-xl"
          value={progressPercent(job)}
          max={100}
          aria-label={t('importReview.checking')}
        />
        {error ? (
          <FormError message={error.message} requestId={error.requestId} details={error.details} />
        ) : null}
        {canRun ? (
          <div>
            <Button disabled={busy || job.cancel_requested} onClick={() => void cancel()}>
              {t('importReview.cancel')}
            </Button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="import-review-heading" className="flex flex-col gap-5">
      <div>
        <h2 id="import-review-heading" className="text-lg font-semibold text-text">
          {t('importReview.heading')}
        </h2>
        <p className="text-sm text-muted">
          {t('importMapping.file', {
            name: job.filename ?? '',
            count: formatNumber(job.rows_total),
          })}
        </p>
      </div>
      <Banner tone="info">{t('importReview.banner')}</Banner>
      {setupText ? <Banner tone="info">{setupText}</Banner> : null}
      <div className="flex flex-col gap-1 text-sm text-muted" data-testid="import-checks-note">
        <p>{t('importReview.checksNote')}</p>
        {deferred > 0 ? (
          <p className="text-text">{t('importReview.deferred', { count: deferred })}</p>
        ) : null}
      </div>

      <ul
        aria-label={t('importReview.tilesLabel')}
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        data-testid="import-tiles"
      >
        {(['create', 'update', 'skip', 'error'] as const).map((outcome) => {
          const style = OUTCOME[outcome];
          const Icon = style.icon;
          return (
            <li
              key={outcome}
              data-testid={`import-tile-${outcome}`}
              className="flex flex-col rounded-lg border border-border bg-surface px-4 py-3"
            >
              <span className="text-3xl leading-tight font-semibold text-text tabular-nums">
                {formatNumber(counts[outcome])}
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                <Icon aria-hidden className="size-3.5" />
                {t(`importReview.tiles.${outcome}`)}
              </span>
            </li>
          );
        })}
      </ul>

      {errorGroups.length > 0 ? (
        <section aria-labelledby="import-errors-heading" className="flex flex-col gap-1">
          <h3 id="import-errors-heading" className="text-base font-semibold text-text">
            {t('importReview.errorsHeading')}
          </h3>
          <ul
            aria-label={t('importReview.errorsList')}
            className="list-disc pl-5 text-base text-text"
          >
            {errorGroups.map((group) => (
              <li key={`${group.code}-${group.field}`}>
                {t('importReview.errorLine', { count: group.count, reason: reasonOf(group.code) })}
                {group.field ? t('importReview.errorLineField', { field: group.field }) : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {willCreate.length > 0 ? (
        <section aria-labelledby="import-create-heading" className="flex flex-col gap-1">
          <h3 id="import-create-heading" className="text-base font-semibold text-text">
            {t('importReview.willCreateHeading')}
          </h3>
          <ul
            aria-label={t('importReview.willCreateList')}
            className="list-disc pl-5 text-base text-text"
          >
            {willCreate.map((entry) => (
              <li key={`${entry.field}-${entry.message}`}>
                {t('importReview.willCreateLine', { count: entry.count, message: entry.message })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canRun ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={t('importReview.show')}
              className="flex flex-wrap gap-1.5"
            >
              {FILTERS.map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={filter === option ? 'primary' : 'secondary'}
                  aria-pressed={filter === option}
                  onClick={() => {
                    setFilter(option);
                    setCursors([]);
                  }}
                >
                  {t(`importReview.filters.${option}`)}
                </Button>
              ))}
            </div>
            {counts.error > 0 ? (
              <Button
                className="ml-auto"
                onClick={() => void downloadErrorReport(job.id).catch(() => setReportFailed(true))}
              >
                <Download aria-hidden className="size-4" />
                {t('importReview.errorReport')}
              </Button>
            ) : null}
          </div>
          {reportFailed ? (
            <p role="alert" className="text-sm text-danger-text">
              {t('importReview.errorReportFailed')}
            </p>
          ) : null}

          {rows.isError && !rows.data ? (
            <Banner
              tone="danger"
              action={<Button onClick={() => void rows.refetch()}>{t('common.retry')}</Button>}
            >
              {t('importReview.rowsFailed')}
            </Banner>
          ) : null}
          <DataTable
            label={t('importReview.tableLabel')}
            columns={columns}
            rows={rows.data?.data ?? []}
            getRowId={(row) => String(row.row_no)}
            getRowLabel={(row) => String(row.row_no)}
            loading={rows.isPending}
            className={rows.isPlaceholderData ? 'opacity-60' : undefined}
            empty={<p className="px-4 py-6 text-base text-muted">{t('importReview.noRows')}</p>}
          />
          {shown > 0 ? (
            <nav
              aria-label={t('importReview.pagination')}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <p className="text-sm text-muted" data-testid="import-range" aria-live="polite">
                {total === null
                  ? t('importReview.rangeNoTotal', {
                      from: formatNumber(pageStart + 1),
                      to: formatNumber(pageStart + shown),
                    })
                  : t('importReview.range', {
                      from: formatNumber(pageStart + 1),
                      to: formatNumber(pageStart + shown),
                      total: formatNumber(total),
                    })}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={cursors.length === 0}
                  onClick={() => setCursors((current) => current.slice(0, -1))}
                >
                  <ChevronLeft aria-hidden className="size-4" />
                  {t('importReview.previous')}
                </Button>
                <Button
                  size="sm"
                  disabled={!rows.data?.page.has_more}
                  onClick={() => {
                    const next = rows.data?.page.next_cursor;
                    if (next) setCursors((current) => [...current, next]);
                  }}
                >
                  {t('importReview.next')}
                  <ChevronRight aria-hidden className="size-4" />
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted">{t('importReview.readOnly')}</p>
      )}

      {counts.error > 0 && toWrite > 0 ? (
        <Banner tone="warning">
          {t('importReview.errorsWillBeSkipped', { count: counts.error })}
        </Banner>
      ) : null}
      {toWrite === 0 ? (
        // ED-40: a re-import where every row matches what is already there is not a problem
        unchanged ? (
          <Banner tone="info">{t('importReview.nothingChanged')}</Banner>
        ) : (
          <Banner tone="warning">{t('importReview.nothingToImport')}</Banner>
        )
      ) : null}
      {error ? (
        <FormError message={error.message} requestId={error.requestId} details={error.details} />
      ) : null}

      {canRun ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <Link href={routes.importJob(job.id, 'mapping')}>{t('importReview.back')}</Link>
          </Button>
          <Button asChild>
            <Link href={routes.importJob(job.id, 'file')}>{t('importReview.fix')}</Link>
          </Button>
          <Button disabled={busy} onClick={() => void runAgain()}>
            {t('importReview.runAgain')}
          </Button>
          <Button
            variant="primary"
            loading={committing}
            disabled={toWrite === 0}
            onClick={() => void commit()}
          >
            {toWrite === 0
              ? t('importReview.importNothing')
              : t('importReview.importButton', { count: toWrite })}
          </Button>
          <Button asChild variant="ghost">
            <Link href={routes.imports}>{t('imports.allImports')}</Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
