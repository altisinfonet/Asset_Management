import { Inject, Injectable } from '@nestjs/common';
import { type AuthContext, locationScopeFor, permits } from '../auth/index.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { LocationsService, locationListSchema } from '../locations/index.js';
import { PeopleService, personListSchema } from '../people/index.js';
import {
  ApiProblem,
  type FieldError,
  type ListSpec,
  type Page,
  listPage,
  problem,
} from '../platform/index.js';
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
import { AssetsFacade, RegistryBase } from '../registry/index.js';
import {
  TenancyService,
  currentLocationScope,
  intersectLocationScopes,
  type Tx,
} from '../tenancy/index.js';
import { EXPORT_JOB } from './export-runner.js';
import {
  FORBIDDEN_FILTERS,
  type ExportCreate,
  type ExportListQuery,
  type ExportResource,
  toQueryRecord,
} from './schemas.js';

type ExportRow = NonNullable<Awaited<ReturnType<Tx['export_job']['findUnique']>>>;

const SPEC: ListSpec = {
  sortable: { created_at: { kind: 'date' } },
  defaultSort: '-created_at',
};

/** The read permission an export of each list needs on top of `export:run`. */
const READ_PERMISSION: Record<ExportResource, string> = {
  assets: 'asset:read',
  people: 'person:read',
  locations: 'location:read',
};

/** At most this many of a user's exports may wait or run at once. */
export const MAX_PENDING_EXPORTS = 5;

/** Schema `Export` (the download link is added by `get` only). */
function exportDto(
  r: ExportRow,
  link: { url: string; expiresAt: Date } | null = null,
): Record<string, unknown> {
  const expired = r.status === 'succeeded' && r.expires_at !== null && r.expires_at <= new Date();
  return {
    id: r.id,
    resource: r.resource,
    format: r.format,
    status: expired ? 'expired' : r.status,
    filters: r.filters,
    row_count: r.row_count,
    size_bytes: r.size_bytes === null ? null : Number(r.size_bytes),
    filename: r.filename,
    error: r.error,
    requested_by: r.requested_by,
    created_at: r.created_at.toISOString(),
    started_at: r.started_at ? r.started_at.toISOString() : null,
    completed_at: r.completed_at ? r.completed_at.toISOString() : null,
    expires_at: r.expires_at ? r.expires_at.toISOString() : null,
    download_url: link?.url ?? null,
    download_expires_at: link ? link.expiresAt.toISOString() : null,
  };
}

/**
 * The export endpoints (M2-REG-02). `create` checks the caller may read the list, validates the filters
 * exactly like the list endpoint would, stores the request and queues `export.run` (ids only) in the same
 * transaction; the worker writes the file (`export-runner.ts`). A download link is issued by `get`, is
 * short-lived and audited as a sensitive read, like the request itself.
 */
@Injectable()
export class ExportsService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly assets: AssetsFacade,
    private readonly people: PeopleService,
    private readonly locations: LocationsService,
  ) {
    super(tenancy, audit, outbox);
  }

  async create(auth: AuthContext, body: ExportCreate): Promise<Record<string, unknown>> {
    if (!permits(auth.permissions, READ_PERMISSION[body.resource])) {
      throw problem.forbidden(
        `Exporting ${body.resource} needs the ${READ_PERMISSION[body.resource]} permission as well.`,
      );
    }
    const forbidden = FORBIDDEN_FILTERS.filter((k) => body.filters[k] !== undefined);
    if (forbidden.length > 0) {
      throw problem.validation(
        forbidden.map((k) => ({
          pointer: `/filters/${k}`,
          message: 'paging and presentation parameters do not apply to an export',
          code: 'invalid',
        })),
      );
    }
    const filters = toQueryRecord(body.filters);
    return this.tx(auth, async (trx) => {
      await this.validate(auth, body.resource, filters);
      const pending = await trx.export_job.count({
        where: { requested_by: auth.userId, status: { in: ['queued', 'running'] } },
      });
      if (pending >= MAX_PENDING_EXPORTS) {
        throw problem.conflict(
          `You already have ${MAX_PENDING_EXPORTS} exports waiting. Wait for one to finish.`,
        );
      }
      const id = uuidv7();
      // M2-LOC-03 (ED-26): the rows the requester may LIST: the export:run scope narrowed to the
      // scope of the resource's read permission (they can differ with custom role bundles)
      const scope = await intersectLocationScopes(
        trx,
        currentLocationScope(),
        locationScopeFor(auth.grants, READ_PERMISSION[body.resource]),
      );
      const row = await trx.export_job.create({
        data: {
          id,
          tenant_id: auth.tenantId,
          requested_by: auth.userId,
          resource: body.resource,
          format: body.format,
          filters,
          // M2-LOC-03 (ED-26): the worker applies the requester's scope as it was at request time
          location_scoped: scope !== null,
          location_scope: scope ? [...scope] : [],
          created_by: auth.userId,
        },
      });
      await this.jobs.enqueue(EXPORT_JOB, { tenantId: auth.tenantId, exportId: id }, { tx: trx });
      await this.record(trx, {
        entity: 'export',
        verb: 'requested',
        id,
        version: row.version,
        before: null,
        after: { resource: body.resource, format: body.format, filters },
        meta: { sensitive_read: true },
        refs: { requestedBy: auth.userId },
      });
      return exportDto(row);
    });
  }

  async list(auth: AuthContext, query: ExportListQuery): Promise<Page<Record<string, unknown>>> {
    return this.tx(auth, async (trx) => {
      const filter = {
        requested_by: auth.userId,
        ...(query.status?.length ? { status: { in: query.status } } : {}),
      };
      const page = await listPage({
        query: {
          limit: query.limit,
          include_total: false,
          ...(query.cursor ? { cursor: query.cursor } : {}),
        },
        spec: SPEC,
        filters: { status: query.status },
        fetch: ({ take, orderBy, where }) =>
          trx.export_job.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<ExportRow & Record<string, unknown>>>,
      });
      return { data: page.data.map((r) => exportDto(r)), page: page.page };
    });
  }

  async get(auth: AuthContext, id: string): Promise<Record<string, unknown>> {
    return this.tx(auth, async (trx) => {
      const row = await trx.export_job.findFirst({ where: { id, requested_by: auth.userId } });
      if (!row) throw problem.notFound('Export not found.');
      const live =
        row.status === 'succeeded' &&
        row.storage_key !== null &&
        row.expires_at !== null &&
        row.expires_at > new Date();
      if (!live) return exportDto(row);

      const presigned = await this.storage.presignDownload({
        key: row.storage_key!,
        filename: row.filename ?? `${row.resource}.csv`,
        contentType: 'text/csv; charset=utf-8',
        disposition: 'attachment',
        ttlSeconds: this.config.FILES_DOWNLOAD_URL_TTL_SECONDS,
      });
      // A sensitive read: whoever got a link to the data is on record.
      await this.audit.write(trx, {
        action: 'export.downloaded',
        entityType: 'export',
        entityId: id,
        meta: {
          sensitive_read: true,
          resource: row.resource,
          rows: row.row_count,
          link_expires_at: presigned.expiresAt.toISOString(),
        },
      });
      return exportDto(row, { url: presigned.url, expiresAt: presigned.expiresAt });
    });
  }

  /** The filters must be exactly what the list endpoint accepts: a bad one is a 422 now, not a failed job later. */
  private async validate(
    auth: AuthContext,
    resource: ExportResource,
    filters: Record<string, string>,
  ): Promise<void> {
    try {
      switch (resource) {
        case 'assets':
          // Parses like GET /v1/assets and runs a one-row page, so unknown custom fields fail now.
          await this.assets.list(auth, { ...filters, limit: '1' });
          return;
        case 'people': {
          const parsed = personListSchema.safeParse({ ...filters, limit: '1' });
          if (!parsed.success) throw invalid(parsed.error.issues);
          await this.people.list(auth, parsed.data);
          return;
        }
        case 'locations': {
          const parsed = locationListSchema.safeParse({ ...filters, limit: '1' });
          if (!parsed.success) throw invalid(parsed.error.issues);
          await this.locations.list(auth, parsed.data);
          return;
        }
      }
    } catch (err) {
      if (err instanceof ApiProblem && err.code === 'bad-request') {
        throw problem.validation([
          { pointer: '/filters', message: err.detail ?? 'invalid filters', code: 'invalid' },
        ]);
      }
      throw err;
    }
  }
}

function invalid(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): ApiProblem {
  const errors: FieldError[] = issues.map((i) => ({
    pointer: `/filters/${String(i.path[0] ?? '')}`,
    message: i.message,
    code: 'invalid',
  }));
  return problem.validation(errors);
}
