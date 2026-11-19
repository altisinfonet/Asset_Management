'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApi, type UiError } from '@/lib/api';
import type { Attachment, AttachmentEntity, AttachmentKind } from '@/lib/registry/types';
import { attachmentsApi, putToStorage, sha256Hex, UploadError } from './api';

/**
 * One file on its way to storage. `scanning` is the time between the upload being confirmed and
 * the virus scan finishing (`scan_status=pending`); `ready` is a clean file; `infected` and
 * `failed` are terminal until the user retries or dismisses.
 */
export type UploadStatus =
  'queued' | 'uploading' | 'finishing' | 'scanning' | 'ready' | 'infected' | 'failed';

export interface UploadItem {
  key: string;
  file: File;
  status: UploadStatus;
  /** 0..1 while uploading. */
  progress: number;
  attachment?: Attachment;
  /** The API's problem (type or size refused, permission ...), shown with the server's message. */
  error?: UiError;
  /** A non-API failure: the storage PUT failed (`status` 0 = network). */
  uploadFailure?: { status: number };
}

export interface UseUploadsOptions {
  entityType: AttachmentEntity;
  entityId: string;
  kind: AttachmentKind;
  /** Called with the attachment whenever one reaches `ready` (clean). */
  onReady?: (attachment: Attachment) => void;
  /** Called whenever the set of server-side attachments changed (upload confirmed, scan finished). */
  onServerChange?: () => void;
  /** Called when a ready attachment's item is removed by the user. */
  onRemoved?: (attachment: Attachment) => void;
  /** Poll `GET /v1/attachments/{id}` until the scan answers (default). Off when a list polls already. */
  pollScan?: boolean;
}

const MAX_PARALLEL = 3;
const POLL_MS = 1500;
const POLL_TRIES = 60;

let counter = 0;

/** Upload queue: create -> PUT (with progress) -> complete -> poll until the scan has an answer. */
export function useUploads(options: UseUploadsOptions) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const optionsRef = useRef(options);
  const itemsRef = useRef(items);
  useEffect(() => {
    optionsRef.current = options;
    itemsRef.current = items;
  });
  const controllers = useRef(new Map<string, AbortController>());
  const running = useRef(0);
  const queue = useRef<string[]>([]);
  const filesByKey = useRef(new Map<string, File>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const live = controllers.current;
    return () => {
      alive.current = false;
      for (const controller of live.values()) controller.abort();
    };
  }, []);

  const patch = useCallback((key: string, change: Partial<UploadItem>) => {
    if (!alive.current) return;
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );
  }, []);

  const pumpRef = useRef<() => void>(() => {});

  const finish = useCallback(
    (key: string, attachment: Attachment) => {
      if (attachment.scan_status === 'clean') {
        patch(key, { status: 'ready', attachment, progress: 1 });
        optionsRef.current.onReady?.(attachment);
      } else if (attachment.scan_status === 'infected' || attachment.scan_status === 'error') {
        patch(key, { status: 'infected', attachment });
      }
      optionsRef.current.onServerChange?.();
    },
    [patch],
  );

  const run = useCallback(
    async (key: string) => {
      const file = filesByKey.current.get(key);
      if (!file) return;
      const controller = new AbortController();
      controllers.current.set(key, controller);
      const { entityType, entityId, kind } = optionsRef.current;
      patch(key, { status: 'uploading', progress: 0, error: undefined, uploadFailure: undefined });
      try {
        const sha256 = await sha256Hex(file);
        const created = await attachmentsApi.create({
          entity_type: entityType,
          entity_id: entityId,
          kind,
          filename: file.name,
          content_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
          ...(sha256 ? { sha256 } : {}),
        });
        patch(key, { attachment: created.attachment });
        await putToStorage(created.upload, file, {
          signal: controller.signal,
          onProgress: (fraction) => patch(key, { progress: fraction }),
        });
        patch(key, { status: 'finishing', progress: 1 });
        const completed = await attachmentsApi.complete(created.attachment.id);
        optionsRef.current.onServerChange?.();
        if (completed.scan_status === 'pending') {
          patch(key, { status: 'scanning', attachment: completed });
          if (optionsRef.current.pollScan === false) return;
          for (let attempt = 0; attempt < POLL_TRIES; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
            if (!alive.current || controller.signal.aborted) return;
            const latest = await attachmentsApi.get(completed.id);
            if (latest.scan_status !== 'pending') {
              finish(key, latest);
              return;
            }
          }
        } else {
          finish(key, completed);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof UploadError) {
          patch(key, { status: 'failed', uploadFailure: { status: err.status } });
        } else {
          patch(key, { status: 'failed', error: getApi().toUiError(err) });
        }
      } finally {
        controllers.current.delete(key);
        running.current -= 1;
        pumpRef.current();
      }
    },
    [patch, finish],
  );

  useEffect(() => {
    pumpRef.current = () => {
      while (running.current < MAX_PARALLEL && queue.current.length > 0) {
        const next = queue.current.shift()!;
        running.current += 1;
        void run(next);
      }
    };
  }, [run]);

  const add = useCallback((files: Iterable<File>) => {
    const fresh: UploadItem[] = [];
    for (const file of files) {
      counter += 1;
      const key = `upload-${counter}`;
      filesByKey.current.set(key, file);
      fresh.push({ key, file, status: 'queued', progress: 0 });
      queue.current.push(key);
    }
    if (fresh.length === 0) return;
    setItems((current) => [...current, ...fresh]);
    pumpRef.current();
  }, []);

  const retry = useCallback(
    (key: string) => {
      patch(key, { status: 'queued', progress: 0, error: undefined, uploadFailure: undefined });
      queue.current.push(key);
      pumpRef.current();
    },
    [patch],
  );

  /** Cancel a transfer in flight, or dismiss a finished / failed item. */
  const remove = useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    queue.current = queue.current.filter((queued) => queued !== key);
    filesByKey.current.delete(key);
    const gone = itemsRef.current.find((item) => item.key === key);
    if (gone?.status === 'ready' && gone.attachment)
      optionsRef.current.onRemoved?.(gone.attachment);
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  return { items, add, retry, remove };
}
