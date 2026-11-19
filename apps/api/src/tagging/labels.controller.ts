import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth, RequirePermission, type AuthContext } from '../auth/index.js';
import {
  IdempotencyRequired,
  type IfMatch,
  RequiredIfMatch,
  ZodValidationPipe,
  setEtag,
} from '../platform/index.js';
import { LabelsService } from './labels.service.js';
import {
  labelBatchCreateSchema,
  labelBatchListSchema,
  labelTemplateUpdateSchema,
  uuidParam,
  type LabelBatchCreate,
  type LabelBatchListQuery,
  type LabelTemplateUpdate,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/**
 * `/v1/labels` (tag Labels): the fixed templates (read, plus calibration of the sheet offsets) and
 * label batches. `POST /labels/batches` answers 202: the PDF is rendered by the worker; poll
 * `GET /labels/batches/{id}` until `ready`, then follow its short-lived `download_url`.
 */
@Controller('labels')
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get('templates')
  @RequirePermission('asset:label')
  listTemplates(@CurrentAuth() auth: AuthContext) {
    return this.labels.listTemplates(auth);
  }

  @Get('templates/:id')
  @RequirePermission('asset:label')
  async getTemplate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.labels.getTemplate(auth, id);
    setEtag(reply, version);
    return data;
  }

  @Patch('templates/:id')
  @RequirePermission('catalog:manage')
  async calibrateTemplate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(labelTemplateUpdateSchema)) body: LabelTemplateUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.labels.calibrateTemplate(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  @Post('batches')
  @RequirePermission('asset:label')
  @IdempotencyRequired()
  @HttpCode(202)
  async createBatch(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(labelBatchCreateSchema)) body: LabelBatchCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, id } = await this.labels.createBatch(auth, body);
    void reply.header('location', `/v1/labels/batches/${id}`);
    return data;
  }

  @Get('batches')
  @RequirePermission('asset:label')
  listBatches(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(labelBatchListSchema, 'query')) query: LabelBatchListQuery,
  ) {
    return this.labels.listBatches(auth, query);
  }

  @Get('batches/:id')
  @RequirePermission('asset:label')
  getBatch(@CurrentAuth() auth: AuthContext, @Param('id', idParam()) id: string) {
    return this.labels.getBatch(auth, id);
  }
}
