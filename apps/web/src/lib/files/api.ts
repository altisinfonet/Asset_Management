import type { operations } from '@assettracker/api-client';
import { getApi } from '@/lib/api';
import type {
  Attachment,
  AttachmentCreate,
  AttachmentEntity,
  AttachmentKind,
  AttachmentUpload,
  FilesSettings,
  Page,
} from '@/lib/registry/types';

/**
 * Attachments (M2-FILE-04) over the contract's `/v1/attachments` operations:
 *
 *   1. `POST /v1/attachments`            -> metadata row (`scan_status=pending`) + presigned PUT
 *   2. `PUT <upload.url>`                -> the bytes go straight to storage (never through the API)
 *   3. `POST /v1/attachments/{id}/complete` -> the API verifies the object and queues the scan
 *   4. `GET  /v1/attachments/{id}`       -> `download_url` once `scan_status=clean`
 */
const http = () => getApi().http;

type Query = operations['listAttachments']['parameters']['query'];

export const attachmentsApi = {
  async list(
    entityType: AttachmentEntity,
    entityId: string,
    query: { kind?: AttachmentKind; cursor?: string; limit?: number } = {},
  ): Promise<Page<Attachment>> {
    const params: Query = { entity_type: entityType, entity_id: entityId, ...query };
    const { data } = await http().GET('/v1/attachments', { params: { query: params } });
    return data as Page<Attachment>;
  },
  async create(body: AttachmentCreate): Promise<AttachmentUpload> {
    const { data } = await http().POST('/v1/attachments', { body });
    return data as AttachmentUpload;
  },
  async complete(id: string): Promise<Attachment> {
    const { data } = await http().POST('/v1/attachments/{id}/complete', {
      params: { path: { id } },
    });
    return data as Attachment;
  },
  /** One attachment; `download_url` is present only when the scan finished clean. */
  async get(id: string): Promise<Attachment> {
    const { data } = await http().GET('/v1/attachments/{id}', { params: { path: { id } } });
    return data as Attachment;
  },
  async archive(id: string): Promise<void> {
    await http().DELETE('/v1/attachments/{id}', { params: { path: { id } } });
  },
};

/** `GET /v1/settings/files`: the upload cap that applies to the organisation (`catalog:read`). */
export const filesSettingsApi = {
  async get(): Promise<FilesSettings> {
    const { data } = await http().GET('/v1/settings/files');
    return data as FilesSettings;
  },
};

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * PUT the file to the presigned URL. `XMLHttpRequest` is used because `fetch` cannot report upload
 * progress. The headers the API listed must accompany the request; no cookies or CSRF token are
 * sent (the URL carries its own authorisation). Resolves on 2xx; `signal` cancels the transfer.
 */
export function putToStorage(
  upload: AttachmentUpload['upload'],
  file: Blob,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    for (const [name, value] of Object.entries(upload.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(1);
        resolve();
      } else {
        reject(new UploadError(`storage answered ${xhr.status}`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new UploadError('network error', 0));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException('Upload cancelled', 'AbortError'));
        return;
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

/** Hex SHA-256 of the file (the optional integrity check of `createAttachment`), or undefined. */
export async function sha256Hex(file: Blob): Promise<string | undefined> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || file.size > 50 * 1024 * 1024 || typeof file.arrayBuffer !== 'function') {
      return undefined;
    }
    const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

export function isImage(attachment: Pick<Attachment, 'content_type'>): boolean {
  return attachment.content_type.startsWith('image/');
}
