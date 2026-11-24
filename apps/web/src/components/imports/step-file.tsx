'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { FileDropzone, UploadList } from '@/components/files/file-parts';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import { megabytes } from '@/lib/files/messages';
import { useUploadLimit } from '@/lib/files/use-upload-limit';
import { useUploads } from '@/lib/files/use-uploads';
import { downloadTemplate, importsApi, type ImportJob } from '@/lib/imports/api';
import { kindOf } from '@/lib/imports/helpers';
import { routes } from '@/lib/routes';

/**
 * Step "Upload file": the same pipeline as every attachment (presigned PUT with progress, then the
 * virus scan), owned by the import job. Once the file is clean it is attached to the job and the
 * wizard moves on to matching columns. With `replacing`, a file already attached is swapped; the
 * column choices are kept and the job goes back to its draft.
 */
export function StepFile({ job, replacing = false }: { job: ImportJob; replacing?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const client = useQueryClient();
  const limit = useUploadLimit();
  const [error, setError] = useState<UiError | null>(null);
  const [templateFailed, setTemplateFailed] = useState(false);

  const attach = async (attachmentId: string) => {
    setError(null);
    try {
      // A reviewed dry run goes back to a draft when its settings are saved again (the contract's rule).
      if (job.state !== 'draft') await importsApi.update(job.id, { mapping: job.mapping });
      await importsApi.update(job.id, { file_attachment_id: attachmentId });
      await client.invalidateQueries({ queryKey: ['import', job.id] });
      router.replace(routes.importJob(job.id));
    } catch (err) {
      setError(getApi().toUiError(err));
    }
  };

  const uploads = useUploads({
    entityType: 'import_job',
    entityId: job.id,
    kind: 'import_file',
    maxBytes: limit,
    onReady: (attachment) => void attach(attachment.id),
  });
  const kind = kindOf(job);

  return (
    <section aria-labelledby="import-file-heading" className="flex max-w-2xl flex-col gap-4">
      <div>
        <h2 id="import-file-heading" className="text-lg font-semibold text-text">
          {t('importFile.heading')}
        </h2>
        <p className="text-base text-muted">{t('importFile.description')}</p>
      </div>
      {replacing ? <p className="text-sm text-muted">{t('importFile.replaceNote')}</p> : null}
      <FileDropzone
        accept=".csv,text/csv"
        multiple={false}
        buttonLabel={t('importFile.button')}
        dropLabel={t('importFile.drop')}
        hint={
          limit ? t('importFile.hint', { limit: megabytes(limit) }) : t('importFile.hintNoLimit')
        }
        onFiles={uploads.add}
        disabled={uploads.items.some((item) =>
          ['queued', 'uploading', 'finishing', 'scanning'].includes(item.status),
        )}
      />
      <UploadList
        label={t('importFile.uploads')}
        limit={limit}
        items={uploads.items}
        onCancel={uploads.remove}
        onRetry={uploads.retry}
      />
      {error ? (
        <FormError
          message={error.detail ?? `${t('importFile.attachFailed')} ${uiErrorText(t, error)}`}
          requestId={error.requestId}
        />
      ) : null}
      {templateFailed ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('importNew.templateFailed')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="link"
          size="sm"
          onClick={() =>
            void downloadTemplate(job.entity_type, job.source).catch(() => setTemplateFailed(true))
          }
        >
          <Download aria-hidden className="size-4" />
          {t('importNew.templateNamed', { kind: t(`imports.kinds.${kind}.title`) })}
        </Button>
        {replacing ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={routes.importJob(job.id)}>{t('importFile.cancel')}</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
