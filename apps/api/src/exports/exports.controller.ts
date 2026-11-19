import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth, RequirePermission, type AuthContext } from '../auth/index.js';
import { ZodValidationPipe } from '../platform/index.js';
import { ExportsService } from './exports.service.js';
import {
  exportCreateSchema,
  exportListSchema,
  uuidParam,
  type ExportCreate,
  type ExportListQuery,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/** `/v1/exports` (tag Exports). Contract: docs/engineering/openapi.yaml. */
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post()
  @RequirePermission('export:run')
  @HttpCode(202)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(exportCreateSchema)) body: ExportCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const created = await this.exports.create(auth, body);
    void reply.header('location', `/v1/exports/${String(created.id)}`);
    // The worker takes a few seconds for a big list: poll the Location.
    void reply.header('retry-after', '2');
    return created;
  }

  @Get()
  @RequirePermission('export:run')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(exportListSchema, 'query')) query: ExportListQuery,
  ) {
    return this.exports.list(auth, query);
  }

  @Get(':id')
  @RequirePermission('export:run')
  get(@CurrentAuth() auth: AuthContext, @Param('id', idParam()) id: string) {
    return this.exports.get(auth, id);
  }
}
