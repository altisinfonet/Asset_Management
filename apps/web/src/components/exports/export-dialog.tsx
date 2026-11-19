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
import { exportsApi, isFinished, type ExportJob } from '@/lib/exports/api';
import type { AssetListQuery } from '@/lib/registry/api';

const POLL_MS = 1500;

/** The list query an export repeats: the filters and sort of the list, never its page. */
export function exportQuery(query: AssetListQuery): Record<string, unknown> {
  const { cursor: _cursor, limit: _limit, include_total: _total, expand: _expand, ...rest } = query;
  return rest;
}

/**
 * CSV export of the asset list (M2-REG-02): starts the job with the list's current filters, shows
 * its progress and offers the short-lived download when it is ready. Opening the dialog starts the
 * export, so the button that opens it is the user's decision.
 */
export function ExportDialog({
  open,
  onOpenChange,
  query,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: AssetListQuery;
}) {
  const { t, formatDateTime } = useI18n();
  const client = useQueryClient();
  const [job, setJob] = useState<ExportJob | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latestQuery = useRef(query);
  useEffect(() => {
    latestQuery.current = query;
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new run starts from nothing
    setJob(null);
    setError(null);
    exportsApi
      .create({ entity: 'asset', query: exportQuery(latestQuery.current) })
      .then((created) => {
        if (!cancelled) setJob(created);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getApi().toUiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, attempt]);

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
  const ready = current?.status === 'ready' && !!current.download_url;
  const pollError = polled.error ? getApi().toUiError(polled.error) : null;
  const shownError = error ?? pollError;

  // a finished export raises an `export.ready` notification: the bell reads again
  const finishedStatus = current?.status;
  useEffect(() => {
    if (finishedStatus === 'ready') void client.invalidateQueries({ queryKey: ['notifications'] });
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
          {failed || expired || error ? (
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
