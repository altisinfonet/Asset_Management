import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth, RequirePermission, SelfService, type AuthContext } from '../auth/index.js';
import { type IfMatch, RequiredIfMatch, ZodValidationPipe, setEtag } from '../platform/index.js';
import {
  uuidParam,
  viewCreateSchema,
  viewListSchema,
  viewShareSchema,
  viewUpdateSchema,
  type ViewCreate,
  type ViewListQuery,
  type ViewShare,
  type ViewUpdate,
} from './schemas.js';
import { ViewsService } from './views.service.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/**
 * `/v1/saved-views` (tag Views). Own views are self-service (a signed-in browser session); sharing a
 * view with the whole organisation needs `view:share`.
 */
@Controller('saved-views')
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  @Get()
  @SelfService()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(viewListSchema, 'query')) query: ViewListQuery,
  ) {
    return this.views.list(auth, query);
  }

  @Post()
  @SelfService()
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(viewCreateSchema)) body: ViewCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.views.create(auth, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/saved-views/${String(data.id)}`);
    return data;
  }

  @Get(':id')
  @SelfService()
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.views.get(auth, id);
    setEtag(reply, version);
    return data;
  }

  @Patch(':id')
  @SelfService()
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(viewUpdateSchema)) body: ViewUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.views.update(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  @Delete(':id')
  @SelfService()
  @HttpCode(204)
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
  ): Promise<void> {
    await this.views.delete(auth, id, ifMatch);
  }

  @Put(':id/sharing')
  @RequirePermission('view:share')
  async share(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(viewShareSchema)) body: ViewShare,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.views.share(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }
}
