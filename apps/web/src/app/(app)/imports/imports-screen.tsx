'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus, Upload } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { importKeys, importsApi, type ImportJob, type ImportState } from '@/lib/imports/api';
import { isResumable, isRunning, kindOf, progressPercent } from '@/lib/imports/helpers';
import { routes } from '@/lib/routes';

const STATE_TONE: Record<ImportState, NonNullable<BadgeProps['tone']>> = {
  draft: 'neutral',
  uploaded: 'neutral',
  analyzing: 'info',
  analyzed: 'warning',
  mapped: 'warning',
  dry_running: 'info',
  dry_run_done: 'warning',
  committing: 'primary',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

/**
 * The imports so far (M2-IMP-08): newest first, with the state of each. One that is not finished
 * can be continued: the wizard lands on the step its state calls for, so a reload or a day later
 * makes no difference.
 */
export function ImportsScreen() {
  const { t, formatNumber, formatDateTime } = useI18n();
  const { can } = useAuth();
  const list = useQuery({
    queryKey: importKeys.list(),
    queryFn: () => importsApi.list({ limit: 50 }),
    select: (page) => page.data,
    refetchInterval: (query) =>
      query.state.data?.data.some((job) => isRunning(job.state)) ? 2000 : false,
  });
  const canRun = can('import:run');

  const columns: DataTableColumn<ImportJob>[] = [
    {
      id: 'file',
      header: t('imports.columns.file'),
      sticky: true,
      cell: (job) => (
        <Link
          href={routes.importJob(job.id)}
          className="rounded-sm text-primary-text underline underline-offset-2"
        >
          {job.filename ?? t('imports.noFile')}
        </Link>
      ),
    },
    {
      id: 'data',
      header: t('imports.columns.data'),
      cell: (job) => t(`imports.kinds.${kindOf(job)}.title`),
    },
    {
      id: 'state',
      header: t('imports.columns.state'),
      cell: (job) => (
        <Badge tone={STATE_TONE[job.state]}>
          {t(`imports.states.${job.state}`)}
          {isRunning(job.state) && job.progress.total > 0
            ? ` ${t('imports.percent', { percent: progressPercent(job) })}`
            : ''}
        </Badge>
      ),
    },
    {
      id: 'rows',
      header: t('imports.columns.rows'),
      align: 'end',
      cell: (job) => (job.rows_total ? formatNumber(job.rows_total) : '-'),
    },
    {
      id: 'started',
      header: t('imports.columns.started'),
      cell: (job) => (job.created_at ? formatDateTime(job.created_at) : '-'),
    },
    {
      id: 'actions',
      header: t('imports.columns.actions'),
      srOnlyHeader: true,
      align: 'end',
      cell: (job) => {
        const name = job.filename ?? t(`imports.kinds.${kindOf(job)}.title`);
        return (
          <Button asChild size="sm">
            <Link
              href={routes.importJob(job.id)}
              aria-label={
                isResumable(job.state)
                  ? t('imports.continueNamed', { name })
                  : t('imports.viewNamed', { name })
              }
            >
              {isResumable(job.state) ? t('imports.continue') : t('imports.view')}
            </Link>
          </Button>
        );
      },
    },
  ];

  return (
    <>
      <PageTitle title={t('imports.title')} />
      <PageHeader
        title={t('imports.title')}
        description={t('imports.description')}
        actions={
          canRun ? (
            <Button asChild variant="primary">
              <Link href={routes.importNew()}>
                <Plus aria-hidden className="size-4" />
                {t('imports.newImport')}
              </Link>
            </Button>
          ) : null
        }
      />
      {list.isError ? (
        <Banner
          tone="danger"
          className="mb-3"
          action={<Button onClick={() => void list.refetch()}>{t('common.retry')}</Button>}
        >
          {t('imports.loadFailed')}
        </Banner>
      ) : null}
      <DataTable
        label={t('imports.tableLabel')}
        columns={columns}
        rows={list.data ?? []}
        getRowId={(job) => job.id}
        getRowLabel={(job) => job.filename ?? job.id}
        loading={list.isPending}
        empty={
          <EmptyState
            icon={Upload}
            title={t('imports.empty.title')}
            description={t('imports.empty.description')}
            actions={
              canRun ? (
                <Button asChild variant="primary">
                  <Link href={routes.importNew()}>{t('imports.newImport')}</Link>
                </Button>
              ) : undefined
            }
          />
        }
      />
    </>
  );
}
