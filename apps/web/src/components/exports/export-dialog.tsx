'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FormError } from '@/components/auth/form-error';
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
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import {
  exportFilters,
  exportsApi,
  isFinished,
  type ExportJob,
  type ExportResource,
} from '@/lib/exports/api';

const POLL_MS = 1500;

/**
 * CSV export of a list (M2-REG-02): starts the job with the list's current filters (the same query
 * parameters as the list, without paging), shows its progress and offers the short-lived download
 * when it is ready. Opening the dialog starts the export, so the button that opens it is the user's
 * decision. With `jobId` it follows an export that was started earlier instead (the notification
 * "your export is ready" opens it).
 */
export function ExportDialog({
  open,
  onOpenChange,
  resource,
  query,
  jobId: followed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: ExportResource;
  /** The query of the list (paging and presentation members are left out). */
  query: object;
  jobId?: string;
}) {
  const { t, formatDateTime } = useI18n();
  const client = useQueryClient();
  const [job, setJob] = useState<ExportJob | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ query, resource });
  useEffect(() => {
    latest.current = { query, resource };
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new run starts from nothing
    setJob(null);
    setError(null);
    const start = followed
      ? exportsApi.get(followed)
      : exportsApi.create({
          resource: latest.current.resource,
          filters: exportFilters(latest.current.query),
        });
    start
      .then((created) => {
        if (!cancelled) setJob(created);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getApi().toUiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, attempt, followed]);

  const jobId = job?.id;
  const polled = useQuery({
    queryKey: ['export', jobId],
    queryFn: () => exportsApi.get(jobId!),
    enabled: open && !!jobId && !isFinished(job!),
    refetchInterval: (state) =>
      state.state.data && isFinished(state.state.data) ? false : POLL_MS,
    retry: false,
  });
  const current = polled.data ?? job;
  const failed = current?.status === 'failed';
  const expired = current?.status === 'expired';
  const ready = current?.status === 'succeeded' && !!current.download_url;
  const pollError = polled.error ? getApi().toUiError(polled.error) : null;
  const shownError = error ?? pollError;

  // a finished export raises an `export.completed` notification: the bell reads again
  const finishedStatus = current?.status;
  useEffect(() => {
    if (finishedStatus === 'succeeded') {
      void client.invalidateQueries({ queryKey: ['notifications'] });
    }
  }, [finishedStatus, client]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('exports.title')}</DialogTitle>
          <DialogDescription>{t('exports.description')}</DialogDescription>
        </DialogHeader>
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-3"
          data-testid="export-status"
        >
          {shownError ? (
            <FormError message={uiErrorText(t, shownError)} requestId={shownError.requestId} />
          ) : failed ? (
            <Banner tone="danger" title={t('exports.failed')}>
              {current?.error}
            </Banner>
          ) : expired ? (
            <Banner tone="warning">{t('exports.expired')}</Banner>
          ) : ready ? (
            <Banner tone="success" title={t('exports.ready')}>
              {current?.row_count != null
                ? t('exports.readyRows', { count: current.row_count })
                : null}{' '}
              {current?.expires_at
                ? t('exports.expires', { time: formatDateTime(current.expires_at) })
                : null}
            </Banner>
          ) : (
            <>
              <p className="text-base">{job ? t('exports.working') : t('exports.starting')}</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                <div className="h-full w-1/3 animate-[at-pulse_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
              </div>
            </>
          )}
        </div>
        <p className="text-sm text-muted">{t('exports.audited')}</p>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
          {(failed || expired || error) && !followed ? (
            <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
              {t('exports.retry')}
            </Button>
          ) : null}
          {ready ? (
            <Button asChild variant="primary">
              <a href={current!.download_url!} download>
                <Download aria-hidden className="size-4" />
                {t('exports.download')}
              </a>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
