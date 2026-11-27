import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { AuthContext } from '../auth/index.js';
import { diffRecords } from '../audit/index.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { ApiProblem, type Page, listPage, problem } from '../platform/index.js';
import {
  AUDIT_WRITER,
  JOB_QUEUE,
  OUTBOX_PUBLISHER,
  STORAGE_ADAPTER,
  type AuditWriter,
  type JobQueue,
  type OutboxPublisher,
  type StorageAdapter,
} from '../ports/index.js';
import { newObjectKey } from '../storage/index.js';
import { type Tx, TenancyService } from '../tenancy/index.js';
import {
  SNIFF_BYTES,
  checkDeclaredType,
  dispositionFor,
  findAllowedType,
  isImageMime,
  sniffContent,
} from './content.js';
import { lookupOwner, ownerInScope } from './owners.js';
import { type AttachmentCreate, type AttachmentListQuery, type OwnerType } from './schemas.js';
import { effectiveMaxBytes, parseFilesSettings } from './settings.js';

/** Queue names (src/jobs/catalogue.ts). */
export const SCAN_JOB = 'attachment.scan';
export const THUMBNAIL_JOB = 'attachment.thumbnail';
export const SWEEP_JOB = 'attachment.sweep';

export interface AttachmentRow {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  kind: string;
  storage_key: string;
  filename: string;
  content_type: string;
  size_bytes: bigint;
  sha256: string | null;
  scan_status: string;
  uploaded_at: Date | null;
  created_at: Date;
  created_by: string | null;
  archived_at: Date | null;
  version: number;
  etag: string | null;
  scanned_at: Date | null;
  scan_detail: string | null;
  thumb_key: string | null;
  thumb_content_type: string | null;
  width: number | null;
  height: number | null;
  exif_stripped: boolean;
}

/** `Attachment` of the contract. */
export interface AttachmentDto {
  id: string;
  entity_type: string;
  entity_id: string;
  kind: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string | null;
  scan_status: string;
  scan_detail: string | null;
  uploaded_at: string | null;
  created_at: string;
  width: number | null;
  height: number | null;
  download_url: string | null;
  thumbnail_url: string | null;
}

export interface UploadInstructions {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expires_at: string;
}

const toDto = (
  row: AttachmentRow,
  urls: { download?: string | null; thumbnail?: string | null } = {},
): AttachmentDto => ({
  id: row.id,
  entity_type: row.entity_type,
  entity_id: row.entity_id,
  kind: row.kind,
  filename: row.filename,
  content_type: row.content_type,
  size_bytes: Number(row.size_bytes),
  sha256: row.sha256,
  scan_status: row.scan_status,
  scan_detail: row.scan_detail,
  uploaded_at: row.uploaded_at?.toISOString() ?? null,
  created_at: row.created_at.toISOString(),
  width: row.width,
  height: row.height,
  download_url: urls.download ?? null,
  thumbnail_url: urls.thumbnail ?? null,
});

/** Fields recorded in the audit trail. */
const auditView = (row: AttachmentRow): Record<string, unknown> => ({
  entity_type: row.entity_type,
  entity_id: row.entity_id,
  kind: row.kind,
  filename: row.filename,
  content_type: row.content_type,
  size_bytes: Number(row.size_bytes),
  scan_status: row.scan_status,
});

const ATTACHMENT_LIST_SPEC = {
  sortable: { id: { kind: 'string' as const }, created_at: { kind: 'date' as const } },
  defaultSort: '-id',
};

/** Outcome of a confirm that has to answer with an error AFTER the rejection was committed. */
type CompleteOutcome =
  { kind: 'ok'; row: AttachmentRow } | { kind: 'rejected'; problem: ApiProblem };

/**
 * Attachments (M2-FILE-01, M2-SEC-02): metadata in `app.attachment`, bytes in object storage.
 *
 *   POST /attachments            insert the row (`pending`), presign a PUT (type + exact size signed)
 *   (client PUTs to the store)
 *   POST /attachments/{id}/complete   HEAD the object (exists, exact size, <= cap), sniff its first
 *                                     bytes against the declared type, enqueue `attachment.scan`
 *   attachment.scan job          ClamAV INSTREAM -> `clean` (+ thumbnail job) | `infected` (object deleted)
 *   GET /attachments/{id}        a short-lived presigned GET, ONLY for a clean, unchanged object
 *
 * Every write is audited and published to the outbox in the same tenant transaction. Other modules
 * use this class as the facade: {@link linkToOwner} re-points uploaded attachments at the record that
 * was created afterwards (a check-in's photos, a repair's invoice).
 */
@Injectable()
export class AttachmentsService {
  private readonly log = new Logger('Attachments');

  constructor(
    private readonly tenancy: TenancyService,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) private readonly outbox: OutboxPublisher,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private tx<T>(auth: AuthContext, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.tenancy.withTenantTx({ tenantId: auth.tenantId, actorId: auth.principalId }, fn);
  }

  private async record(
    trx: Tx,
    verb: string,
    row: AttachmentRow,
    extra: { before?: Record<string, unknown> | null; meta?: Record<string, unknown> } = {},
  ): Promise<void> {
    const diff = diffRecords(extra.before ?? null, auditView(row));
    await this.audit.write(trx, {
      action: `attachment.${verb}`,
      entityType: 'attachment',
      entityId: row.id,
      before: diff.before,
      after: diff.after,
      ...(extra.meta ? { meta: extra.meta } : {}),
    });
    await this.outbox.publish(trx, {
      type: `attachment.${verb}`,
      aggregateType: 'attachment',
      aggregateId: row.id,
      payload: {
        version: row.version,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        ...(row.created_by ? { uploaded_by: row.created_by } : {}),
      },
    });
  }

  /** The upload cap that applies to the caller's tenant. */
  private async capFor(trx: Tx): Promise<number> {
    const tenant = await trx.tenant.findFirst({ select: { plan: true, settings: true } });
    const files = (tenant?.settings as Record<string, unknown> | null)?.files;
    return effectiveMaxBytes(
      tenant?.plan ?? 'free',
      parseFilesSettings(files),
      this.config.FILES_MAX_BYTES_CEILING,
    );
  }

  // ---------------------------------------------------------------------------- create

  async create(
    auth: AuthContext,
    body: AttachmentCreate,
  ): Promise<{ attachment: AttachmentDto; upload: UploadInstructions }> {
    const declared = checkDeclaredType(body.content_type, body.filename, {
      importFile: body.kind === 'import_file',
    });
    if (!declared.ok) {
      throw new ApiProblem({
        code: 'unsupported-media-type',
        detail: declared.reason,
        errors: [{ pointer: '/content_type', message: declared.reason, code: 'type-not-allowed' }],
      });
    }
    const type = declared.type;
    if (body.size_bytes < 1) {
      throw problem.validation([
        { pointer: '/size_bytes', message: 'The file is empty.', code: 'empty' },
      ]);
    }
    if (body.kind === 'photo' && !isImageMime(type.mime)) {
      throw problem.validation([
        { pointer: '/kind', message: 'A photo must be an image file.', code: 'photo-not-image' },
      ]);
    }

    const created = await this.tx(auth, async (trx) => {
      const cap = await this.capFor(trx);
      if (body.size_bytes > cap) {
        throw new ApiProblem({
          code: 'payload-too-large',
          detail: `The file is ${body.size_bytes} bytes; the limit for this organisation is ${cap} bytes.`,
          errors: [
            { pointer: '/size_bytes', message: `Must be at most ${cap}.`, code: 'too-large' },
          ],
        });
      }
      const owner = await lookupOwner(trx, body.entity_type, body.entity_id);
      if (owner === 'unavailable') {
        throw problem.validation([
          {
            pointer: '/entity_type',
            message: `Attachments on "${body.entity_type}" are not available yet.`,
            code: 'not-supported',
          },
        ]);
      }
      if (owner === 'missing') {
        throw problem.validation([
          { pointer: '/entity_id', message: `No such ${body.entity_type}.`, code: 'not-found' },
        ]);
      }

      const id = uuidv7();
      const key = newObjectKey(auth.tenantId, { objectId: id });
      const row = (await trx.attachment.create({
        data: {
          id,
          tenant_id: auth.tenantId,
          entity_type: body.entity_type,
          entity_id: body.entity_id,
          kind: body.kind,
          storage_key: key,
          filename: body.filename,
          content_type: type.mime,
          size_bytes: BigInt(body.size_bytes),
          sha256: body.sha256 ?? null,
          created_by: auth.userId,
        },
      })) as AttachmentRow;
      await this.record(trx, 'created', row);
      return row;
    });

    const upload = await this.storage.presignUpload({
      key: created.storage_key,
      contentType: created.content_type,
      sizeBytes: Number(created.size_bytes),
      ttlSeconds: this.config.FILES_UPLOAD_URL_TTL_SECONDS,
    });
    return {
      attachment: toDto(created),
      upload: {
        method: upload.method,
        url: upload.url,
        headers: upload.headers,
        expires_at: upload.expiresAt.toISOString(),
      },
    };
  }

  // ---------------------------------------------------------------------------- complete

  /** The client says the PUT finished: verify the object, then queue the scan (idempotent). */
  async complete(auth: AuthContext, id: string): Promise<AttachmentDto> {
    const outcome = await this.tx(auth, async (trx): Promise<CompleteOutcome> => {
      const row = (await trx.attachment.findFirst({
        where: { id, archived_at: null },
      })) as AttachmentRow | null;
      if (!row || !(await ownerInScope(trx, row.entity_type, row.entity_id))) {
        throw problem.notFound('Attachment not found.');
      }
      if (row.uploaded_at) return { kind: 'ok', row };

      const info = await this.storage.head(row.storage_key);
      if (!info) {
        throw new ApiProblem({
          code: 'upload-missing',
          detail: 'No uploaded file was found. PUT the bytes to the upload URL first.',
        });
      }
      const declaredSize = Number(row.size_bytes);
      const cap = await this.capFor(trx);
      if (info.sizeBytes > cap || info.sizeBytes > declaredSize) {
        return this.reject(
          trx,
          row,
          'size-exceeded',
          new ApiProblem({
            code: 'payload-too-large',
            detail: `The uploaded object has ${info.sizeBytes} bytes; ${Math.min(cap, declaredSize)} were allowed.`,
          }),
        );
      }
      if (info.sizeBytes !== declaredSize) {
        return this.reject(
          trx,
          row,
          'size-mismatch',
          problem.validation([
            {
              pointer: '/size_bytes',
              message: `The upload has ${info.sizeBytes} bytes, not the declared ${declaredSize}.`,
              code: 'size-mismatch',
            },
          ]),
        );
      }

      const type = findAllowedType(row.content_type);
      const head = await readPrefix(
        this.storage,
        row.storage_key,
        Math.min(info.sizeBytes, SNIFF_BYTES),
      );
      const sniffed = type
        ? await sniffContent(head, type, { importFile: row.kind === 'import_file' })
        : null;
      if (!sniffed || !sniffed.ok) {
        const reason = sniffed && !sniffed.ok ? sniffed.reason : 'This file type is not accepted.';
        return this.reject(
          trx,
          row,
          'content-mismatch',
          new ApiProblem({
            code: 'unsupported-media-type',
            detail: reason,
            errors: [{ pointer: '/content_type', message: reason, code: 'content-mismatch' }],
          }),
        );
      }

      const updated = await trx.attachment.updateMany({
        where: { id: row.id, uploaded_at: null },
        data: { uploaded_at: new Date(), etag: info.etag, version: { increment: 1 } },
      });
      if (updated.count === 0) return { kind: 'ok', row: await this.reload(trx, row.id) };
      const fresh = await this.reload(trx, row.id);
      await this.record(trx, 'uploaded', fresh, { before: auditView(row) });
      await this.jobs.enqueue(
        SCAN_JOB,
        { tenantId: auth.tenantId, attachmentId: row.id },
        { tx: trx, singletonKey: `scan:${row.id}` },
      );
      return { kind: 'ok', row: fresh };
    });
    if (outcome.kind === 'rejected') throw outcome.problem;
    return toDto(outcome.row);
  }

  /** Marks an upload rejected (archived, `error`), deletes its object, audits; the caller throws afterwards. */
  private async reject(
    trx: Tx,
    row: AttachmentRow,
    reason: string,
    error: ApiProblem,
  ): Promise<CompleteOutcome> {
    await trx.attachment.updateMany({
      where: { id: row.id },
      data: {
        scan_status: 'error',
        scan_detail: reason,
        archived_at: new Date(),
        version: { increment: 1 },
      },
    });
    const fresh = await this.reload(trx, row.id);
    await this.record(trx, 'rejected', fresh, { before: auditView(row), meta: { reason } });
    await this.storage.delete(row.storage_key).catch((err: unknown) => {
      this.log.warn(`could not delete rejected object ${row.storage_key}: ${String(err)}`);
    });
    return { kind: 'rejected', problem: error };
  }

  private async reload(trx: Tx, id: string): Promise<AttachmentRow> {
    return (await trx.attachment.findFirstOrThrow({ where: { id } })) as AttachmentRow;
  }

  // ---------------------------------------------------------------------------- read

  async get(auth: AuthContext, id: string): Promise<AttachmentDto> {
    const row = await this.tx(auth, async (trx) => {
      const found = (await trx.attachment.findFirst({
        where: { id, archived_at: null },
      })) as AttachmentRow | null;
      if (!found || !(await ownerInScope(trx, found.entity_type, found.entity_id))) {
        throw problem.notFound('Attachment not found.');
      }
      return found;
    });
    return toDto(row, {
      download: await this.downloadUrl(row),
      thumbnail: await this.thumbnailUrl(row),
    });
  }

  async list(auth: AuthContext, query: AttachmentListQuery): Promise<Page<AttachmentDto>> {
    const page = await this.tx(auth, async (trx) =>
      // M2-LOC-03 (ED-26): the files of a record outside the caller's scope are not listed
      !(await ownerInScope(trx, query.entity_type, query.entity_id))
        ? { data: [], page: { next_cursor: null, has_more: false } }
        : listPage<Record<string, unknown>>({
            query,
            spec: ATTACHMENT_LIST_SPEC,
            filters: {
              entity_type: query.entity_type,
              entity_id: query.entity_id,
              kind: query.kind,
            },
            fetch: async ({ take, orderBy, where }) => {
              const and: object[] = [
                { archived_at: null, entity_type: query.entity_type, entity_id: query.entity_id },
                ...(query.kind ? [{ kind: query.kind }] : []),
                ...(where ? [where] : []),
              ];
              return (await trx.attachment.findMany({
                where: { AND: and },
                orderBy,
                take,
              })) as unknown as Record<string, unknown>[];
            },
            count: () =>
              trx.attachment.count({
                where: {
                  archived_at: null,
                  entity_type: query.entity_type,
                  entity_id: query.entity_id,
                  ...(query.kind ? { kind: query.kind } : {}),
                },
              }),
          }),
    );
    // Both URLs ride along with the list, so a screen never needs a request per item. The download
    // URL costs one storage HEAD per CLEAN item (the object must still be the scanned one); they run
    // in parallel and a page holds at most the list limit.
    const data = await Promise.all(
      page.data.map(async (raw) => {
        const row = raw as unknown as AttachmentRow;
        const [download, thumbnail] = await Promise.all([
          this.downloadUrl(row),
          this.thumbnailUrl(row),
        ]);
        return toDto(row, { download, thumbnail });
      }),
    );
    return { data, page: page.page };
  }

  /**
   * The presigned GET of the original, or `null`. Issued only for a CLEAN, uploaded, unarchived
   * attachment whose object still has the ETag recorded when the upload was confirmed (an object
   * overwritten through a still-valid upload URL after the scan is never served).
   */
  async downloadUrl(row: AttachmentRow): Promise<string | null> {
    if (row.scan_status !== 'clean' || !row.uploaded_at || row.archived_at) return null;
    const info = await this.storage.head(row.storage_key);
    if (!info) return null;
    if (row.etag && info.etag && info.etag !== row.etag) {
      this.log.warn(`attachment ${row.id}: object changed after the scan; not serving it`);
      return null;
    }
    const url = await this.storage.presignDownload({
      key: row.storage_key,
      filename: row.filename,
      contentType: row.content_type,
      disposition: dispositionFor(row.content_type),
      ttlSeconds: this.config.FILES_DOWNLOAD_URL_TTL_SECONDS,
    });
    return url.url;
  }

  async thumbnailUrl(row: AttachmentRow): Promise<string | null> {
    if (row.scan_status !== 'clean' || row.archived_at || !row.thumb_key) return null;
    const url = await this.storage.presignDownload({
      key: row.thumb_key,
      filename: `${row.filename.replace(/\.[^.]*$/, '')}-thumb.webp`,
      contentType: row.thumb_content_type ?? 'image/webp',
      disposition: 'inline',
      ttlSeconds: this.config.FILES_DOWNLOAD_URL_TTL_SECONDS,
    });
    return url.url;
  }

  // ---------------------------------------------------------------------------- archive

  async archive(auth: AuthContext, id: string): Promise<void> {
    await this.tx(auth, async (trx) => {
      const row = (await trx.attachment.findFirst({
        where: { id, archived_at: null },
      })) as AttachmentRow | null;
      if (!row || !(await ownerInScope(trx, row.entity_type, row.entity_id))) {
        throw problem.notFound('Attachment not found.');
      }
      const usage = {
        assets: await trx.asset.count({ where: { image_attachment_id: id } }),
        models: await trx.asset_model.count({ where: { image_attachment_id: id } }),
      };
      if (usage.assets + usage.models > 0) {
        throw new ApiProblem({
          code: 'conflict',
          detail: `The attachment is the picture of ${usage.assets} asset(s) and ${usage.models} model(s); clear it there first.`,
          extensions: { usage },
        });
      }
      await trx.attachment.updateMany({
        where: { id, archived_at: null },
        data: { archived_at: new Date(), version: { increment: 1 } },
      });
      await this.record(
        trx,
        'archived',
        { ...row, archived_at: new Date() },
        {
          before: auditView(row),
        },
      );
    });
  }

  // ---------------------------------------------------------------------------- facade for other modules

  /**
   * Re-points uploaded attachments at the record they now belong to (M2-LIFE-03: the photos of a
   * check-in are uploaded against the asset, then linked to the assignment the check-in closes).
   * Runs in the CALLER's transaction. Every id must be a live attachment of this tenant that is not
   * infected, rejected or already linked elsewhere than `from`; anything else throws a 422 naming it.
   */
  async linkToOwner(
    trx: Tx,
    ids: readonly string[],
    owner: { type: OwnerType; id: string },
    opts: { allowFrom?: readonly { type: OwnerType; id: string }[]; pointer?: string } = {},
  ): Promise<void> {
    if (ids.length === 0) return;
    const pointer = opts.pointer ?? '/attachment_ids';
    const unique = [...new Set(ids)];
    const rows = (await trx.attachment.findMany({
      where: { id: { in: unique }, archived_at: null },
    })) as AttachmentRow[];
    const errors = unique
      .filter((id) => !rows.some((r) => r.id === id))
      .map((id) => ({
        pointer: `${pointer}/${ids.indexOf(id)}`,
        message: 'No such attachment.',
        code: 'not-found',
      }));
    for (const row of rows) {
      const at = `${pointer}/${ids.indexOf(row.id)}`;
      if (row.scan_status === 'infected' || row.scan_status === 'error') {
        errors.push({ pointer: at, message: 'This file was rejected.', code: 'rejected' });
      } else if (
        opts.allowFrom &&
        !opts.allowFrom.some((o) => o.type === row.entity_type && o.id === row.entity_id) &&
        !(row.entity_type === owner.type && row.entity_id === owner.id)
      ) {
        errors.push({
          pointer: at,
          message: 'This attachment belongs to another record.',
          code: 'wrong-owner',
        });
      }
    }
    if (errors.length > 0) throw problem.validation(errors);

    for (const row of rows) {
      if (row.entity_type === owner.type && row.entity_id === owner.id) continue;
      await trx.attachment.updateMany({
        where: { id: row.id },
        data: {
          entity_type: owner.type,
          entity_id: owner.id,
          version: { increment: 1 },
        },
      });
      const fresh = await this.reload(trx, row.id);
      await this.record(trx, 'linked', fresh, { before: auditView(row) });
    }
  }

  /** Is `id` a live image attachment of the tenant? Used by the registry for primary pictures. */
  async assertUsableImage(
    trx: Tx,
    id: string,
    owner: { type: OwnerType; id: string },
    pointer: string,
  ): Promise<void> {
    const row = (await trx.attachment.findFirst({
      where: { id, archived_at: null },
    })) as AttachmentRow | null;
    const fail = (message: string, code: string) =>
      problem.validation([{ pointer, message, code }]);
    if (!row) throw fail('No such attachment.', 'not-found');
    if (!isImageMime(row.content_type)) throw fail('The attachment is not an image.', 'not-image');
    if (row.entity_type !== owner.type || row.entity_id !== owner.id) {
      throw fail('The attachment belongs to another record.', 'wrong-owner');
    }
    if (row.scan_status === 'infected' || row.scan_status === 'error') {
      throw fail('The attachment was rejected.', 'rejected');
    }
  }
}

/** First `length` bytes of an object. */
async function readPrefix(storage: StorageAdapter, key: string, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0);
  const stream: Readable = await storage.read(key, { start: 0, end: length - 1 });
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).subarray(0, length);
}
