import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Transform, type Readable } from 'node:stream';
import sharp, { type Metadata } from 'sharp';
import { diffRecords } from '../audit/index.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import type { TenantJobContext } from '../jobs/index.js';
import {
  AUDIT_WRITER,
  JOB_QUEUE,
  OUTBOX_PUBLISHER,
  STORAGE_ADAPTER,
  VIRUS_SCANNER,
  StorageNotFoundError,
  type AuditWriter,
  type JobQueue,
  type OutboxPublisher,
  type ScanVerdict,
  type StorageAdapter,
  type VirusScanner,
} from '../ports/index.js';
import { variantKey } from '../storage/index.js';
import type { Tx } from '../tenancy/index.js';
import { type AttachmentRow, SCAN_JOB, SWEEP_JOB, THUMBNAIL_JOB } from './attachments.service.js';
import { isThumbnailable, normalizeMime } from './content.js';
import { parseFilesSettings } from './settings.js';

/** Thumbnails fit in a 320 px box. */
export const THUMBNAIL_SIZE = 320;
/** Originals above this size get no thumbnail (they are decoded in memory). */
export const THUMBNAIL_MAX_INPUT_BYTES = 40 * 1024 * 1024;
/** Refuse to decode an image with more pixels than this (decompression bombs). */
export const MAX_IMAGE_PIXELS = 80_000_000;
/** An upload whose "complete" call never arrived is abandoned after this long. */
export const ABANDON_AFTER_HOURS = 24;
/** A completed upload whose scan did not finish within this long is re-queued. */
export const RESCAN_AFTER_MINUTES = 10;
const SWEEP_BATCH = 200;

/** Short code safe for an ids-only outbox payload. */
const signatureCode = (signature: string): string =>
  signature.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64) || 'unknown';

/** Counts and hashes the bytes passing through, and fails past `max` (a server-side cap on the stream itself). */
function meter(max: number) {
  const hash = createHash('sha256');
  let bytes = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > max) return cb(new Error(`object is larger than the allowed ${max} bytes`));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  return { stream, result: () => ({ bytes, sha256: hash.digest('hex') }) };
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * The background half of the file pipeline (M2-FILE-02/03), registered as the handlers of
 * `attachment.scan`, `attachment.thumbnail` and `attachment.sweep` (src/jobs/catalogue.ts). Every
 * handler runs INSIDE the worker's tenant transaction (`ctx.tx`), so its audit row, outbox event and
 * follow-up job commit together with the status change, and a failure rolls all of it back and retries.
 */
@Injectable()
export class AttachmentPipeline {
  private readonly log = new Logger('AttachmentPipeline');

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(VIRUS_SCANNER) private readonly scanner: VirusScanner,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) private readonly outbox: OutboxPublisher,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async reload(tx: Tx, id: string): Promise<AttachmentRow> {
    return (await tx.attachment.findFirstOrThrow({ where: { id } })) as AttachmentRow;
  }

  private async record(
    tx: Tx,
    verb: string,
    row: AttachmentRow,
    before: Record<string, unknown> | null,
    meta: Record<string, unknown> = {},
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    const view = (r: AttachmentRow) => ({ scan_status: r.scan_status, scan_detail: r.scan_detail });
    const diff = diffRecords(before, view(row));
    await this.audit.write(tx, {
      action: `attachment.${verb}`,
      entityType: 'attachment',
      entityId: row.id,
      before: diff.before,
      after: diff.after,
      meta: { filename: row.filename, entity_type: row.entity_type, ...meta },
    });
    await this.outbox.publish(tx, {
      type: `attachment.${verb}`,
      aggregateType: 'attachment',
      aggregateId: row.id,
      payload: {
        version: row.version,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        ...(row.created_by ? { uploaded_by: row.created_by } : {}),
        ...payload,
      },
    });
  }

  // ------------------------------------------------------------------------------- scan

  /** `attachment.scan` { tenantId, attachmentId }: stream the object to the scanner, decide its fate. */
  async scan(
    payload: { tenantId: string; attachmentId?: unknown },
    ctx: TenantJobContext,
  ): Promise<void> {
    const id = String(payload.attachmentId ?? '');
    const { tx } = ctx;
    const row = (await tx.attachment.findFirst({ where: { id } })) as AttachmentRow | null;
    if (!row || row.archived_at || !row.uploaded_at || row.scan_status !== 'pending') {
      ctx.logger.info({ attachment_id: id }, 'scan skipped: not a pending, uploaded attachment');
      return;
    }
    const before = { scan_status: row.scan_status, scan_detail: row.scan_detail };

    if (!this.scanner.enabled) {
      if (this.config.SCAN_REQUIRED) {
        // Stays `pending` (visible in the API); retried until a scanner exists, then dead-lettered.
        throw new Error('virus scanning is required (SCAN_REQUIRED) but no scanner is configured');
      }
      await this.markClean(tx, row, before, 'scan-disabled', 'scan_skipped');
      ctx.logger.warn({ attachment_id: id }, 'virus scanning is disabled: marked clean unscanned');
      return;
    }

    const info = await this.storage.head(row.storage_key);
    if (!info) return this.fail(tx, row, before, 'object-missing');
    if (row.etag && info.etag && row.etag !== info.etag) {
      return this.fail(tx, row, before, 'object-changed', true);
    }
    const expectedSize = Number(row.size_bytes);
    if (info.sizeBytes !== expectedSize) {
      return this.fail(tx, row, before, 'size-mismatch', true);
    }

    const source = await this.storage.read(row.storage_key);
    // The cap was enforced when the upload was created and confirmed; here the stream may not exceed
    // what was confirmed (a tenant lowering its cap later must not wedge an in-flight scan).
    const metered = meter(expectedSize);
    source.on('error', (err) => metered.stream.destroy(err));
    let verdict: ScanVerdict;
    try {
      verdict = await this.scanner.scan(source.pipe(metered.stream));
    } finally {
      source.destroy();
    }
    const seen = metered.result();
    if (seen.bytes !== expectedSize) return this.fail(tx, row, before, 'size-mismatch', true);
    if (row.sha256 && row.sha256 !== seen.sha256) {
      return this.fail(tx, row, before, 'checksum-mismatch', true);
    }

    if (verdict.status === 'infected') {
      await this.markInfected(tx, row, before, verdict.signature, seen.sha256);
      return;
    }
    await this.markClean(tx, row, before, null, 'scanned', seen.sha256);
  }

  private async markClean(
    tx: Tx,
    row: AttachmentRow,
    before: Record<string, unknown>,
    detail: string | null,
    verb: 'scanned' | 'scan_skipped',
    sha256?: string,
  ): Promise<void> {
    const updated = await tx.attachment.updateMany({
      where: { id: row.id, scan_status: 'pending' },
      data: {
        scan_status: 'clean',
        scan_detail: detail,
        scanned_at: new Date(),
        ...(sha256 ? { sha256 } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return;
    const fresh = await this.reload(tx, row.id);
    await this.record(tx, verb, fresh, before, detail ? { scan: detail } : {});
    if (isThumbnailable(row.content_type)) {
      await this.jobs.enqueue(
        THUMBNAIL_JOB,
        { tenantId: row.tenant_id, attachmentId: row.id },
        { tx, singletonKey: `thumb:${row.id}` },
      );
    }
  }

  private async markInfected(
    tx: Tx,
    row: AttachmentRow,
    before: Record<string, unknown>,
    signature: string,
    sha256: string,
  ): Promise<void> {
    const updated = await tx.attachment.updateMany({
      where: { id: row.id, scan_status: 'pending' },
      data: {
        scan_status: 'infected',
        scan_detail: signature.slice(0, 200),
        scanned_at: new Date(),
        sha256,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return;
    const fresh = await this.reload(tx, row.id);
    // The audit row and the outbox event notify the uploader (`uploaded_by`); the notification
    // module (wave 2) subscribes to `attachment.infected`.
    await this.record(
      tx,
      'infected',
      fresh,
      before,
      // not named `signature`: the audit redactor hides keys that look like secrets
      { detection: signature },
      { detection: signatureCode(signature) },
    );
    // Last, so a failure here rolls the status back and the retry scans again.
    await this.storage.delete(row.storage_key);
    if (row.thumb_key) await this.storage.delete(row.thumb_key);
  }

  /** The object is unusable: the attachment becomes `error` (and archived), the object is deleted when it exists. */
  private async fail(
    tx: Tx,
    row: AttachmentRow,
    before: Record<string, unknown>,
    reason: string,
    deleteObject = false,
  ): Promise<void> {
    const updated = await tx.attachment.updateMany({
      where: { id: row.id, scan_status: 'pending' },
      data: {
        scan_status: 'error',
        scan_detail: reason,
        scanned_at: new Date(),
        archived_at: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return;
    const fresh = await this.reload(tx, row.id);
    await this.record(tx, 'rejected', fresh, before, { reason });
    if (deleteObject) await this.storage.delete(row.storage_key);
  }

  // ------------------------------------------------------------------------------- thumbnails

  /** `attachment.thumbnail`: re-encode a clean image into a WebP thumbnail without any metadata. */
  async thumbnail(
    payload: { tenantId: string; attachmentId?: unknown },
    ctx: TenantJobContext,
  ): Promise<void> {
    const id = String(payload.attachmentId ?? '');
    const { tx } = ctx;
    const row = (await tx.attachment.findFirst({ where: { id } })) as AttachmentRow | null;
    if (
      !row ||
      row.archived_at ||
      row.scan_status !== 'clean' ||
      row.thumb_key ||
      !isThumbnailable(row.content_type)
    ) {
      ctx.logger.info({ attachment_id: id }, 'thumbnail skipped');
      return;
    }
    if (Number(row.size_bytes) > THUMBNAIL_MAX_INPUT_BYTES) {
      ctx.logger.info({ attachment_id: id }, 'thumbnail skipped: original is too large to decode');
      return;
    }
    let original: Buffer;
    try {
      original = await readAll(await this.storage.read(row.storage_key));
    } catch (err) {
      if (err instanceof StorageNotFoundError) return;
      throw err;
    }

    const input = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' as const };
    let meta: Metadata;
    let thumb: Buffer;
    try {
      meta = await sharp(original, input).metadata();
      // `rotate()` applies the EXIF orientation; encoding without `withMetadata` drops ALL
      // metadata (EXIF, GPS, ICC, XMP), and re-encoding neutralises anything hidden in the file.
      thumb = await sharp(original, input)
        .rotate()
        .resize({
          width: THUMBNAIL_SIZE,
          height: THUMBNAIL_SIZE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();
    } catch (err) {
      // A corrupt or hostile image gets no thumbnail; the file itself stays downloadable.
      ctx.logger.warn({ attachment_id: id, err: (err as Error).message }, 'thumbnail failed');
      return;
    }
    const swapped = (meta.orientation ?? 1) >= 5;
    const width = (swapped ? meta.height : meta.width) ?? null;
    const height = (swapped ? meta.width : meta.height) ?? null;

    const thumbKey = variantKey(row.storage_key, 'thumb');
    await this.storage.write(thumbKey, thumb, { contentType: 'image/webp' });

    const tenant = await tx.tenant.findFirst({ select: { settings: true } });
    const stripOriginal = parseFilesSettings(
      (tenant?.settings as Record<string, unknown> | null)?.files,
    ).strip_exif_original;
    let replaced: { size: number; sha256: string; etag: string | null } | null = null;
    if (stripOriginal && !row.exif_stripped && meta.exif) {
      const clean = await this.reencode(original, normalizeMime(row.content_type), input);
      if (clean) {
        const { etag } = await this.storage.write(row.storage_key, clean, {
          contentType: row.content_type,
        });
        replaced = {
          size: clean.length,
          sha256: createHash('sha256').update(clean).digest('hex'),
          etag,
        };
      }
    }

    await tx.attachment.updateMany({
      where: { id: row.id, thumb_key: null },
      data: {
        thumb_key: thumbKey,
        thumb_content_type: 'image/webp',
        width,
        height,
        ...(replaced
          ? {
              exif_stripped: true,
              size_bytes: BigInt(replaced.size),
              sha256: replaced.sha256,
              etag: replaced.etag,
            }
          : {}),
        version: { increment: 1 },
      },
    });
    ctx.logger.info(
      { attachment_id: id, width, height, exif_stripped: Boolean(replaced) },
      'thumbnail created',
    );
  }

  /** The same image, same format, without metadata. `null` for formats this does not re-encode (GIF). */
  private async reencode(
    original: Buffer,
    mime: string,
    input: { limitInputPixels: number; failOn: 'error' },
  ): Promise<Buffer | null> {
    const img = sharp(original, input).rotate();
    switch (mime) {
      case 'image/jpeg':
        return img.jpeg({ quality: 92 }).toBuffer();
      case 'image/png':
        return img.png().toBuffer();
      case 'image/webp':
        return img.webp({ quality: 92 }).toBuffer();
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------------------- sweep

  /**
   * `attachment.sweep` (scheduler, every few minutes per tenant): the safety net of the pipeline.
   *  - uploads whose "complete" call never arrived (older than {@link ABANDON_AFTER_HOURS}): the
   *    object is deleted if it exists and the row is archived (`scan_detail = upload-abandoned`);
   *  - completed uploads whose scan job was lost or died (pending longer than
   *    {@link RESCAN_AFTER_MINUTES}): the scan is queued again (a singleton key makes it idempotent).
   */
  async sweep(payload: { tenantId: string }, ctx: TenantJobContext): Promise<void> {
    const { tx } = ctx;
    const abandonedBefore = new Date(Date.now() - ABANDON_AFTER_HOURS * 3600_000);
    const abandoned = (await tx.attachment.findMany({
      where: { uploaded_at: null, archived_at: null, created_at: { lt: abandonedBefore } },
      orderBy: { created_at: 'asc' },
      take: SWEEP_BATCH,
    })) as AttachmentRow[];
    for (const row of abandoned) {
      await this.storage.delete(row.storage_key);
      const updated = await tx.attachment.updateMany({
        where: { id: row.id, uploaded_at: null, archived_at: null },
        data: {
          archived_at: new Date(),
          scan_status: 'error',
          scan_detail: 'upload-abandoned',
          version: { increment: 1 },
        },
      });
      if (updated.count > 0) {
        const fresh = await this.reload(tx, row.id);
        await this.record(
          tx,
          'abandoned',
          fresh,
          { scan_status: row.scan_status, scan_detail: row.scan_detail },
          { reason: 'upload-abandoned' },
        );
      }
    }

    const stuckBefore = new Date(Date.now() - RESCAN_AFTER_MINUTES * 60_000);
    const stuck = (await tx.attachment.findMany({
      where: { scan_status: 'pending', archived_at: null, uploaded_at: { lt: stuckBefore } },
      orderBy: { uploaded_at: 'asc' },
      take: SWEEP_BATCH,
    })) as AttachmentRow[];
    for (const row of stuck) {
      await this.jobs.enqueue(
        SCAN_JOB,
        { tenantId: payload.tenantId, attachmentId: row.id },
        { tx, singletonKey: `scan:${row.id}` },
      );
    }
    if (abandoned.length > 0 || stuck.length > 0) {
      ctx.logger.info(
        { abandoned: abandoned.length, rescanned: stuck.length, job: SWEEP_JOB },
        'attachment sweep',
      );
    }
  }
}
