import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import {
  type FieldError,
  type IfMatch,
  type ListSpec,
  type Page,
  assertIfMatch,
  listPage,
  problem,
} from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import { RegistryBase, duplicate, stalePrecondition } from '../registry/index.js';
import { TenancyService, isLocationScoped, isUniqueViolation, type Tx } from '../tenancy/index.js';
import { type EntityType, specOf, CUSTOM_PREFIX } from './fields.js';
import { ImportsService } from './importer.service.js';
import type { TemplateCreate, TemplateListQuery, TemplateUpdate } from './schemas.js';
import { optionsPatchSchema } from './types.js';

type TemplateRow = NonNullable<Awaited<ReturnType<Tx['import_template']['findUnique']>>>;
const SPEC: ListSpec = {
  sortable: { name: { kind: 'string' }, created_at: { kind: 'date' } },
  defaultSort: 'name',
};

function templateDto(r: TemplateRow): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    entity_type: r.entity_type,
    columns: r.columns,
    options: r.options,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    created_by: r.created_by,
  };
}

/** Saved column mappings per tenant (M2-IMP-03): created from an import or by hand, applied to a job by header. */
@Injectable()
export class ImportTemplatesService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
    private readonly imports: ImportsService,
  ) {
    super(tenancy, audit, outbox);
  }

  async list(auth: AuthContext, q: TemplateListQuery): Promise<Page<Record<string, unknown>>> {
    return this.tx(auth, async (trx) => {
      const filter = {
        archived_at: null,
        ...(q.entity_type ? { entity_type: q.entity_type } : {}),
      };
      const page = await listPage({
        query: { limit: q.limit, include_total: false, ...(q.cursor ? { cursor: q.cursor } : {}) },
        spec: SPEC,
        filters: { entity_type: q.entity_type },
        fetch: ({ take, orderBy, where }) =>
          trx.import_template.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<TemplateRow & Record<string, unknown>>>,
      });
      return { data: page.data.map(templateDto), page: page.page };
    });
  }

  async get(
    auth: AuthContext,
    id: string,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const row = await trx.import_template.findFirst({ where: { id, archived_at: null } });
      if (!row) throw problem.notFound('Template not found.');
      return { data: templateDto(row), version: row.version };
    });
  }

  private checkColumns(
    entity: EntityType,
    columns: ReadonlyArray<{ header: string; target: string | null }>,
  ): void {
    const errors: FieldError[] = [];
    const seen = new Set<string>();
    columns.forEach((c, i) => {
      if (!c.target) return;
      const known = c.target.startsWith(CUSTOM_PREFIX)
        ? entity === 'asset'
        : Boolean(specOf(entity, c.target));
      if (!known)
        errors.push({
          pointer: `/columns/${i}/target`,
          message: `"${c.target}" is not a field of ${entity} imports.`,
          code: 'invalid',
        });
      if (seen.has(c.target))
        errors.push({
          pointer: `/columns/${i}/target`,
          message: `"${c.target}" is mapped twice.`,
          code: 'duplicate',
        });
      seen.add(c.target);
    });
    if (errors.length > 0) throw problem.validation(errors);
  }

  async create(
    auth: AuthContext,
    body: TemplateCreate,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        let entity = body.entity_type as EntityType | undefined;
        let columns = body.columns;
        let options: Record<string, unknown> = body.options ?? {};
        if (body.from_import_id) {
          // M2-LOC-03 (ED-26): a scoped principal can only copy the mapping of its own imports
          const job = await trx.import_job.findFirst({
            where: {
              id: body.from_import_id,
              ...(isLocationScoped() ? { requested_by: auth.userId } : {}),
            },
          });
          if (!job)
            throw problem.validation([
              { pointer: '/from_import_id', message: 'No such import.', code: 'not-found' },
            ]);
          entity = job.entity_type as EntityType;
          const headers = (job.headers ?? []) as string[];
          const mapped = (
            (
              job.mapping as {
                columns?: Array<{ index: number; target: string | null; date_format?: string }>;
              }
            ).columns ?? []
          ).filter((c) => c.target);
          columns = mapped.map((c) => ({
            header: headers[c.index] ?? `Column ${c.index + 1}`,
            target: c.target,
            ...(c.date_format ? { date_format: c.date_format as never } : {}),
          }));
          options = { ...(job.options as object), ...options };
        }
        this.checkColumns(entity!, columns!);
        const clean = optionsPatchSchema.parse(options);
        const id = uuidv7();
        const row = await trx.import_template.create({
          data: {
            id,
            tenant_id: auth.tenantId,
            created_by: auth.userId,
            name: body.name,
            description: body.description ?? null,
            entity_type: entity!,
            columns: columns as never,
            options: clean as never,
          },
        });
        await this.record(trx, {
          entity: 'import_template',
          verb: 'created',
          id,
          version: row.version,
          before: null,
          after: { name: row.name, entity_type: row.entity_type, columns: (columns ?? []).length },
        });
        return { data: templateDto(row), version: row.version };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicate('A template named', '/name', body.name);
      throw err;
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: TemplateUpdate,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const row = await trx.import_template.findFirst({ where: { id, archived_at: null } });
        if (!row) throw problem.notFound('Template not found.');
        assertIfMatch(ifMatch, row.version);
        if (body.columns) this.checkColumns(row.entity_type as EntityType, body.columns);
        const data = {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.columns !== undefined ? { columns: body.columns as never } : {}),
          ...(body.options !== undefined
            ? { options: optionsPatchSchema.parse(body.options) as never }
            : {}),
          updated_by: auth.userId,
        };
        const res = await trx.import_template.updateMany({
          where: { id, version: row.version },
          data,
        });
        if (res.count === 0)
          return stalePrecondition(
            () => trx.import_template.findUnique({ where: { id } }),
            'Template',
          );
        const updated = (await trx.import_template.findUnique({ where: { id } }))!;
        await this.record(trx, {
          entity: 'import_template',
          verb: 'updated',
          id,
          version: updated.version,
          before: { name: row.name },
          after: { name: updated.name },
        });
        return { data: templateDto(updated), version: updated.version };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicate('A template named', '/name', body.name ?? '');
      throw err;
    }
  }

  async archive(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<void> {
    await this.tx(auth, async (trx) => {
      const row = await trx.import_template.findFirst({ where: { id, archived_at: null } });
      if (!row) throw problem.notFound('Template not found.');
      assertIfMatch(ifMatch, row.version);
      await trx.import_template.updateMany({
        where: { id, version: row.version },
        data: { archived_at: new Date(), updated_by: auth.userId },
      });
      await this.record(trx, {
        entity: 'import_template',
        verb: 'archived',
        id,
        version: row.version + 1,
        before: { name: row.name },
        after: null,
      });
    });
  }

  /** `POST /v1/imports/{id}/apply-template`. */
  async apply(
    auth: AuthContext,
    importId: string,
    templateId: string,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    const template = await this.tx(auth, async (trx) =>
      trx.import_template.findFirst({ where: { id: templateId, archived_at: null } }),
    );
    if (!template) throw problem.notFound('Template not found.');
    const job = await this.imports.get(auth, importId);
    if (job.data.entity_type !== template.entity_type) {
      throw problem.validation([
        {
          pointer: '/template_id',
          message: `This template is for ${template.entity_type} imports, the import is for ${String(job.data.entity_type)}.`,
          code: 'invalid',
        },
      ]);
    }
    return this.imports.applyColumns(
      auth,
      importId,
      template.columns as never,
      template.options as Record<string, unknown>,
    );
  }
}
