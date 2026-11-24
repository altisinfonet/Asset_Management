import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { TenantJobContext } from '../jobs/index.js';
import { LocationsService, locationListSchema } from '../locations/index.js';
import { ApiProblem } from '../platform/index.js';
import { PeopleService, personListSchema } from '../people/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  STORAGE_ADAPTER,
  type AuditWriter,
  type OutboxPublisher,
  type StorageAdapter,
} from '../ports/index.js';
import { AssetsFacade, type TxScope, inSavepoint } from '../registry/index.js';
import { newObjectKey } from '../storage/index.js';
import type { Tx } from '../tenancy/index.js';
import { type Cell, CsvWriter, decimalOf } from './csv.js';
import type { ExportResource } from './schemas.js';

/** Queue names (src/jobs/catalogue.ts). */
export const EXPORT_JOB = 'export.run';
export const EXPORT_SWEEP_JOB = 'export.sweep';

/** An export file is deleted this long after it was written. */
export const EXPORT_TTL_HOURS = 24;
/** The most rows one export may hold (the file is assembled in memory before it is stored). */
export const EXPORT_MAX_ROWS = 100_000;
const PAGE = 200;
const RETRY_LIMIT = 2;

/** A failure the user can act on (bad filters, too many rows): recorded on the job, never retried. */
export class ExportFailure extends Error {}

type Row = Record<string, unknown>;
const uuid = z.uuid();

/** Display value of a custom field: text and numbers as such, lists joined with `|`. */
function customValue(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => String(v)).join('|');
  return JSON.stringify(value);
}

const day = (v: unknown): string | null => (typeof v === 'string' ? v.slice(0, 10) : null);

/**
 * `export.run` { tenantId, exportId } (M2-REG-02): reads the list with the stored filters, page by page
 * through the same services the list endpoints use, builds the CSV and stores it through the
 * StorageAdapter under a tenant-prefixed key. Runs in the worker's tenant transaction as the user that
 * asked (their id scopes the queries; the permission was checked when the export was requested).
 *
 * A deterministic failure (a filter that no longer parses, more than {@link EXPORT_MAX_ROWS} rows) marks
 * the export `failed` with a sentence and is not retried; an unexpected one is retried by the queue and,
 * on the last attempt, also recorded as failed (the work runs in a savepoint so the transaction survives
 * to write that). The file is removed again when anything after writing it fails.
 */
@Injectable()
export class ExportRunner {
  constructor(
    private readonly assets: AssetsFacade,
    private readonly people: PeopleService,
    private readonly locations: LocationsService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) private readonly outbox: OutboxPublisher,
  ) {}

  async run(
    payload: { tenantId: string; exportId?: unknown },
    ctx: TenantJobContext,
  ): Promise<void> {
    const { tx } = ctx;
    const id = String(payload.exportId ?? '');
    if (!uuid.safeParse(id).success) {
      ctx.logger.warn('export.run payload has no valid exportId');
      return;
    }
    const [locked] = await tx.$queryRaw<Array<{ status: string }>>`
      select status from app.export_job where id = ${id}::uuid for update`;
    if (!locked || (locked.status !== 'queued' && locked.status !== 'running')) {
      ctx.logger.info({ export_id: id }, 'export skipped: not a queued export');
      return;
    }
    const job = await tx.export_job.findUniqueOrThrow({ where: { id } });
    const scope: TxScope = { tenantId: ctx.tenantId, principalId: job.requested_by };

    let key: string | null = null;
    try {
      const built = await inSavepoint(tx, () =>
        this.build(
          tx,
          scope,
          job.resource as ExportResource,
          job.filters as Record<string, string>,
        ),
      );
      key = newObjectKey(ctx.tenantId, { variant: 'csv' });
      const body = built.toBuffer();
      await this.storage.write(key, body, { contentType: 'text/csv; charset=utf-8' });
      const now = new Date();
      const filename = `${job.resource}-${now.toISOString().slice(0, 10)}.csv`;
      await tx.export_job.update({
        where: { id },
        data: {
          status: 'succeeded',
          row_count: built.rows,
          size_bytes: BigInt(body.length),
          filename,
          storage_key: key,
          completed_at: now,
          expires_at: new Date(now.getTime() + EXPORT_TTL_HOURS * 3_600_000),
          error: null,
        },
      });
      await this.audit.write(tx, {
        action: 'export.completed',
        entityType: 'export',
        entityId: id,
        meta: {
          resource: job.resource,
          rows: built.rows,
          bytes: body.length,
          requested_by: job.requested_by,
        },
      });
      await this.outbox.publish(tx, {
        type: 'export.completed',
        aggregateType: 'export',
        aggregateId: id,
        payload: { requestedBy: job.requested_by, rows: built.rows },
      });
    } catch (err) {
      if (key) await this.storage.delete(key).catch(() => undefined);
      const message = failureMessage(err);
      if (message === null && ctx.retryCount < RETRY_LIMIT) throw err;
      await tx.export_job.update({
        where: { id },
        data: {
          status: 'failed',
          error: message ?? 'The export could not be produced. Try again later.',
          completed_at: new Date(),
        },
      });
      await this.audit.write(tx, {
        action: 'export.failed',
        entityType: 'export',
        entityId: id,
        meta: { resource: job.resource, requested_by: job.requested_by },
      });
      ctx.logger.warn({ export_id: id, err: String(err) }, 'export failed');
    }
  }

  /** `export.sweep` { tenantId }: deletes the files of exports past their retention. */
  async sweep(_payload: { tenantId: string }, ctx: TenantJobContext): Promise<void> {
    const { tx } = ctx;
    const due = await tx.export_job.findMany({
      where: { status: 'succeeded', expires_at: { lte: new Date() } },
      select: { id: true, storage_key: true },
      take: 200,
    });
    for (const job of due) {
      if (job.storage_key) await this.storage.delete(job.storage_key);
      await tx.export_job.update({
        where: { id: job.id },
        data: { status: 'expired', storage_key: null },
      });
    }
    if (due.length > 0) ctx.logger.info({ expired: due.length }, 'export files expired');
  }

  // ----------------------------------------------------------------------------- the builders

  private async build(
    tx: Tx,
    scope: TxScope,
    resource: ExportResource,
    filters: Record<string, string>,
  ): Promise<CsvWriter> {
    switch (resource) {
      case 'assets':
        return this.buildAssets(tx, scope, filters);
      case 'people':
        return this.buildPeople(tx, scope, filters);
      case 'locations':
        return this.buildLocations(tx, scope, filters);
    }
  }

  private add(csv: CsvWriter, values: readonly Cell[]): void {
    if (csv.rows >= EXPORT_MAX_ROWS) {
      throw new ExportFailure(
        `The export has more than ${EXPORT_MAX_ROWS.toLocaleString('en')} rows. Narrow the filters and try again.`,
      );
    }
    csv.add(values);
  }

  private async buildAssets(
    tx: Tx,
    scope: TxScope,
    filters: Record<string, string>,
  ): Promise<CsvWriter> {
    const defs = await tx.custom_field_def.findMany({
      where: { archived_at: null },
      orderBy: [{ position: 'asc' }, { key: 'asc' }],
      select: { key: true },
    });
    const keys = [...new Set(defs.map((d) => d.key))];
    const csv = new CsvWriter([
      'asset_tag',
      'name',
      'serial',
      'category',
      'model',
      'status',
      'location',
      'department',
      'assigned_to',
      'expected_return',
      'vendor',
      'purchase_date',
      'purchase_cost',
      'currency',
      'order_number',
      'warranty_end',
      'notes',
      'label_code',
      'archived',
      ...keys.map((k) => `cf:${k}`),
    ]);
    let cursor: string | null = null;
    do {
      const page: { data: Row[]; page: { next_cursor: string | null } } = await this.assets.list(
        scope,
        {
          ...filters,
          limit: String(PAGE),
          expand: 'model,category,location,vendor,department',
          ...(cursor ? { cursor } : {}),
        },
      );
      for (const a of page.data) {
        const ex = (a.expanded ?? {}) as Record<string, { name?: string } | null>;
        const status = a.status as { name: string } | undefined;
        const current = a.current_assignment as {
          target_name: string | null;
          expected_return: string | null;
        } | null;
        const cost = a.purchase_cost as { amount_minor: number; currency: string } | null;
        const custom = (a.custom_data ?? {}) as Record<string, unknown>;
        this.add(csv, [
          a.asset_tag as string,
          a.name as string | null,
          a.serial as string | null,
          ex.category?.name ?? null,
          ex.model?.name ?? null,
          status?.name ?? null,
          ex.location?.name ?? null,
          ex.department?.name ?? null,
          current?.target_name ?? null,
          current?.expected_return ?? null,
          ex.vendor?.name ?? null,
          day(a.purchase_date),
          cost ? decimalOf(cost.amount_minor, cost.currency) : null,
          cost?.currency ?? null,
          a.order_number as string | null,
          day(a.warranty_end),
          a.notes as string | null,
          a.label_code as string | null,
          a.archived_at ? 'yes' : 'no',
          ...keys.map((k) => customValue(custom[k])),
        ]);
      }
      cursor = page.page.next_cursor;
    } while (cursor);
    return csv;
  }

  private async buildPeople(
    tx: Tx,
    scope: TxScope,
    filters: Record<string, string>,
  ): Promise<CsvWriter> {
    const parsed = personListSchema.safeParse({ ...filters, limit: String(PAGE) });
    if (!parsed.success) throw new ExportFailure(filterMessage(parsed.error.issues[0]));
    const places = new Map(
      (await tx.location.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]),
    );
    const csv = new CsvWriter([
      'display_name',
      'first_name',
      'last_name',
      'email',
      'phone',
      'employee_ref',
      'department',
      'job_title',
      'kind',
      'status',
      'location',
      'notes',
      'archived',
    ]);
    let cursor: string | undefined;
    do {
      const page = await this.people.list(scope, { ...parsed.data, ...(cursor ? { cursor } : {}) });
      for (const p of page.data) {
        this.add(csv, [
          p.display_name as string,
          p.first_name as string | null,
          p.last_name as string | null,
          p.email as string | null,
          p.phone as string | null,
          p.employee_ref as string | null,
          p.department as string | null,
          p.job_title as string | null,
          p.kind as string,
          p.status as string,
          p.location_id ? (places.get(p.location_id as string) ?? null) : null,
          p.notes as string | null,
          p.archived_at ? 'yes' : 'no',
        ]);
      }
      cursor = page.page.next_cursor ?? undefined;
    } while (cursor);
    return csv;
  }

  private async buildLocations(
    tx: Tx,
    scope: TxScope,
    filters: Record<string, string>,
  ): Promise<CsvWriter> {
    const parsed = locationListSchema.safeParse({ ...filters, limit: String(PAGE) });
    if (!parsed.success) throw new ExportFailure(filterMessage(parsed.error.issues[0]));
    const names = new Map(
      (await tx.location.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]),
    );
    const csv = new CsvWriter([
      'name',
      'path',
      'parent',
      'kind',
      'code',
      'address_line1',
      'address_line2',
      'city',
      'region',
      'postal_code',
      'country',
      'latitude',
      'longitude',
      'notes',
      'archived',
    ]);
    let cursor: string | undefined;
    do {
      const page = await this.locations.list(scope, {
        ...parsed.data,
        ...(cursor ? { cursor } : {}),
      });
      for (const l of page.data) {
        const address = (l.address ?? {}) as Record<string, string | null>;
        const ancestors = (l.ancestor_ids as string[] | undefined) ?? [];
        this.add(csv, [
          l.name as string,
          ancestors.map((a) => names.get(a) ?? '').join(' / '),
          l.parent_id ? (names.get(l.parent_id as string) ?? null) : null,
          l.kind as string,
          l.code as string | null,
          address.line1 ?? null,
          address.line2 ?? null,
          address.city ?? null,
          address.region ?? null,
          address.postal_code ?? null,
          address.country ?? null,
          l.latitude === null || l.latitude === undefined ? null : Number(l.latitude),
          l.longitude === null || l.longitude === undefined ? null : Number(l.longitude),
          l.notes as string | null,
          l.archived_at ? 'yes' : 'no',
        ]);
      }
      cursor = page.page.next_cursor ?? undefined;
    } while (cursor);
    return csv;
  }
}

function filterMessage(issue: z.core.$ZodIssue | undefined): string {
  return `The filters are not valid any more (${issue ? `${issue.path.join('.')}: ${issue.message}` : 'unknown'}).`;
}

/** A sentence for a failure the user can act on; null for anything unexpected (retried). */
function failureMessage(err: unknown): string | null {
  if (err instanceof ExportFailure) return err.message;
  if (err instanceof ApiProblem && err.getStatus() < 500) {
    return `The filters are not valid any more: ${err.detail ?? err.message}`.slice(0, 400);
  }
  return null;
}
