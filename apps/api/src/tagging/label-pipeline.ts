import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { type TenantJobContext, queueDefinition } from '../jobs/index.js';
import {
  AUDIT_WRITER,
  JOB_QUEUE,
  OUTBOX_PUBLISHER,
  STORAGE_ADAPTER,
  StorageNotFoundError,
  type AuditWriter,
  type JobQueue,
  type OutboxPublisher,
  type StorageAdapter,
} from '../ports/index.js';
import { inSavepoint, loadLabelAssets } from '../registry/index.js';
import { newObjectKey } from '../storage/index.js';
import type { Tx } from '../tenancy/index.js';
import { LABEL_SWEEP_JOB, RENDER_JOB } from './jobs.js';
import { type BatchRow, type TemplateRow, toRenderTemplate } from './labels.service.js';
import { LabelRenderError, type LabelItem, renderLabelPdf } from './render.js';
import type { LabelCode, LabelField } from './templates.js';

/** Re-queue a batch whose job was lost after this long without leaving `queued`. */
export const REQUEUE_AFTER_MINUTES = 10;
const SWEEP_BATCH = 100;
/** The logo is shrunk to this box (px) before it enters the PDF: sharp.png, non-interlaced, 8 bit. */
const LOGO_BOX = { width: 600, height: 300 };

/**
 * The background half of M2-TAG-02, registered as the handlers of `label.render` and `label.sweep`.
 * Both run INSIDE the worker's tenant transaction (`ctx.tx`), so the status change, the history rows,
 * the audit row and the `label.batch.ready` outbox event commit together, and a failure rolls all of
 * it back (the file written before it is overwritten by the retry or removed when the batch fails).
 */
@Injectable()
export class LabelPipeline {
  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) private readonly outbox: OutboxPublisher,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The key is derived from the batch, so a retry overwrites the file of the failed attempt. */
  private keyFor(row: Pick<BatchRow, 'tenant_id' | 'id' | 'created_at'>): string {
    return newObjectKey(row.tenant_id, { objectId: row.id, now: row.created_at });
  }

  /** `label.render` { tenantId, batchId } */
  async render(
    payload: { tenantId: string; batchId?: unknown },
    ctx: TenantJobContext,
  ): Promise<void> {
    const id = String(payload.batchId ?? '');
    const { tx } = ctx;
    // The row lock serialises two runs of the same job (a retry racing a slow first attempt).
    await tx.$queryRaw`select id from app.label_batch where id = ${id}::uuid for update`;
    const row = (await tx.label_batch.findFirst({ where: { id } })) as unknown as BatchRow | null;
    if (!row || row.status !== 'queued') {
      ctx.logger.info({ batch_id: id }, 'label render skipped: not a queued batch');
      return;
    }

    try {
      await inSavepoint(tx, () => this.produce(tx, row, ctx));
    } catch (err) {
      if (err instanceof LabelRenderError) {
        // Retrying cannot fix the input: the requester gets the reason.
        await this.fail(tx, row, err.code, err.message);
        return;
      }
      const last = queueDefinition(ctx.queue)?.retryLimit ?? 0;
      if (ctx.retryCount >= last) {
        ctx.logger.error({ batch_id: id, err }, 'label render gave up');
        await this.fail(tx, row, 'render-failed', 'The labels could not be rendered. Try again.');
        return;
      }
      throw err;
    }
  }

  private async produce(tx: Tx, row: BatchRow, ctx: TenantJobContext): Promise<void> {
    const started = performance.now();
    const template = (await tx.label_template.findFirst({
      where: { id: row.template_id },
    })) as unknown as TemplateRow | null;
    if (!template) throw new LabelRenderError('template-missing', 'The label template is gone.');
    const tenant = await tx.tenant.findFirst({ select: { name: true } });
    const assets = await loadLabelAssets(tx, row.asset_ids);
    if (assets.length === 0)
      throw new LabelRenderError('assets-missing', 'No asset is left to print.');

    const items: LabelItem[] = assets.map((a) => ({
      assetTag: a.asset_tag,
      name: a.name ?? '',
      serial: a.serial,
      location: a.location_name,
      model: a.model_name,
      labelCode: a.label_code,
    }));
    // copies of one asset sit next to each other
    const labels = items.flatMap((item) => Array.from({ length: row.copies }, () => item));

    const logo = row.logo_attachment_id ? await this.loadLogo(tx, row.logo_attachment_id) : null;
    const base = this.config.WEB_BASE_URL.replace(/\/+$/, '');
    const result = await renderLabelPdf({
      template: toRenderTemplate(template),
      labels,
      startPosition: row.start_position,
      codes: row.codes as LabelCode[],
      fields: row.fields as LabelField[],
      organisation: tenant?.name ?? '',
      qrBaseUrl: `${base}/s/`,
      logo,
      outlines: row.outlines,
    });

    const key = this.keyFor(row);
    await this.storage.write(key, result.pdf, { contentType: 'application/pdf' });
    const renderMs = Math.round(performance.now() - started);
    const updated = await tx.label_batch.updateMany({
      where: { id: row.id, status: 'queued' },
      data: {
        status: 'ready',
        storage_key: key,
        content_type: 'application/pdf',
        size_bytes: BigInt(result.pdf.length),
        sha256: createHash('sha256').update(result.pdf).digest('hex'),
        page_count: result.pages,
        rendered_at: new Date(),
        render_ms: renderMs,
        error_code: null,
        error_detail: null,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return;

    // "Reprint history per asset (who printed when)": one asset_history row per asset, in one statement.
    const ids = assets.map(() => uuidv7());
    const assetIds = assets.map((a) => a.id);
    const historyPayload = JSON.stringify({
      batch_id: row.id,
      template_key: row.template_key,
      copies: row.copies,
    });
    await tx.$executeRaw`
      insert into app.asset_history
        (id, tenant_id, asset_id, at, event_type, actor_type, actor_id, summary, payload, request_id)
      select t.id, ${row.tenant_id}::uuid, t.asset_id, clock_timestamp(), 'label_printed',
             ${row.requested_by_type}::text, ${row.created_by}::uuid,
             ${`Label printed (${row.template_key})`}::text, ${historyPayload}::jsonb,
             ${`job:${ctx.jobId}`}::text
        from unnest(${ids}::uuid[], ${assetIds}::uuid[]) as t(id, asset_id)`;

    await this.audit.write(tx, {
      action: 'label.batch.ready',
      entityType: 'label_batch',
      entityId: row.id,
      after: {
        status: 'ready',
        page_count: result.pages,
        label_count: result.labels,
        size_bytes: result.pdf.length,
        render_ms: renderMs,
      },
    });
    // Ids only: the notification module (later) resolves who and what from them.
    await this.outbox.publish(tx, {
      type: 'label.batch.ready',
      aggregateType: 'label_batch',
      aggregateId: row.id,
      payload: { batch_id: row.id, requested_by: row.created_by, version: row.version + 1 },
    });
    ctx.logger.info(
      {
        batch_id: row.id,
        labels: result.labels,
        pages: result.pages,
        bytes: result.pdf.length,
        ms: renderMs,
      },
      'label batch rendered',
    );
  }

  /** The logo as a small non-interlaced PNG (pdfkit cannot read interlaced PNGs or exotic JPEGs). */
  private async loadLogo(tx: Tx, attachmentId: string): Promise<Buffer> {
    const att = await tx.attachment.findFirst({
      where: { id: attachmentId, archived_at: null, scan_status: 'clean' },
      select: { storage_key: true },
    });
    if (!att)
      throw new LabelRenderError('logo-unavailable', 'The logo attachment is no longer available.');
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of (await this.storage.read(
        att.storage_key,
      )) as AsyncIterable<Buffer>) {
        chunks.push(Buffer.from(chunk));
      }
      return await sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000, failOn: 'error' })
        .rotate()
        .resize({ ...LOGO_BOX, fit: 'inside', withoutEnlargement: true })
        .png({ progressive: false })
        .toBuffer();
    } catch (err) {
      if (err instanceof StorageNotFoundError) {
        throw new LabelRenderError('logo-unavailable', 'The logo file is no longer available.');
      }
      throw new LabelRenderError('logo-invalid', 'The logo could not be read as an image.');
    }
  }

  /** The batch is unusable: record why (the requester sees `error`) and clean up. */
  private async fail(tx: Tx, row: BatchRow, code: string, detail: string): Promise<void> {
    const updated = await tx.label_batch.updateMany({
      where: { id: row.id, status: 'queued' },
      data: {
        status: 'failed',
        error_code: code.slice(0, 100),
        error_detail: detail.slice(0, 1000),
        storage_key: null,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return;
    await this.storage.delete(this.keyFor(row)).catch(() => undefined);
    await this.audit.write(tx, {
      action: 'label.batch.failed',
      entityType: 'label_batch',
      entityId: row.id,
      after: { status: 'failed', error_code: code },
    });
    await this.outbox.publish(tx, {
      type: 'label.batch.failed',
      aggregateType: 'label_batch',
      aggregateId: row.id,
      payload: { batch_id: row.id, requested_by: row.created_by, code },
    });
  }

  /**
   * `label.sweep` (scheduler, every 10 minutes per tenant): deletes the file of a ready batch past its
   * `expires_at` (status `expired`), and queues the render job again for a batch that stayed `queued`
   * (the job was lost): a singleton key makes that idempotent.
   */
  async sweep(payload: { tenantId: string }, ctx: TenantJobContext): Promise<void> {
    const { tx } = ctx;
    const expired = (await tx.label_batch.findMany({
      where: { status: 'ready', expires_at: { lt: new Date() } },
      orderBy: { expires_at: 'asc' },
      take: SWEEP_BATCH,
    })) as unknown as BatchRow[];
    for (const row of expired) {
      if (row.storage_key) await this.storage.delete(row.storage_key);
      const updated = await tx.label_batch.updateMany({
        where: { id: row.id, status: 'ready' },
        data: { status: 'expired', storage_key: null, version: { increment: 1 } },
      });
      if (updated.count > 0) {
        await this.audit.write(tx, {
          action: 'label.batch.expired',
          entityType: 'label_batch',
          entityId: row.id,
          after: { status: 'expired' },
        });
      }
    }

    const stuckBefore = new Date(Date.now() - REQUEUE_AFTER_MINUTES * 60_000);
    const stuck = (await tx.label_batch.findMany({
      where: { status: 'queued', created_at: { lt: stuckBefore } },
      orderBy: { created_at: 'asc' },
      take: SWEEP_BATCH,
    })) as unknown as BatchRow[];
    for (const row of stuck) {
      await this.jobs.enqueue(
        RENDER_JOB,
        { tenantId: payload.tenantId, batchId: row.id },
        { tx, singletonKey: `label:${row.id}` },
      );
    }
    if (expired.length > 0 || stuck.length > 0) {
      ctx.logger.info(
        { expired: expired.length, requeued: stuck.length, job: LABEL_SWEEP_JOB },
        'label sweep',
      );
    }
  }
}
