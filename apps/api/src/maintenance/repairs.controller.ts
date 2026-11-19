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
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth, RequirePermission, type AuthContext } from '../auth/index.js';
import { type IfMatch, RequiredIfMatch, ZodValidationPipe, setEtag } from '../platform/index.js';
import { RepairsService } from './repairs.service.js';
import {
  repairCompleteSchema,
  repairCreateSchema,
  repairListSchema,
  repairUpdateSchema,
  uuidParam,
  type RepairComplete,
  type RepairCreate,
  type RepairListQuery,
  type RepairUpdate,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/** `/v1/repairs` (tag Repairs) and the repair totals of an asset. Contract: docs/engineering/openapi.yaml. */
@Controller()
export class RepairsController {
  constructor(private readonly repairs: RepairsService) {}

  @Get('repairs')
  @RequirePermission('repair:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(repairListSchema, 'query')) query: RepairListQuery,
  ) {
    return this.repairs.list(auth, query);
  }

  @Post('repairs')
  @RequirePermission('repair:manage')
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(repairCreateSchema)) body: RepairCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.repairs.create(auth, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/repairs/${String(data.id)}`);
    return data;
  }

  @Get('repairs/:id')
  @RequirePermission('repair:read')
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.repairs.get(auth, id);
    setEtag(reply, version);
    return data;
  }

  @Patch('repairs/:id')
  @RequirePermission('repair:manage')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(repairUpdateSchema)) body: RepairUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.repairs.update(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  @Delete('repairs/:id')
  @RequirePermission('repair:manage')
  @HttpCode(204)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
  ): Promise<void> {
    await this.repairs.archive(auth, id, ifMatch);
  }

  @Post('repairs/:id/complete')
  @RequirePermission('repair:manage')
  @HttpCode(200)
  async complete(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(repairCompleteSchema.default({}))) body: RepairComplete,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.repairs.complete(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  @Get('assets/:id/repair-summary')
  @RequirePermission('repair:read')
  summary(@CurrentAuth() auth: AuthContext, @Param('id', idParam()) id: string) {
    return this.repairs.summary(auth, id);
  }
}
