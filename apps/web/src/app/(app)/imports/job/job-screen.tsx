'use client';

import { useQuery } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ImportStepper } from '@/components/imports/import-stepper';
import { StepDone, StepCommit } from '@/components/imports/step-commit';
import { StepFile } from '@/components/imports/step-file';
import { StepMapping } from '@/components/imports/step-mapping';
import { StepReview } from '@/components/imports/step-review';
import { StepValues } from '@/components/imports/step-values';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/i18n';
import { importsApi } from '@/lib/imports/api';
import { isRunning, kindOf, stepFor, type WizardStep } from '@/lib/imports/helpers';
import { routes } from '@/lib/routes';

/**
 * One import (M2-IMP-08): the wizard from the file on. The job's state decides the step, so a
 * reload, a link from the list or the "import finished" notification lands in the right place;
 * while the worker is busy the job is polled once a second.
 */
export function JobScreen() {
  const { t } = useI18n();
  const params = useSearchParams();
  const id = params.get('id');
  const requested = params.get('step');

  const job = useQuery({
    queryKey: ['import', id],
    queryFn: () => importsApi.get(id!),
    enabled: !!id,
    retry: false,
    refetchInterval: (query) =>
      query.state.data && isRunning(query.state.data.value.state) ? 1000 : false,
  });

  if (!id) {
    return (
      <>
        <PageTitle title={t('imports.title')} />
        <EmptyState
          icon={Upload}
          title={t('imports.missingId')}
          actions={
            <Button asChild>
              <Link href={routes.imports}>{t('imports.allImports')}</Link>
            </Button>
          }
        />
      </>
    );
  }
  if (job.isError) {
    return (
      <>
        <PageTitle title={t('imports.title')} />
        <EmptyState
          icon={Upload}
          title={t('imports.notFound')}
          actions={
            <Button asChild>
              <Link href={routes.imports}>{t('imports.allImports')}</Link>
            </Button>
          }
        />
      </>
    );
  }
  if (!job.data) {
    return (
      <>
        <PageTitle title={t('imports.title')} />
        <Skeleton className="h-8 w-64" />
      </>
    );
  }

  const current = job.data.value;
  const step: WizardStep = stepFor(current, requested);
  const kind = kindOf(current);
  const draft = current.state === 'draft';
  const links: Partial<Record<WizardStep, string>> = {
    type: routes.importNew(kind === 'chromeos' ? undefined : kind),
    ...(draft && current.file_attachment_id
      ? {
          file: routes.importJob(id, 'file'),
          mapping: routes.importJob(id, 'mapping'),
          values: routes.importJob(id, 'values'),
        }
      : {}),
  };

  return (
    <>
      <PageTitle title={t('imports.title')} />
      <PageHeader
        title={t(`imports.kinds.${kind}.title`)}
        description={current.original_filename ?? t('imports.dryRunNote')}
        actions={
          <Button asChild variant="ghost">
            <Link href={routes.imports}>{t('imports.allImports')}</Link>
          </Button>
        }
      />
      <ImportStepper step={step} links={links} />
      {job.isError ? <Banner tone="danger">{t('imports.loadJobFailed')}</Banner> : null}
      {step === 'file' ? <StepFile job={current} replacing={!!current.file_attachment_id} /> : null}
      {step === 'mapping' ? <StepMapping key={current.file_attachment_id} job={current} /> : null}
      {step === 'values' ? <StepValues job={current} /> : null}
      {step === 'review' ? <StepReview job={current} /> : null}
      {step === 'import' ? <StepCommit job={current} /> : null}
      {step === 'done' ? <StepDone job={current} /> : null}
    </>
  );
}
