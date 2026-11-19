'use client';

import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui/button';
import { useT } from '@/i18n';
import { attachmentsApi } from '@/lib/files/api';
import { megabytes } from '@/lib/files/messages';
import { useUploadLimit } from '@/lib/files/use-upload-limit';
import { useUploads } from '@/lib/files/use-uploads';
import type { AttachmentEntity, AttachmentKind } from '@/lib/registry/types';
import { FileDropzone, ScanBadge, UploadList } from './file-parts';

export interface UploadSlotProps {
  entityType: AttachmentEntity;
  entityId: string;
  kind?: AttachmentKind;
  /** Ids of the attachments that finished (clean) and will be linked by the form's request. */
  value: string[];
  onChange: (ids: string[]) => void;
  /** True while a file is still uploading or being scanned: the form should wait before sending. */
  onBusyChange?: (busy: boolean) => void;
  accept?: string;
  disabled?: boolean;
  /** Why a clean file cannot be used (the 422 of the request that linked it), by attachment id. */
  errors?: Record<string, string>;
  /** Most files allowed (the API takes up to 10 `attachment_ids`). */
  max?: number;
}

/**
 * The photo slot of a form (check-in condition photo): the same upload pipeline as the attachments
 * panel, but the result is a list of attachment ids for the form's own request. Only clean files
 * count; one still scanning keeps the form busy.
 */
export function UploadSlot({
  entityType,
  entityId,
  kind = 'photo',
  value,
  onChange,
  onBusyChange,
  accept = 'image/*',
  disabled,
  errors,
  max = 4,
}: UploadSlotProps) {
  const t = useT();
  const idsRef = useRef(value);
  useEffect(() => {
    idsRef.current = value;
  });

  const limit = useUploadLimit();
  const uploads = useUploads({
    entityType,
    entityId,
    kind,
    maxBytes: limit,
    onReady: (attachment) => onChange([...idsRef.current, attachment.id]),
    onRemoved: (attachment) => {
      onChange(idsRef.current.filter((id) => id !== attachment.id));
      void attachmentsApi.archive(attachment.id).catch(() => undefined);
    },
  });

  const busy = useMemo(
    () =>
      uploads.items.some((item) =>
        ['queued', 'uploading', 'finishing', 'scanning'].includes(item.status),
      ),
    [uploads.items],
  );
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const ready = uploads.items.filter((item) => item.status === 'ready');
  const pending = uploads.items.filter((item) => item.status !== 'ready');

  return (
    <div className="flex flex-col gap-2">
      <FileDropzone
        compact
        accept={accept}
        multiple
        disabled={disabled || value.length >= max}
        onFiles={uploads.add}
        buttonLabel={t('files.addPhoto')}
        dropLabel={t('files.dropPhoto')}
        hint={
          limit ? t('files.photoHintWithSize', { limit: megabytes(limit) }) : t('files.photoHint')
        }
      />
      <UploadList
        label={t('files.uploads')}
        limit={limit}
        items={pending}
        onCancel={uploads.remove}
        onRetry={uploads.retry}
      />
      {ready.length > 0 ? (
        <ul aria-label={t('files.attached')} className="flex flex-col gap-1">
          {ready.map((item) => {
            const problem = item.attachment ? errors?.[item.attachment.id] : undefined;
            return (
              <li key={item.key} className="flex flex-col gap-0.5 text-base">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                  <ScanBadge status="clean" />
                  <IconButton
                    icon={X}
                    size="icon-sm"
                    label={t('files.removeFromForm', { name: item.file.name })}
                    onClick={() => uploads.remove(item.key)}
                  />
                </span>
                {problem ? (
                  <span role="alert" className="text-sm text-danger-text">
                    {problem}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
