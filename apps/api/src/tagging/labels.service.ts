import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { diffRecords } from '../audit/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { type IfMatch, type Page, assertIfMatch, listPage, problem } from '../platform/index.js';
import {
  AUDIT_WRITER,
  JOB_QUEUE,
  STORAGE_ADAPTER,
  type AuditWriter,
  type JobQueue,
  type StorageAdapter,
} from '../ports/index.js';
import { loadLabelAssets, parseAssetSelection, selectAssetIds } from '../registry/index.js';
import { type Tx, TenancyService } from '../tenancy/index.js';
import { RENDER_JOB } from './jobs.js';
import { unprintableCode128Tags } from './render.js';
import {
  LABEL_LOGO_MAX_BYTES,
  LABEL_MAX_ASSETS,
  LABEL_MAX_LABELS,
  LABEL_RETENTION_HOURS,
  type LabelBatchCreate,
  type LabelBatchListQuery,
  type LabelTemplateUpdate,
} from './schemas.js';
import {
  LABEL_TEMPLATES,
  type LabelCode,
  type LabelField,
  type RenderTemplate,
  codesOf,
  slotsPerPage,
} from './templates.js';

/** A `label_template` row as Prisma returns it (decimals as `Decimal`). */
export interface TemplateRow {
  id: string;
  key: string;
  name: string;
  page_size: string;
  page_width_mm: { toString(): string };
  page_height_mm: { toString(): string };
  label_width_mm: { toString(): string };
  label_height_mm: { toString(): string };
  cols: number;
  rows: number;
  margin_top_mm: { toString(): string };
  margin_left_mm: { toString(): string };
  gap_x_mm: { toString(): string };
  gap_y_mm: { toString(): string };
  offset_x_mm: { toString(): string };
  offset_y_mm: { toString(): string };
  code_type: string;
  fields: string[];
  is_system: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface BatchRow {
  id: string;
  tenant_id: string;
  template_id: string;
  template_key: string;
  status: string;
  asset_ids: string[];
  source_filter: unknown;
  asset_count: number;
  copies: number;
  label_count: number;
  start_position: number;
  codes: string[];
  fields: string[];
  outlines: boolean;
  logo_attachment_id: string | null;
  requested_by_type: string;
  page_count: number | null;
  storage_key: string | null;
  content_type: string | null;
  size_bytes: bigint | null;
  sha256: string | null;
  rendered_at: Date | null;
  render_ms: number | null;
  error_code: string | null;
  error_detail: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  version: number;
}

const n = (v: { toString(): string }): number => Number(v.toString());

export const toRenderTemplate = (row: TemplateRow): RenderTemplate => ({
  key: row.key,
  name: row.name,
  pageSize: row.page_size as RenderTemplate['pageSize'],
  pageWidthMm: n(row.page_width_mm),
  pageHeightMm: n(row.page_height_mm),
  labelWidthMm: n(row.label_width_mm),
  labelHeightMm: n(row.label_height_mm),
  cols: row.cols,
  rows: row.rows,
  marginTopMm: n(row.margin_top_mm),
  marginLeftMm: n(row.margin_left_mm),
  gapXMm: n(row.gap_x_mm),
  gapYMm: n(row.gap_y_mm),
  codeType: row.code_type as RenderTemplate['codeType'],
  fields: row.fields as LabelField[],
  offsetXMm: n(row.offset_x_mm),
  offsetYMm: n(row.offset_y_mm),
});

/** `LabelTemplate` of the contract. */
export function templateDto(row: TemplateRow) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    page_size: row.page_size,
    page_width_mm: n(row.page_width_mm),
    page_height_mm: n(row.page_height_mm),
    label_width_mm: n(row.label_width_mm),
    label_height_mm: n(row.label_height_mm),
    cols: row.cols,
    rows: row.rows,
    slots: row.cols * row.rows,
    margin_top_mm: n(row.margin_top_mm),
    margin_left_mm: n(row.margin_left_mm),
    gap_x_mm: n(row.gap_x_mm),
    gap_y_mm: n(row.gap_y_mm),
    offset_x_mm: n(row.offset_x_mm),
    offset_y_mm: n(row.offset_y_mm),
    code_type: row.code_type,
    fields: row.fields,
    is_system: row.is_system,
  };
}

/** The download name of a rendered batch. */
export const batchFilename = (row: Pick<BatchRow, 'id' | 'template_key' | 'created_at'>): string =>
  `labels-${row.template_key}-${row.created_at.toISOString().slice(0, 10).replaceAll('-', '')}-${row.id.slice(-8)}.pdf`;

const orderIndex = new Map(LABEL_TEMPLATES.map((t, i) => [t.key, i]));

/** The auditable view of a template (calibration is the only thing that changes). */
const templateAudit = (row: TemplateRow) => ({
  offset_x_mm: n(row.offset_x_mm),
  offset_y_mm: n(row.offset_y_mm),
});

const BATCH_LIST_SPEC = {
  sortable: { id: { kind: 'string' as const }, created_at: { kind: 'date' as const } },
  defaultSort: '-created_at',
};

/**
 * Label templates and label batches (M2-TAG-02). The request side: validation, selection of the
 * assets, the batch row, the audit row and the job, all in ONE tenant transaction. The rendering is
 * `LabelPipeline` (worker). A batch belongs to its requester: nobody else can read or download it.
 */
@Injectable()
export class LabelsService {
  constructor(
    private readonly tenancy: TenancyService,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private tx<T>(auth: AuthContext, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.tenancy.withTenantTx({ tenantId: auth.tenantId, actorId: auth.principalId }, fn);
  }

  // ----------------------------------------------------------------------------- templates

  /**
   * Seeds the fixed templates when the tenant lacks any (a tenant provisioned by a path that did not
   * call `app.seed_label_templates`). Idempotent; a cheap count when everything is there.
   */
  async ensureTemplates(trx: Tx, tenantId: string): Promise<void> {
    const have = await trx.label_template.count();
    if (have >= LABEL_TEMPLATES.length) return;
    await trx.$executeRaw`select app.seed_label_templates(${tenantId}::uuid)`;
  }

  private async templates(trx: Tx, tenantId: string): Promise<TemplateRow[]> {
    await this.ensureTemplates(trx, tenantId);
    const rows = (await trx.label_template.findMany()) as unknown as TemplateRow[];
    return rows.sort((a, b) => (orderIndex.get(a.key) ?? 99) - (orderIndex.get(b.key) ?? 99));
  }

  async listTemplates(auth: AuthContext) {
    const rows = await this.tx(auth, (trx) => this.templates(trx, auth.tenantId));
    return { data: rows.map(templateDto) };
  }

  async getTemplate(auth: AuthContext, id: string) {
    const row = await this.tx(auth, async (trx) => {
      const found = (await this.templates(trx, auth.tenantId)).find((t) => t.id === id);
      if (!found) throw problem.notFound('Label template not found.');
      return found;
    });
    return { data: templateDto(row), version: row.version };
  }

  /** Calibration (M2-TAG-04): moves the whole sheet. The geometry itself is fixed. */
  async calibrateTemplate(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: LabelTemplateUpdate,
  ) {
    const row = await this.tx(auth, async (trx) => {
      await this.ensureTemplates(trx, auth.tenantId);
      const current = (await trx.label_template.findFirst({ where: { id } })) as TemplateRow | null;
      if (!current) throw problem.notFound('Label template not found.');
      assertIfMatch(ifMatch, current.version);
      const updated = await trx.label_template.updateMany({
        where: { id, version: current.version },
        data: {
          ...(body.offset_x_mm !== undefined ? { offset_x_mm: body.offset_x_mm } : {}),
          ...(body.offset_y_mm !== undefined ? { offset_y_mm: body.offset_y_mm } : {}),
          updated_by: auth.principalId,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw problem.preconditionFailed('The resource has changed. Re-read it and retry.');
      }
      const fresh = (await trx.label_template.findFirstOrThrow({ where: { id } })) as TemplateRow;
      const diff = diffRecords(templateAudit(current), templateAudit(fresh));
      await this.audit.write(trx, {
        action: 'label.template.calibrated',
        entityType: 'label_template',
        entityId: id,
        before: diff.before,
        after: diff.after,
        meta: { key: fresh.key },
      });
      return fresh;
    });
    return { data: templateDto(row), version: row.version };
  }

  // ----------------------------------------------------------------------------- batches

  /** The URL of a ready batch's file (presigning is offline: no storage round trip). */
  private async batchDto(row: BatchRow) {
    let downloadUrl: string | null = null;
    let downloadExpires: string | null = null;
    if (row.status === 'ready' && row.storage_key) {
      const ttl = this.config.FILES_DOWNLOAD_URL_TTL_SECONDS;
      const url = await this.storage.presignDownload({
        key: row.storage_key,
        filename: batchFilename(row),
        contentType: 'application/pdf',
        disposition: 'attachment',
        ttlSeconds: ttl,
      });
      downloadUrl = url.url;
      downloadExpires = url.expiresAt.toISOString();
    }
    return {
      id: row.id,
      status: row.status,
      template_key: row.template_key,
      source: row.source_filter ? 'filter' : 'asset_ids',
      asset_count: row.asset_count,
      copies: row.copies,
      label_count: row.label_count,
      start_position: row.start_position,
      codes: row.codes,
      fields: row.fields,
      outlines: row.outlines,
      logo_attachment_id: row.logo_attachment_id,
      page_count: row.page_count,
      filename: row.status === 'ready' ? batchFilename(row) : null,
      size_bytes: row.size_bytes === null ? null : Number(row.size_bytes),
      created_at: row.created_at.toISOString(),
      rendered_at: row.rendered_at?.toISOString() ?? null,
      expires_at: row.expires_at.toISOString(),
      download_url: downloadUrl,
      download_expires_at: downloadExpires,
      error:
        row.status === 'failed'
          ? { code: row.error_code ?? 'render-failed', detail: row.error_detail ?? '' }
          : null,
    };
  }

  /** Validates, selects the assets and queues the render job. */
  async createBatch(auth: AuthContext, body: LabelBatchCreate) {
    const row = await this.tx(auth, async (trx) => {
      const template = (await this.templates(trx, auth.tenantId)).find(
        (t) => t.key === body.template_key,
      );
      if (!template) {
        throw problem.validation([
          {
            pointer: '/template_key',
            message: 'No such label template. See GET /v1/labels/templates.',
            code: 'not-found',
          },
        ]);
      }
      const geometry = toRenderTemplate(template);
      const slots = slotsPerPage(geometry);
      if (body.start_position > slots) {
        throw problem.validation([
          {
            pointer: '/start_position',
            message: `This template has ${slots} label${slots === 1 ? '' : 's'} per sheet.`,
            code: 'out-of-range',
          },
        ]);
      }
      const codes: LabelCode[] = body.codes ?? codesOf(geometry.codeType);
      const fields: LabelField[] = body.fields ?? geometry.fields.slice();
      if (codes.length === 0 && fields.length === 0) {
        throw problem.validation([
          {
            pointer: '/codes',
            message: 'A label needs a code or at least one field.',
            code: 'empty',
          },
        ]);
      }

      // ---- which assets, in which order
      let ids: string[];
      let sourceFilter: Record<string, unknown> | null = null;
      if (body.asset_ids) {
        ids = body.asset_ids;
      } else {
        const parsed = parseAssetSelection(body.filter ?? {}, '/filter');
        if (!parsed.ok) throw problem.validation(parsed.errors);
        const found = await selectAssetIds(trx, parsed.query, LABEL_MAX_ASSETS);
        if (found.more) {
          throw problem.validation([
            {
              pointer: '/filter',
              message: `The filter matches more than ${LABEL_MAX_ASSETS} assets; narrow it down.`,
              code: 'too-many',
            },
          ]);
        }
        if (found.ids.length === 0) {
          throw problem.validation([
            { pointer: '/filter', message: 'The filter matches no asset.', code: 'empty' },
          ]);
        }
        ids = found.ids;
        sourceFilter = body.filter ?? {};
      }
      const assets = await loadLabelAssets(trx, ids);
      if (assets.length !== ids.length) {
        const have = new Set(assets.map((a) => a.id));
        throw problem.validation(
          ids
            .map((id, i) => ({ id, i }))
            .filter(({ id }) => !have.has(id))
            .slice(0, 50)
            .map(({ i }) => ({
              pointer: `/asset_ids/${i}`,
              message: 'No such asset.',
              code: 'not-found',
            })),
        );
      }
      const labelCount = assets.length * body.copies;
      if (labelCount > LABEL_MAX_LABELS) {
        throw problem.validation([
          {
            pointer: '/copies',
            message: `A batch holds at most ${LABEL_MAX_LABELS} labels; this one has ${labelCount}.`,
            code: 'too-many',
          },
        ]);
      }
      const dense = unprintableCode128Tags(
        geometry,
        codes,
        assets.map((a) => a.asset_tag),
      );
      if (dense.length > 0) {
        throw problem.validation([
          {
            pointer: '/codes',
            message: `These tags cannot be printed as a readable Code128 on this template: ${dense
              .slice(0, 5)
              .join(
                ', ',
              )}${dense.length > 5 ? ` and ${dense.length - 5} more` : ''}. Use the QR code, or a wider template.`,
            code: 'barcode-unprintable',
          },
        ]);
      }
      if (body.logo_attachment_id) await this.assertLogo(trx, body.logo_attachment_id);

      // ---- the batch and its job, together
      const id = uuidv7();
      const expiresAt = new Date(Date.now() + LABEL_RETENTION_HOURS * 3600_000);
      const created = (await trx.label_batch.create({
        data: {
          id,
          tenant_id: auth.tenantId,
          template_id: template.id,
          template_key: template.key,
          asset_ids: ids,
          ...(sourceFilter ? { source_filter: sourceFilter as object } : {}),
          asset_count: assets.length,
          copies: body.copies,
          label_count: labelCount,
          start_position: body.start_position,
          codes,
          fields,
          outlines: body.outlines,
          logo_attachment_id: body.logo_attachment_id ?? null,
          requested_by_type: auth.method === 'api_key' ? 'api_key' : 'user',
          expires_at: expiresAt,
          created_by: auth.principalId,
        },
      })) as unknown as BatchRow;
      await this.audit.write(trx, {
        action: 'label.batch.requested',
        entityType: 'label_batch',
        entityId: id,
        after: {
          template_key: template.key,
          asset_count: assets.length,
          copies: body.copies,
          label_count: labelCount,
          start_position: body.start_position,
          codes,
          fields,
        },
      });
      await this.jobs.enqueue(
        RENDER_JOB,
        { tenantId: auth.tenantId, batchId: id },
        { tx: trx, singletonKey: `label:${id}` },
      );
      return created;
    });
    return { data: await this.batchDto(row), id: row.id };
  }

  private async assertLogo(trx: Tx, attachmentId: string): Promise<void> {
    const logo = await trx.attachment.findFirst({
      where: { id: attachmentId, archived_at: null },
      select: { content_type: true, scan_status: true, uploaded_at: true, size_bytes: true },
    });
    const fail = (message: string, code: string) =>
      problem.validation([{ pointer: '/logo_attachment_id', message, code }]);
    if (!logo) throw fail('No such attachment.', 'not-found');
    if (!['image/png', 'image/jpeg'].includes(logo.content_type)) {
      throw fail('The logo must be a PNG or JPEG image.', 'not-png-or-jpeg');
    }
    if (logo.scan_status !== 'clean' || !logo.uploaded_at) {
      throw fail('The logo has not passed the virus scan (yet).', 'not-clean');
    }
    if (Number(logo.size_bytes) > LABEL_LOGO_MAX_BYTES) {
      throw fail(`The logo is larger than ${LABEL_LOGO_MAX_BYTES / 1024 / 1024} MiB.`, 'too-large');
    }
  }

  private async ownBatch(trx: Tx, auth: AuthContext, id: string): Promise<BatchRow> {
    const row = (await trx.label_batch.findFirst({
      where: { id, created_by: auth.principalId },
    })) as unknown as BatchRow | null;
    if (!row) throw problem.notFound('Label batch not found.');
    return row;
  }

  async getBatch(auth: AuthContext, id: string) {
    const row = await this.tx(auth, (trx) => this.ownBatch(trx, auth, id));
    return this.batchDto(row);
  }

  async listBatches(auth: AuthContext, query: LabelBatchListQuery) {
    const page = await this.tx(auth, (trx) =>
      listPage<Record<string, unknown>>({
        query,
        spec: BATCH_LIST_SPEC,
        filters: { status: query.status ?? null },
        fetch: async ({ take, orderBy, where }) => {
          const and: object[] = [
            { created_by: auth.principalId },
            ...(query.status?.length ? [{ status: { in: query.status } }] : []),
            ...(where ? [where] : []),
          ];
          return (await trx.label_batch.findMany({
            where: { AND: and },
            orderBy,
            take,
          })) as unknown as Record<string, unknown>[];
        },
        count: () =>
          trx.label_batch.count({
            where: {
              created_by: auth.principalId,
              ...(query.status?.length ? { status: { in: query.status } } : {}),
            },
          }),
      }),
    );
    const data = await Promise.all(page.data.map((r) => this.batchDto(r as unknown as BatchRow)));
    return { data, page: page.page } satisfies Page<unknown>;
  }
}
