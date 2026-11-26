'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Download, Printer } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { RowProblems } from '@/components/imports/step-review';
import { useHasLabels, useLabels } from '@/components/labels/labels-provider';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { useI18n } from '@/i18n';
import {
  downloadErrorReport,
  importKeys,
  importsApi,
  type ImportJob,
  type ImportRow,
} from '@/lib/imports/api';
import { importErrorText, type ImportErrorText } from '@/lib/imports/error-text';
import {
  analysisFailed,
  CHROMEBOOK_CATEGORY,
  isPurged,
  listRouteFor,
  progressPercent,
  rowKey,
  rowsToWrite,
  setupOf,
} from '@/lib/imports/helpers';
import { routes } from '@/lib/routes';

/**
 * Step "Import": the commit running, with a progress bar fed by polling and a way to stop it (the
 * current batch finishes, rows already written stay). The page can be left; the import list brings
 * the person back.
 */
export function StepCommit({ job, canRun }: { job: ImportJob; canRun: boolean }) {
  const { t, formatNumber } = useI18n();
  const client = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<ImportErrorText | null>(null);
  const toWrite = rowsToWrite(job);
  const done = Math.min(job.progress.processed, toWrite || job.progress.processed);
  // the API counts the rows the dry run decided not to write in `total` but not in `processed`
  const percent =
    toWrite > 0 ? Math.min(100, Math.round((done / toWrite) * 100)) : progressPercent(job);
  const stopping = cancelling || job.cancel_requested;

  const cancel = async () => {
    setCancelling(true);
    setError(null);
    try {
      await importsApi.cancel(job.id);
      await client.invalidateQueries({ queryKey: importKeys.job(job.id) });
    } catch (err) {
      setCancelling(false);
      setError(importErrorText(t, err, t('importRun.cancelFailed')));
    }
  };

  return (
    <section aria-labelledby="import-run-heading" className="flex max-w-2xl flex-col gap-4">
      <h2 id="import-run-heading" className="text-lg font-semibold text-text">
        {t('importRun.heading')}
      </h2>
      <div className="flex flex-col gap-2">
        <p role="status" className="text-base text-text" data-testid="import-progress-text">
          {done === 0 && percent === 0
            ? t('importRun.waiting')
            : t('importRun.progress', {
                done: formatNumber(done),
                total: formatNumber(toWrite || job.progress.total),
              })}
        </p>
        <progress
          className="h-3 w-full"
          value={percent}
          max={100}
          aria-label={t('importRun.progressLabel')}
          data-testid="import-progress"
        />
      </div>
      {stopping ? <Banner tone="info">{t('importRun.cancelling')}</Banner> : null}
      {error ? (
        <FormError message={error.message} requestId={error.requestId} details={error.details} />
      ) : null}
      {canRun ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={stopping} onClick={() => void cancel()}>
            {t('importRun.cancel')}
          </Button>
          <p className="text-sm text-muted">{t('importRun.cancelNote')}</p>
        </div>
      ) : null}
      <p className="text-sm text-muted">{t('importRun.leaveNote')}</p>
    </section>
  );
}

const PAGE = 25;

/** The rows the commit could not write (phase `commit`, outcome `error`), paged from the server. */
function FailedRows({ job }: { job: ImportJob }) {
  const { t, formatNumber } = useI18n();
  const rows = useInfiniteQuery({
    queryKey: [...importKeys.rows(job.id), 'commit-errors'],
    queryFn: ({ pageParam }) =>
      importsApi.rows(job.id, {
        phase: 'commit',
        outcome: ['error'],
        limit: PAGE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.next_cursor ?? undefined,
  });
  const data = rows.data?.pages.flatMap((page) => page.data) ?? [];
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
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-text">{t('importDone.rowsHeading')}</h3>
      {rows.isError ? (
        <Banner
          tone="danger"
          action={<Button onClick={() => void rows.refetch()}>{t('common.retry')}</Button>}
        >
          {t('importReview.rowsFailed')}
        </Banner>
      ) : null}
      <DataTable
        label={t('importDone.rowsTable')}
        columns={columns}
        rows={data}
        getRowId={(row) => String(row.row_no)}
        getRowLabel={(row) => String(row.row_no)}
        loading={rows.isPending}
        empty={<p className="px-4 py-6 text-base text-muted">{t('importReview.noRows')}</p>}
      />
      {rows.hasNextPage ? (
        <div>
          <Button loading={rows.isFetchingNextPage} onClick={() => void rows.fetchNextPage()}>
            {t('importDone.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The finished screen: counts, where to look at the result, the error report, or why it failed or stopped. */
export function StepDone({ job, canRun }: { job: ImportJob; canRun: boolean }) {
  const { t, formatNumber, formatDateTime } = useI18n();
  const [reportFailed, setReportFailed] = useState(false);
  const purged = isPurged(job);
  const commit = job.counts.commit;
  const written = commit.created + commit.updated;
  const setup = setupOf(job);

  const purgedNote = purged ? (
    <Banner tone="info" title={t('importDone.purgedTitle')}>
      {t('importDone.purged', { date: formatDateTime(job.data_purged_at!) })}
    </Banner>
  ) : null;

  if (job.state === 'failed') {
    return (
      <section aria-labelledby="import-done-heading" className="flex max-w-2xl flex-col gap-4">
        <h2 id="import-done-heading" className="text-lg font-semibold text-text">
          {t('importDone.failedTitle')}
        </h2>
        <Banner tone="danger">{job.error ?? t('importDone.failedUnknown')}</Banner>
        {analysisFailed(job) ? (
          <p className="text-sm text-muted">{t('importDone.failedBeforeRows')}</p>
        ) : null}
        {purgedNote}
        <Actions job={job} canRun={canRun} />
      </section>
    );
  }

  const cancelled = job.state === 'cancelled';
  return (
    <section aria-labelledby="import-done-heading" className="flex max-w-2xl flex-col gap-4">
      <h2 id="import-done-heading" className="text-lg font-semibold text-text">
        {cancelled ? t('importDone.cancelledTitle') : t('importDone.finished')}
      </h2>
      {cancelled ? (
        <Banner tone="warning">
          {written > 0
            ? t('importDone.cancelledDescription', { count: written })
            : t('importDone.cancelledNothing')}
        </Banner>
      ) : (
        <Banner tone="success">{t('importDone.finishedDescription')}</Banner>
      )}
      {purgedNote}
      {setup && (setup.categoryCreated || setup.customFieldsCreated.length > 0) ? (
        <p className="text-sm text-muted">
          {t('importReview.setupCreated', {
            category: CHROMEBOOK_CATEGORY,
            fields: setup.customFieldsCreated.join(', '),
          })}
        </p>
      ) : null}
      {cancelled && written === 0 && commit.skipped === 0 && commit.error === 0 ? null : (
        <ul
          aria-label={t('importDone.summaryLabel')}
          className="grid grid-cols-2 gap-3 md:grid-cols-4"
          data-testid="import-summary"
        >
          {(
            [
              ['created', commit.created, CircleCheck],
              ['updated', commit.updated, CircleCheck],
              ['skipped', commit.skipped, CircleCheck],
              ['failed', commit.error, CircleAlert],
            ] as const
          ).map(([key, value, Icon]) => (
            <li
              key={key}
              data-testid={`import-done-${key}`}
              className="flex flex-col rounded-lg border border-border bg-surface px-4 py-3"
            >
              <span className="text-3xl leading-tight font-semibold text-text tabular-nums">
                {formatNumber(value)}
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                <Icon aria-hidden className="size-3.5" />
                {t(`importDone.counts.${key}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {commit.error > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-base text-text">
            {t('importDone.errorsNote', { count: commit.error })}
          </p>
          {canRun && !purged ? (
            <>
              <div>
                <Button
                  onClick={() =>
                    void downloadErrorReport(job.id).catch(() => setReportFailed(true))
                  }
                >
                  <Download aria-hidden className="size-4" />
                  {t('importReview.errorReport')}
                </Button>
              </div>
              {reportFailed ? (
                <p role="alert" className="text-sm text-danger-text">
                  {t('importReview.errorReportFailed')}
                </p>
              ) : null}
              <FailedRows job={job} />
            </>
          ) : null}
        </div>
      ) : null}
      <Actions job={job} canRun={canRun} />
      {!cancelled ? (
        <p className="text-sm text-muted">
          {t('importDone.notice')} {t('importDone.undo')}
        </p>
      ) : null}
    </section>
  );
}

/**
 * "Print labels for the new assets" (walk-through BUG-2, ED-38): the print-labels dialog for exactly the
 * assets this import created (the asset filter `import_job_id`), not the whole asset list.
 */
function PrintNewAssets({ job }: { job: ImportJob }) {
  const { t } = useI18n();
  const hasLabels = useHasLabels();
  if (!hasLabels) return null;
  return <PrintNewAssetsButton job={job} label={t('importDone.printLabels')} />;
}

function PrintNewAssetsButton({ job, label }: { job: ImportJob; label: string }) {
  const labels = useLabels();
  return (
    <Button
      onClick={() =>
        labels.open({
          kind: 'filter',
          query: { import_job_id: job.id },
          total: job.counts.commit.created,
        })
      }
    >
      <Printer aria-hidden className="size-4" />
      {label}
    </Button>
  );
}

function Actions({ job, canRun }: { job: ImportJob; canRun: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const client = useQueryClient();
  const [error, setError] = useState<ImportErrorText | null>(null);
  const [busy, setBusy] = useState(false);
  // a failed import that was not committed can take another file, or read the same one again
  const retryable = job.state === 'failed' && !job.committed_at && canRun;
  const readAgain = async () => {
    setBusy(true);
    setError(null);
    try {
      await importsApi.analyze(job.id);
      await client.invalidateQueries({ queryKey: importKeys.job(job.id) });
      router.replace(routes.importJob(job.id));
    } catch (err) {
      setError(importErrorText(t, err, t('importDone.readAgainFailed')));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <FormError message={error.message} requestId={error.requestId} details={error.details} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {job.state === 'completed' ? (
          <Button asChild variant="primary">
            <Link href={listRouteFor(job.entity_type)}>
              {t(`importDone.viewList.${job.entity_type}`)}
            </Link>
          </Button>
        ) : null}
        {job.state === 'completed' &&
        job.entity_type === 'asset' &&
        job.counts.commit.created > 0 ? (
          <PrintNewAssets job={job} />
        ) : null}
        {retryable ? (
          <Button asChild variant="primary">
            <Link href={routes.importJob(job.id, 'file')}>{t('importMapping.uploadOther')}</Link>
          </Button>
        ) : null}
        {retryable && job.file_attachment_id && !isPurged(job) ? (
          <Button disabled={busy} onClick={() => void readAgain()}>
            {t('importDone.readAgain')}
          </Button>
        ) : null}
        <Button asChild>
          <Link
            href={routes.importNew(job.source === 'google_admin_csv' ? undefined : job.entity_type)}
          >
            {t('importDone.another')}
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href={routes.imports}>{t('importDone.all')}</Link>
        </Button>
      </div>
    </div>
  );
}
