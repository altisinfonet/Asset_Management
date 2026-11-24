'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Download, Printer } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import { downloadErrorReport, importsApi, type ImportJob } from '@/lib/imports/api';
import { commitPercent, listRouteFor } from '@/lib/imports/helpers';
import { routes } from '@/lib/routes';

/**
 * Step "Import": the commit running, with a progress bar fed by polling and a way to stop it (the
 * current batch finishes, rows already written stay). The page can be left; the import list brings
 * the person back.
 */
export function StepCommit({ job }: { job: ImportJob }) {
  const { t, formatNumber } = useI18n();
  const client = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const percent = commitPercent(job);
  const done = job.commit_progress?.processed ?? 0;
  const total = job.rows_total ?? 0;

  const cancel = async () => {
    setCancelling(true);
    setError(null);
    try {
      await importsApi.cancel(job.id);
      await client.invalidateQueries({ queryKey: ['import', job.id] });
    } catch (err) {
      setCancelling(false);
      setError(getApi().toUiError(err));
    }
  };

  return (
    <section aria-labelledby="import-run-heading" className="flex max-w-2xl flex-col gap-4">
      <h2 id="import-run-heading" className="text-lg font-semibold text-text">
        {t('importRun.heading')}
      </h2>
      <div className="flex flex-col gap-2">
        <p role="status" className="text-base text-text" data-testid="import-progress-text">
          {job.state === 'commit_queued' && done === 0
            ? t('importRun.waiting')
            : t('importRun.progress', { done: formatNumber(done), total: formatNumber(total) })}
        </p>
        <progress
          className="h-3 w-full"
          value={percent}
          max={100}
          aria-label={t('importRun.progressLabel')}
          data-testid="import-progress"
        />
      </div>
      {cancelling ? <Banner tone="info">{t('importRun.cancelling')}</Banner> : null}
      {error ? (
        <FormError
          message={`${t('importRun.cancelFailed')} ${uiErrorText(t, error)}`}
          requestId={error.requestId}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={cancelling} onClick={() => void cancel()}>
          {t('importRun.cancel')}
        </Button>
        <p className="text-sm text-muted">{t('importRun.cancelNote')}</p>
      </div>
      <p className="text-sm text-muted">{t('importRun.leaveNote')}</p>
    </section>
  );
}

/** The finished screen: counts, where to look at the result, the error report, or why it failed or stopped. */
export function StepDone({ job }: { job: ImportJob }) {
  const { t, formatNumber } = useI18n();
  const [reportFailed, setReportFailed] = useState(false);
  const progress = job.commit_progress;
  const failed = progress?.failed ?? job.rows_error ?? 0;
  const created = progress?.created ?? job.rows_create ?? 0;

  if (job.state === 'failed') {
    return (
      <section aria-labelledby="import-done-heading" className="flex max-w-2xl flex-col gap-4">
        <h2 id="import-done-heading" className="text-lg font-semibold text-text">
          {t('importDone.failedTitle')}
        </h2>
        <Banner tone="danger">{job.error ?? t('importDone.failedUnknown')}</Banner>
        <Actions job={job} />
      </section>
    );
  }

  const cancelled = job.state === 'cancelled';
  const written = (progress?.created ?? 0) + (progress?.updated ?? 0);
  return (
    <section aria-labelledby="import-done-heading" className="flex max-w-2xl flex-col gap-4">
      <h2 id="import-done-heading" className="text-lg font-semibold text-text">
        {cancelled ? t('importDone.cancelledTitle') : t('importDone.finished')}
      </h2>
      {cancelled ? (
        <Banner tone="warning">{t('importDone.cancelledDescription', { count: written })}</Banner>
      ) : (
        <Banner tone="success">{t('importDone.finishedDescription')}</Banner>
      )}
      <ul
        aria-label={t('importDone.summaryLabel')}
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        data-testid="import-summary"
      >
        {(
          [
            ['created', created, CircleCheck],
            ['updated', progress?.updated ?? job.rows_update ?? 0, CircleCheck],
            ['skipped', progress?.skipped ?? job.rows_skip ?? 0, CircleCheck],
            ['failed', failed, CircleAlert],
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
      {failed > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-base text-text">{t('importDone.errorsNote', { count: failed })}</p>
          <div>
            <Button
              onClick={() => void downloadErrorReport(job.id).catch(() => setReportFailed(true))}
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
        </div>
      ) : null}
      <Actions job={job} />
      {!cancelled ? (
        <p className="text-sm text-muted">
          {t('importDone.notice')} {t('importDone.undo')}
        </p>
      ) : null}
    </section>
  );
}

function Actions({ job }: { job: ImportJob }) {
  const { t } = useI18n();
  const listKey = job.entity_type as 'asset' | 'person' | 'location' | 'department';
  const showList = ['asset', 'person', 'location', 'department'].includes(job.entity_type);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {job.state === 'committed' && showList ? (
        <Button asChild variant="primary">
          <Link href={listRouteFor(job.entity_type)}>{t(`importDone.viewList.${listKey}`)}</Link>
        </Button>
      ) : null}
      {job.state === 'committed' && job.entity_type === 'asset' ? (
        <Button asChild>
          <Link href={routes.assets}>
            <Printer aria-hidden className="size-4" />
            {t('importDone.printLabels')}
          </Link>
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
  );
}
