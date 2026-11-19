'use client';

import {
  CircleAlert,
  CircleCheck,
  File as FileIcon,
  FileText,
  Hourglass,
  Image as ImageIcon,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { uiErrorText } from '@/lib/error-text';
import type { UploadItem } from '@/lib/files/use-uploads';
import type { ScanStatus } from '@/lib/registry/types';

/** "1.4 MB", "310 KB": sizes are shown in decimal units like the OS file pickers do. */
export function formatBytes(bytes: number, locale = 'en'): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

export interface FileDropzoneProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Limits stated up front ("Images, PDF, Office and CSV files"). */
  hint: ReactNode;
  /** Accessible name of the button that opens the file picker. */
  buttonLabel: string;
  /** Text next to the button ("or drag files here"). */
  dropLabel: string;
  compact?: boolean;
}

/**
 * Drop zone and file picker (design system W15): a real button opens the picker (keyboard
 * operable), dropping files on the zone works too, and the allowed types are stated before the
 * user picks anything.
 */
export function FileDropzone({
  onFiles,
  accept,
  multiple = true,
  disabled,
  hint,
  buttonLabel,
  dropLabel,
  compact,
}: FileDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((file) => !accept || matchesAccept(file, accept));
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) take(event.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed text-center',
        compact ? 'p-3' : 'p-6',
        dragging ? 'border-primary bg-primary-subtle' : 'border-border-strong bg-surface',
        disabled ? 'opacity-60' : null,
      )}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <Button
          size={compact ? 'sm' : 'md'}
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <Upload aria-hidden className="size-4" />
          {buttonLabel}
        </Button>
        <span className="text-base text-muted">{dropLabel}</span>
      </div>
      <p className="text-sm text-muted">{hint}</p>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = ''; // picking the same file twice must still fire
        }}
      />
    </div>
  );
}

/** Whether a file matches an `accept` list (`image/*`, `.pdf`, `application/pdf`). */
export function matchesAccept(file: File, accept: string): boolean {
  return accept
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) =>
      rule.startsWith('.')
        ? file.name.toLowerCase().endsWith(rule)
        : rule.endsWith('/*')
          ? file.type.toLowerCase().startsWith(rule.slice(0, -1))
          : file.type.toLowerCase() === rule,
    );
}

const SCAN_TONE: Record<
  ScanStatus,
  { tone: NonNullable<BadgeProps['tone']>; icon: typeof CircleCheck }
> = {
  pending: { tone: 'info', icon: Hourglass },
  clean: { tone: 'success', icon: CircleCheck },
  infected: { tone: 'danger', icon: ShieldAlert },
  error: { tone: 'warning', icon: CircleAlert },
};

/** Scan state as a labelled chip: scanning / ready / rejected (infected) / could not be scanned. */
export function ScanBadge({ status }: { status: ScanStatus }) {
  const { t } = useI18n();
  const { tone, icon } = SCAN_TONE[status];
  return (
    <Badge tone={tone} icon={icon}>
      {t(`files.scan.${status}`)}
    </Badge>
  );
}

export function FileTypeIcon({ contentType }: { contentType: string }) {
  const Icon = contentType.startsWith('image/')
    ? ImageIcon
    : contentType === 'application/pdf' || contentType.startsWith('text/')
      ? FileText
      : FileIcon;
  return (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-sunken text-muted">
      <Icon aria-hidden className="size-6" />
    </span>
  );
}

/**
 * The files being uploaded now: name, size, a progress bar while the bytes travel, the state
 * (waiting, uploading, scanning, ready, rejected, failed) and what the user can do (cancel, retry,
 * dismiss). A refused file shows the server's own message.
 */
export function UploadList({
  items,
  onCancel,
  onRetry,
  label,
}: {
  items: UploadItem[];
  onCancel: (key: string) => void;
  onRetry: (key: string) => void;
  label: string;
}) {
  const { t, formatNumber } = useI18n();
  if (items.length === 0) return null;
  return (
    <ul
      aria-label={label}
      className="flex flex-col divide-y divide-border rounded-lg border border-border"
    >
      {items.map((item) => {
        const active = item.status === 'uploading' || item.status === 'queued';
        const failed = item.status === 'failed';
        const message = failed
          ? item.error
            ? // a refused type or size: the server's message on the field
              (item.error.fieldErrors[0]?.message ?? uiErrorText(t, item.error))
            : item.uploadFailure
              ? t('files.uploadFailed')
              : ''
          : '';
        return (
          <li key={item.key} className="flex flex-col gap-1.5 p-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{item.file.name}</p>
                <p className="text-sm text-muted">{formatBytes(item.file.size)}</p>
              </div>
              <StatusText item={item} formatNumber={formatNumber} />
              {active ? (
                <IconButton
                  icon={X}
                  size="icon-sm"
                  label={t('files.cancel', { name: item.file.name })}
                  onClick={() => onCancel(item.key)}
                />
              ) : null}
            </div>
            {item.status === 'uploading' ? (
              <progress
                className="h-2 w-full"
                value={Math.round(item.progress * 100)}
                max={100}
                aria-label={t('files.progress', { name: item.file.name })}
              />
            ) : null}
            {failed ? (
              <div className="flex flex-wrap items-center gap-2">
                <p role="alert" className="flex-1 text-sm text-danger-text">
                  {message}
                </p>
                <Button size="sm" onClick={() => onRetry(item.key)}>
                  {t('files.retry')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onCancel(item.key)}>
                  {t('files.dismiss')}
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function StatusText({
  item,
  formatNumber,
}: {
  item: UploadItem;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}) {
  const { t } = useI18n();
  switch (item.status) {
    case 'queued':
      return <Badge>{t('files.status.queued')}</Badge>;
    case 'uploading':
      return (
        <Badge tone="primary">
          {t('files.status.uploading', {
            percent: formatNumber(item.progress, { style: 'percent' }),
          })}
        </Badge>
      );
    case 'finishing':
      return <Badge tone="primary">{t('files.status.finishing')}</Badge>;
    case 'scanning':
      return <ScanBadge status="pending" />;
    case 'ready':
      return <ScanBadge status="clean" />;
    case 'infected':
      return <ScanBadge status="infected" />;
    case 'failed':
      return (
        <Badge tone="danger" icon={CircleAlert}>
          {t('files.status.failed')}
        </Badge>
      );
  }
}
