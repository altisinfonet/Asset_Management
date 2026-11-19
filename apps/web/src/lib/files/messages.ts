import type { Translator } from '@/i18n';
import type { UiError } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import type { Attachment } from '@/lib/registry/types';

type T = Translator['t'];

/** "25 MB", "512 KB" in the decimal units the upload hints and the file list use. */
export function megabytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    const mb = bytes / 1_000_000;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/**
 * The words for a refused upload, by the machine `code` of the problem's first field error
 * (`POST /v1/attachments` and `.../complete`). A type or extension refusal keeps the server's own
 * sentence, which names the allowed types; an unknown code falls back to the problem's text.
 */
export function uploadErrorText(t: T, error: UiError, limit?: number): string {
  const field = error.fieldErrors[0];
  const code = field?.code ?? error.code;
  switch (code) {
    case 'too-large':
    case 'payload-too-large':
      return limit
        ? t('files.errors.tooLarge', { limit: megabytes(limit) })
        : t('files.errors.tooLargeNoLimit');
    case 'empty':
      return t('files.errors.empty');
    case 'photo-not-image':
      return t('files.errors.photoNotImage');
    case 'size-mismatch':
      return t('files.errors.sizeMismatch');
    case 'content-mismatch':
      return field
        ? t('files.errors.contentMismatch', { reason: field.message })
        : t('files.errors.contentMismatchBare');
    case 'not-supported':
    case 'not-found':
      return field?.message ?? uiErrorText(t, error);
    case 'upload-missing':
      return t('files.errors.uploadMissing');
    default:
      return field?.message ?? uiErrorText(t, error);
  }
}

/** Why a scan did not come out clean: the signature of an infected file, or the reason a scan failed. */
export function scanProblemText(t: T, attachment: Pick<Attachment, 'scan_status' | 'scan_detail'>) {
  const detail = attachment.scan_detail ?? '';
  if (attachment.scan_status === 'infected') {
    return detail ? t('files.scanInfectedNamed', { name: detail }) : t('files.scanInfected');
  }
  if (attachment.scan_status === 'error') {
    return detail ? t('files.scanErrorNamed', { reason: detail }) : t('files.scanError');
  }
  return '';
}
