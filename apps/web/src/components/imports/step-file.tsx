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
import { megabytes } from '@/lib/files/messages';
import { useUploadLimit } from '@/lib/files/use-upload-limit';
import { useUploads } from '@/lib/files/use-uploads';
import { downloadTemplate, importKeys, importsApi, type ImportJob } from '@/lib/imports/api';
import { importErrorText, type ImportErrorText } from '@/lib/imports/error-text';
import { IMPORT_KINDS, isPurged, kindOf, withImportContentType } from '@/lib/imports/helpers';
import { routes } from '@/lib/routes';

/**
 * Step "Upload file": the same pipeline as every attachment (presigned PUT with progress, then the
 * virus scan), owned by the import job. Once the file is clean the analysis is queued (`202`) and the
 * wizard moves on to matching columns while the worker reads the file. CSV and Excel (.xlsx) files
 * are accepted. With `replacing`, the file of an import that has been read already is swapped: the
 * new file is read again and its columns are matched afresh.
 */
export function StepFile({ job, replacing = false }: { job: ImportJob; replacing?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const client = useQueryClient();
  const limit = useUploadLimit();
  const [error, setError] = useState<ImportErrorText | null>(null);
  const [templateFailed, setTemplateFailed] = useState(false);
  const [starting, setStarting] = useState(false);
  /** The file that is uploaded and clean but whose analysis could not be queued (a retry starts it). */
  const [waiting, setWaiting] = useState<string | null>(null);

  const analyse = async (attachmentId?: string) => {
    setError(null);
    setStarting(true);
    try {
      setWaiting(attachmentId ?? null);
      await importsApi.analyze(job.id, attachmentId ? { file_attachment_id: attachmentId } : {});
      setWaiting(null);
      await client.invalidateQueries({ queryKey: importKeys.job(job.id) });
      router.replace(routes.importJob(job.id));
    } catch (err) {
      setError(importErrorText(t, err, t('importFile.attachFailed')));
    } finally {
      setStarting(false);
    }
  };

  const uploads = useUploads({
    entityType: 'import_job',
    entityId: job.id,
    kind: 'import_file',
    maxBytes: limit,
    onReady: (attachment) => void analyse(attachment.id),
  });
  const kind = kindOf(job);
  const preset = IMPORT_KINDS.find((candidate) => candidate.id === kind)!.preset;
  const busy =
    starting ||
    uploads.items.some((item) =>
      ['queued', 'uploading', 'finishing', 'scanning'].includes(item.status),
    );

  return (
    <section aria-labelledby="import-file-heading" className="flex max-w-2xl flex-col gap-4">
      <div>
        <h2 id="import-file-heading" className="text-lg font-semibold text-text">
          {t('importFile.heading')}
        </h2>
        <p className="text-base text-muted">{t('importFile.description')}</p>
      </div>
      {replacing ? <p className="text-sm text-muted">{t('importFile.replaceNote')}</p> : null}
      {/* one file at a time: while it travels or is scanned the drop zone gives way to its progress */}
      {busy ? null : (
        <FileDropzone
          accept=".csv,.xlsx"
          multiple={false}
          buttonLabel={t('importFile.button')}
          dropLabel={t('importFile.drop')}
          hint={
            limit ? t('importFile.hint', { limit: megabytes(limit) }) : t('importFile.hintNoLimit')
          }
          onFiles={(files) => uploads.add(files.map(withImportContentType))}
        />
      )}
      <UploadList
        label={t('importFile.uploads')}
        limit={limit}
        items={uploads.items}
        onCancel={uploads.remove}
        onRetry={uploads.retry}
      />
      {error ? (
        <FormError message={error.message} requestId={error.requestId} details={error.details} />
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
          onClick={() => void downloadTemplate(preset, 'csv').catch(() => setTemplateFailed(true))}
        >
          <Download aria-hidden className="size-4" />
          {t('importNew.templateCsv', { kind: t(`imports.kinds.${kind}.title`) })}
        </Button>
        <Button
          variant="link"
          size="sm"
          onClick={() => void downloadTemplate(preset, 'xlsx').catch(() => setTemplateFailed(true))}
        >
          <Download aria-hidden className="size-4" />
          {t('importNew.templateXlsx', { kind: t(`imports.kinds.${kind}.title`) })}
        </Button>
        {waiting ? (
          <Button size="sm" disabled={starting} onClick={() => void analyse(waiting)}>
            {t('importFile.readAgain')}
          </Button>
        ) : null}
        {replacing && job.file_attachment_id && !isPurged(job) ? (
          <Button size="sm" variant="ghost" disabled={starting} onClick={() => void analyse()}>
            {t('importFile.readAgain')}
          </Button>
        ) : null}
        {replacing ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={routes.importJob(job.id)}>{t('importFile.cancel')}</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
