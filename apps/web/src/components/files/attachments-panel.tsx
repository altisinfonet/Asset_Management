'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { Banner } from '@/components/ui/banner';
import { IconButton } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import { attachmentsApi, isImage } from '@/lib/files/api';
import { useUploads } from '@/lib/files/use-uploads';
import type { Attachment, AttachmentEntity, AttachmentKind } from '@/lib/registry/types';
import { FileDropzone, FileTypeIcon, formatBytes, ScanBadge, UploadList } from './file-parts';

export interface AttachmentsPanelProps {
  entityType: AttachmentEntity;
  entityId: string;
  /** Whether the user may add and remove files (`attachment:write`). */
  canWrite: boolean;
  /** What new files are filed as (`document` by default; `photo` for pictures). */
  kind?: AttachmentKind;
}

const listKey = (type: AttachmentEntity, id: string) => ['attachments', type, id] as const;
const POLL_MS = 2500;

/**
 * Attachments of one record (M2-FILE-04): drop zone, upload progress, the files with their virus
 * scan state (scanning / ready / rejected), thumbnails for clean images, download and delete with a
 * confirmation. A clean file is the only one that can be downloaded; the list refreshes itself while
 * a scan is pending. A refused upload shows the server's message.
 */
export function AttachmentsPanel({
  entityType,
  entityId,
  canWrite,
  kind = 'document',
}: AttachmentsPanelProps) {
  const { t, formatDateTime } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const [removing, setRemoving] = useState<Attachment | null>(null);

  const list = useQuery({
    queryKey: listKey(entityType, entityId),
    queryFn: () => attachmentsApi.list(entityType, entityId, { limit: 100 }),
    refetchInterval: (query) =>
      query.state.data?.data.some((a) => a.scan_status === 'pending') ? POLL_MS : false,
  });
  const files = useMemo(() => list.data?.data ?? [], [list.data]);

  const uploads = useUploads({
    entityType,
    entityId,
    kind,
    pollScan: false,
    onServerChange: () =>
      void client.invalidateQueries({ queryKey: listKey(entityType, entityId) }),
  });
  // A file that reached the server list is shown there (with its own scan state), not twice.
  const known = new Set(files.map((file) => file.id));
  const inFlight = uploads.items.filter(
    (item) => !(item.attachment && known.has(item.attachment.id) && item.status !== 'failed'),
  );

  const download = async (attachment: Attachment) => {
    try {
      const fresh = await attachmentsApi.get(attachment.id);
      if (!fresh.download_url) {
        toast({ variant: 'warning', title: t('files.notReady') });
        return;
      }
      const link = document.createElement('a');
      link.href = fresh.download_url;
      link.download = attachment.filename;
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
    } catch (err) {
      const ui = getApi().toUiError(err);
      toast({ variant: 'danger', title: uiErrorText(t, ui), requestId: ui.requestId });
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {canWrite ? (
        <FileDropzone
          onFiles={uploads.add}
          buttonLabel={t('files.choose')}
          dropLabel={t('files.dropHere')}
          hint={t('files.limits')}
        />
      ) : null}

      <UploadList
        label={t('files.uploads')}
        items={inFlight}
        onCancel={uploads.remove}
        onRetry={uploads.retry}
      />

      {list.error && !list.data ? (
        <Banner tone="danger">{t('common.loadFailed')}</Banner>
      ) : list.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : files.length === 0 ? (
        <p className="flex items-center gap-2 text-base text-muted">
          <Paperclip aria-hidden className="size-4" />
          {t('files.none')}
        </p>
      ) : (
        <ul
          aria-label={t('files.listLabel')}
          className="flex flex-col divide-y divide-border rounded-lg border border-border"
        >
          {files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-3 p-3">
              <Thumb attachment={file} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{file.filename}</p>
                <p className="text-sm text-muted">
                  {formatBytes(file.size_bytes)}
                  {' - '}
                  {t(`files.kinds.${file.kind}`)}
                  {' - '}
                  {formatDateTime(file.uploaded_at ?? file.created_at)}
                </p>
              </div>
              <ScanBadge status={file.scan_status} />
              <div className="flex items-center gap-1">
                {file.scan_status === 'clean' ? (
                  <IconButton
                    icon={Download}
                    size="icon-sm"
                    label={t('files.download', { name: file.filename })}
                    onClick={() => void download(file)}
                  />
                ) : null}
                {canWrite ? (
                  <IconButton
                    icon={Trash2}
                    size="icon-sm"
                    label={t('files.delete', { name: file.filename })}
                    onClick={() => setRemoving(file)}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('files.deleteTitle', { name: removing?.filename ?? '' })}
        description={t('files.deleteDescription')}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await attachmentsApi.archive(removing.id);
          await client.invalidateQueries({ queryKey: listKey(entityType, entityId) });
          toast({ variant: 'success', title: t('files.deleted', { name: removing.filename }) });
        }}
      />
    </div>
  );
}

/** Thumbnail of a clean image (its short-lived `download_url` is fetched on demand); an icon otherwise. */
function Thumb({ attachment }: { attachment: Attachment }) {
  const clean = attachment.scan_status === 'clean' && isImage(attachment);
  const detail = useQuery({
    queryKey: ['attachment-url', attachment.id],
    queryFn: () => attachmentsApi.get(attachment.id),
    enabled: clean,
    staleTime: 4 * 60_000,
  });
  const url = detail.data?.download_url;
  if (clean && url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a signed storage URL, not an optimisable asset
      <img src={url} alt="" loading="lazy" className="size-12 shrink-0 rounded-md object-cover" />
    );
  }
  return <FileTypeIcon contentType={attachment.content_type} />;
}
