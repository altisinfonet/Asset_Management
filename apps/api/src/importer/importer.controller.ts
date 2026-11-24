import { Readable } from 'node:stream';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth, RequirePermission, type AuthContext } from '../auth/index.js';
import { csvRow } from '../exports/index.js';
import {
  IdempotencyRequired,
  type IfMatch,
  RequiredIfMatch,
  ZodValidationPipe,
  problem,
  setEtag,
} from '../platform/index.js';
import { ImportsService } from './importer.service.js';
import { ImportTemplatesService } from './templates.service.js';
import { PRESETS, dictionary, presetOf } from './presets.js';
import { templateCsv, templateOf, templateXlsx } from './template-files.js';
import { TenancyService } from '../tenancy/index.js';
import {
  applyTemplateSchema,
  importAnalyzeSchema,
  importCommitSchema,
  importCreateSchema,
  importListSchema,
  importRowsSchema,
  importUpdateSchema,
  importValuesSchema,
  presetFileSchema,
  templateCreateSchema,
  templateListSchema,
  templateUpdateSchema,
  uuidParam,
  type ImportAnalyze,
  type ImportCommit,
  type ImportCreate,
  type ImportListQuery,
  type ImportRowsQuery,
  type ImportUpdate,
  type ImportValuesQuery,
  type TemplateCreate,
  type TemplateListQuery,
  type TemplateUpdate,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** `/v1/imports` (tag Imports): the wizard's API. Contract: docs/engineering/openapi.yaml. */
@Controller('imports')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly templates: ImportTemplatesService,
    private readonly tenancy: TenancyService,
  ) {}

  // ---- presets and template files (static routes first)

  @Get('presets')
  @RequirePermission('import:read')
  presets() {
    return {
      data: PRESETS.map((p) => ({
        key: p.key,
        label: p.label,
        description: p.description,
        entity_type: p.entity_type,
        source: p.source,
        notes: p.notes,
        sets_up: p.setup
          ? { category: p.setup.category, custom_fields: p.setup.customFields.map((f) => f.key) }
          : null,
        columns: dictionary(p),
      })),
    };
  }

  @Get('presets/:key/template')
  @RequirePermission('import:read')
  async presetFile(
    @CurrentAuth() auth: AuthContext,
    @Param('key') key: string,
    @Query(new ZodValidationPipe(presetFileSchema, 'query')) q: { format: 'csv' | 'xlsx' },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const preset = presetOf(key);
    if (!preset) throw problem.notFound('No such preset.');
    const custom =
      preset.entity_type === 'asset'
        ? await this.tenancy.withTenantTx(
            { tenantId: auth.tenantId, actorId: auth.principalId },
            async (trx) =>
              (
                await trx.custom_field_def.findMany({
                  where: { archived_at: null },
                  select: { key: true },
                  orderBy: [{ position: 'asc' }, { key: 'asc' }],
                })
              ).map((r) => r.key),
          )
        : [];
    const content = templateOf(preset, [...new Set(custom)]);
    const name = `${preset.key.replace(/[^a-z0-9_-]/gi, '-')}-template.${q.format}`;
    void reply.header('cache-control', 'private, no-store');
    void reply.header('x-content-type-options', 'nosniff');
    const body = q.format === 'xlsx' ? templateXlsx(preset, content) : templateCsv(content);
    return new StreamableFile(body, {
      type: q.format === 'xlsx' ? XLSX : 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${name}"`,
    });
  }

  // ---- jobs

  @Get()
  @RequirePermission('import:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(importListSchema, 'query')) query: ImportListQuery,
  ) {
    return this.imports.list(auth, query);
  }

  @Post()
  @RequirePermission('import:run')
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(importCreateSchema)) body: ImportCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const created = await this.imports.create(auth, body);
    void reply.header('location', `/v1/imports/${String(created.id)}`);
    setEtag(reply, 1);
    return created;
  }

  @Get(':id')
  @RequirePermission('import:read')
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.imports.get(auth, id);
    setEtag(reply, version);
    return data;
  }

  @Patch(':id')
  @RequirePermission('import:run')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(importUpdateSchema)) body: ImportUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.imports.update(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  @Post(':id/analyze')
  @RequirePermission('import:run')
  @HttpCode(202)
  async analyze(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(importAnalyzeSchema.default({}))) body: ImportAnalyze,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const job = await this.imports.analyze(auth, id, body);
    void reply.header('location', `/v1/imports/${id}`);
    void reply.header('retry-after', '2');
    return job;
  }

  @Post(':id/apply-template')
  @RequirePermission('import:run')
  @HttpCode(200)
  async applyTemplate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(applyTemplateSchema)) body: { template_id: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.templates.apply(auth, id, body.template_id);
    setEtag(reply, version);
    return data;
  }

  @Get(':id/values')
  @RequirePermission('import:run')
  values(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Query(new ZodValidationPipe(importValuesSchema, 'query')) q: ImportValuesQuery,
  ) {
    return this.imports.values(auth, id, q);
  }

  @Post(':id/dry-run')
  @RequirePermission('import:run')
  @HttpCode(202)
  async dryRun(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const job = await this.imports.dryRun(auth, id);
    void reply.header('location', `/v1/imports/${id}`);
    void reply.header('retry-after', '2');
    return job;
  }

  @Get(':id/rows')
  @RequirePermission('import:run')
  rows(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Query(new ZodValidationPipe(importRowsSchema, 'query')) q: ImportRowsQuery,
  ) {
    return this.imports.rows(auth, id, q);
  }

  /** The error report: one CSV line per row with problems, the original cells included, formula-guarded. */
  @Get(':id/errors.csv')
  @RequirePermission('import:run')
  async errorReport(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.imports.assertExists(auth, id);
    const imports = this.imports;
    async function* lines(): AsyncGenerator<string> {
      let after = 0;
      let wroteHeader = false;
      for (;;) {
        const page = await imports.errorPage(auth, id, after, 1000);
        if (!page) return;
        if (!wroteHeader) {
          wroteHeader = true;
          yield `\uFEFF${csvRow(['Row', 'Line', 'Fields', 'Problems', 'Warnings', ...page.headers])}\r\n`;
        }
        if (page.rows.length === 0) return;
        for (const r of page.rows) {
          const fields = [...new Set(r.issues.map((i) => i.field).filter(Boolean))].join(', ');
          const pad = page.headers.map((_, i) => r.raw[i] ?? '');
          yield `${csvRow([r.row_no, r.line_no, fields, r.issues.map((i) => i.message).join(' | '), r.warnings.map((w) => w.message).join(' | '), ...pad])}\r\n`;
        }
        after = page.rows[page.rows.length - 1]!.row_no;
        if (page.rows.length < 1000) return;
      }
    }
    void reply.header('cache-control', 'private, no-store');
    void reply.header('x-content-type-options', 'nosniff');
    return new StreamableFile(Readable.from(lines()), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="import-${id.slice(0, 8)}-errors.csv"`,
    });
  }

  @Post(':id/commit')
  @RequirePermission('import:run')
  @IdempotencyRequired()
  @HttpCode(202)
  async commit(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(importCommitSchema)) body: ImportCommit,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const job = await this.imports.commit(auth, id, body);
    void reply.header('location', `/v1/imports/${id}`);
    void reply.header('retry-after', '2');
    return job;
  }

  @Post(':id/cancel')
  @RequirePermission('import:run')
  @HttpCode(200)
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', idParam()) id: string) {
    return this.imports.cancel(auth, id);
  }
}

/** `/v1/import-templates` (tag Imports): saved column mappings. */
@Controller('import-templates')
export class ImportTemplatesController {
  constructor(private readonly templates: ImportTemplatesService) {}

  @Get()
  @RequirePermission('import:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(templateListSchema, 'query')) q: TemplateListQuery,
  ) {
    return this.templates.list(auth, q);
  }

  @Post()
  @RequirePermission('import:run')
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(templateCreateSchema)) body: TemplateCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.templates.create(auth, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/import-templates/${String(data.id)}`);
    return data;
  }

  @Get(':id')
  @RequirePermission('import:read')
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.templates.get(auth, id);
    setEtag(reply, version);
    return data;
  }

  @Patch(':id')
  @RequirePermission('import:run')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(templateUpdateSchema)) body: TemplateUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.templates.update(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  @Delete(':id')
  @RequirePermission('import:run')
  @HttpCode(204)
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
  ) {
    await this.templates.archive(auth, id, ifMatch);
  }
}
