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
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { createKeyKeeper } from '@/lib/custody/helpers';
import { uiErrorText } from '@/lib/error-text';
import {
  downloadErrorReport,
  importsApi,
  type ImportJob,
  type ImportOutcome,
  type ImportRow,
} from '@/lib/imports/api';
import { rowKey, rowMessages, rowsToWrite } from '@/lib/imports/helpers';
import { routes } from '@/lib/routes';

const PAGE_SIZE = 50;
type Filter = 'all' | ImportOutcome;
const FILTERS: readonly Filter[] = ['all', 'error', 'skip', 'create', 'update'];

const OUTCOME: Record<ImportOutcome, { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon }> =
  {
    create: { tone: 'success', icon: CircleCheck },
    update: { tone: 'info', icon: Pencil },
    skip: { tone: 'neutral', icon: CircleMinus },
    error: { tone: 'danger', icon: CircleAlert },
  };

const countOf = (job: ImportJob, filter: Filter): number =>
  filter === 'all'
    ? (job.rows_total ?? 0)
    : filter === 'create'
      ? (job.rows_create ?? 0)
      : filter === 'update'
        ? (job.rows_update ?? 0)
        : filter === 'skip'
          ? (job.rows_skip ?? 0)
          : (job.rows_error ?? 0);

/**
 * Step "Dry run" (WEB-14 step 3, W22): the worker is checking the file, then the result. A banner
 * says nothing is saved yet; four counts; the rows filtered by result and paged from the server (a
 * file can have 100,000); the error report as a CSV; and the way on: import, or fix the file and go
 * again. Importing needs the digest of the dry run the person reviewed.
 */
export function StepReview({ job }: { job: ImportJob }) {
  const { t, formatNumber } = useI18n();
  const router = useRouter();
  const client = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [cursors, setCursors] = useState<string[]>([]);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [reportFailed, setReportFailed] = useState(false);
  const keys = useRef(createKeyKeeper());

  const complete = job.state === 'dry_run_complete';
  const cursor = cursors[cursors.length - 1];
  const rows = useQuery({
    queryKey: ['import', job.id, 'rows', filter, cursor ?? '', job.dry_run_digest ?? ''],
    queryFn: () =>
      importsApi.rows(job.id, {
        phase: 'dry_run',
        limit: PAGE_SIZE,
        ...(filter === 'all' ? {} : { outcome: [filter] }),
        ...(cursor ? { cursor } : {}),
      }),
    enabled: complete,
    placeholderData: keepPreviousData,
  });

  const total = countOf(job, filter);
  const pageStart = cursors.length * PAGE_SIZE;
  const shown = rows.data?.data.length ?? 0;
  const toWrite = rowsToWrite(job);

  const columns = useMemo<DataTableColumn<ImportRow>[]>(
    () => [
      {
        id: 'row',
        header: t('importReview.columns.row'),
        align: 'end',
        sticky: true,
        cell: (row) => formatNumber(row.row_no),
      },
      {
        id: 'outcome',
        header: t('importReview.columns.outcome'),
        cell: (row) => {
          const style = OUTCOME[row.outcome];
          return (
            <Badge tone={style.tone} icon={style.icon}>
              {t(`importReview.outcomes.${row.outcome}`)}
            </Badge>
          );
        },
      },
      {
        id: 'key',
        header: t('importReview.columns.key'),
        mono: true,
        cell: (row) => rowKey(row, job.mapping) || '-',
      },
      {
        id: 'problem',
        header: t('importReview.columns.problem'),
        cell: (row) => {
          const lines = rowMessages(row);
          if (lines.length === 0)
            return <span className="text-muted">{t('importReview.noProblem')}</span>;
          return (
            <span className="flex flex-col">
              {row.errors.map((e) => (
                <span key={`e-${e.pointer}-${e.message}`} className="text-danger-text">
                  {e.message}
                </span>
              ))}
              {row.warnings.map((w) => (
                <span key={`w-${w.pointer}-${w.message}`} className="text-muted">
                  {w.message}
                </span>
              ))}
            </span>
          );
        },
      },
    ],
    [t, formatNumber, job.mapping],
  );

  const commit = async () => {
    if (!job.dry_run_digest) return;
    setCommitting(true);
    setError(null);
    try {
      await importsApi.commit(job.id, job.dry_run_digest, keys.current.keyFor(job.dry_run_digest));
      await client.invalidateQueries({ queryKey: ['import', job.id] });
    } catch (err) {
      setError(getApi().toUiError(err));
    } finally {
      setCommitting(false);
    }
  };

  /** Back to an earlier step: saving the settings again returns a reviewed dry run to a draft. */
  const backTo = async (step: 'mapping' | 'file') => {
    try {
      await importsApi.update(job.id, { mapping: job.mapping });
      await client.invalidateQueries({ queryKey: ['import', job.id] });
      router.push(routes.importJob(job.id, step));
    } catch (err) {
      setError(getApi().toUiError(err));
    }
  };

  // ---- the worker is still checking ----------------------------------------------------------------

  if (!complete) {
    return (
      <section aria-labelledby="import-review-heading" aria-busy className="flex flex-col gap-4">
        <h2 id="import-review-heading" className="text-lg font-semibold text-text">
          {t('importReview.heading')}
        </h2>
        <Banner tone="info">{t('importReview.banner')}</Banner>
        <p role="status" className="text-base text-text">
          {job.state === 'dry_run_queued' ? t('importReview.waiting') : t('importReview.checking')}
        </p>
        <progress className="h-2 w-full max-w-xl" aria-label={t('importReview.checking')} />
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
            name: job.original_filename ?? '',
            count: formatNumber(job.rows_total ?? 0),
          })}
        </p>
      </div>
      <Banner tone="info">{t('importReview.banner')}</Banner>

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
                {formatNumber(countOf(job, outcome))}
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                <Icon aria-hidden className="size-3.5" />
                {t(`importReview.tiles.${outcome}`)}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('importReview.show')} className="flex flex-wrap gap-1.5">
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
        {(job.rows_error ?? 0) > 0 ? (
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
            {t('importReview.range', {
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

      {(job.rows_error ?? 0) > 0 && toWrite > 0 ? (
        <Banner tone="warning">
          {t('importReview.errorsWillBeSkipped', { count: job.rows_error ?? 0 })}
        </Banner>
      ) : null}
      {toWrite === 0 ? <Banner tone="warning">{t('importReview.nothingToImport')}</Banner> : null}
      {error ? (
        <FormError
          message={
            error.code === 'import-stale-dry-run'
              ? t('importReview.stale')
              : `${t('importReview.commitFailed')} ${uiErrorText(t, error)}`
          }
          requestId={error.requestId}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void backTo('mapping')}>{t('importReview.back')}</Button>
        <Button onClick={() => void backTo('file')}>{t('importReview.fix')}</Button>
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
    </section>
  );
}
