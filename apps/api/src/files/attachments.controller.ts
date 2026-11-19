import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth, RequirePermission, type AuthContext } from '../auth/index.js';
import { type IfMatch, RequiredIfMatch, ZodValidationPipe, setEtag } from '../platform/index.js';
import { AttachmentsService } from './attachments.service.js';
import { FilesSettingsService } from './files-settings.service.js';
import {
  type AttachmentCreate,
  type AttachmentListQuery,
  attachmentCreateSchema,
  attachmentListSchema,
  uuidParam,
} from './schemas.js';
import { type FilesSettingsInput, filesSettingsSchema } from './settings.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/** `/v1/attachments` (tag Attachments). Contract: docs/engineering/openapi.yaml. */
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  @RequirePermission('attachment:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(attachmentListSchema, 'query')) query: AttachmentListQuery,
  ) {
    return this.attachments.list(auth, query);
  }

  @Post()
  @RequirePermission('attachment:write')
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(attachmentCreateSchema)) body: AttachmentCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const created = await this.attachments.create(auth, body);
    void reply.header('location', `/v1/attachments/${created.attachment.id}`);
    return created;
  }

  @Get(':id')
  @RequirePermission('attachment:read')
  get(@CurrentAuth() auth: AuthContext, @Param('id', idParam()) id: string) {
    return this.attachments.get(auth, id);
  }

  @Post(':id/complete')
  @RequirePermission('attachment:write')
  @HttpCode(200)
  complete(@CurrentAuth() auth: AuthContext, @Param('id', idParam()) id: string) {
    return this.attachments.complete(auth, id);
  }

  @Delete(':id')
  @RequirePermission('attachment:write')
  @HttpCode(204)
  async archive(@CurrentAuth() auth: AuthContext, @Param('id', idParam()) id: string) {
    await this.attachments.archive(auth, id);
  }
}

/** `/v1/settings/files` (tag Settings): upload cap and EXIF stripping of the organisation. */
@Controller('settings/files')
export class FilesSettingsController {
  constructor(private readonly settings: FilesSettingsService) {}

  @Get()
  @RequirePermission('catalog:read')
  async get(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) reply: FastifyReply) {
    const { data, version } = await this.settings.get(auth);
    setEtag(reply, version);
    return data;
  }

  @Put()
  @RequirePermission('catalog:manage')
  async put(
    @CurrentAuth() auth: AuthContext,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(filesSettingsSchema)) body: FilesSettingsInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.settings.put(auth, ifMatch, body);
    setEtag(reply, version);
    return data;
  }
}
