'use client';

import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui/button';
import { useT } from '@/i18n';
import { attachmentsApi } from '@/lib/files/api';
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
  max = 4,
}: UploadSlotProps) {
  const t = useT();
  const idsRef = useRef(value);
  useEffect(() => {
    idsRef.current = value;
  });

  const uploads = useUploads({
    entityType,
    entityId,
    kind,
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
        hint={t('files.photoHint')}
      />
      <UploadList
        label={t('files.uploads')}
        items={pending}
        onCancel={uploads.remove}
        onRetry={uploads.retry}
      />
      {ready.length > 0 ? (
        <ul aria-label={t('files.attached')} className="flex flex-col gap-1">
          {ready.map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-base">
              <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
              <ScanBadge status="clean" />
              <IconButton
                icon={X}
                size="icon-sm"
                label={t('files.removeFromForm', { name: item.file.name })}
                onClick={() => uploads.remove(item.key)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
