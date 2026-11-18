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
import { AssetsFacade } from './assets.facade.js';
import { SearchService } from './search.service.js';
import {
  assetCreateSchema,
  assetGetSchema,
  assetUpdateSchema,
  bulkIdsSchema,
  bulkUpdateSchema,
  cloneSchema,
  scanResolveSchema,
  searchSchema,
  uuidParam,
  type AssetCreate,
  type AssetUpdate,
  type BulkUpdateBody,
  type CloneBody,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/** `/v1/assets`, `/v1/scan/resolve` (tag Assets). Contract: docs/engineering/openapi.yaml. */
@Controller()
export class AssetsController {
  constructor(private readonly assets: AssetsFacade) {}

  @Get('assets')
  @RequirePermission('asset:read')
  list(@CurrentAuth() auth: AuthContext, @Query() query: Record<string, unknown>) {
    return this.assets.list(auth, query);
  }

  @Post('assets')
  @RequirePermission('asset:create')
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(assetCreateSchema)) body: AssetCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { asset, version } = await this.assets.create(auth, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/assets/${asset.id}`);
    return asset;
  }

  // The fixed-segment POST routes come before `:id` routes only for readability; Fastify's router
  // matches static segments first either way.
  @Post('assets/bulk-update')
  @RequirePermission('asset:update')
  @HttpCode(200)
  bulkUpdate(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(bulkUpdateSchema)) body: BulkUpdateBody,
  ) {
    return this.assets.bulk(auth, 'update', body.ids, body.changes);
  }

  @Post('assets/bulk-archive')
  @RequirePermission('asset:delete')
  @HttpCode(200)
  bulkArchive(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: { ids: string[] },
  ) {
    return this.assets.bulk(auth, 'archive', body.ids);
  }

  @Post('assets/bulk-restore')
  @RequirePermission('asset:delete')
  @HttpCode(200)
  bulkRestore(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: { ids: string[] },
  ) {
    return this.assets.bulk(auth, 'restore', body.ids);
  }

  @Get('assets/:id')
  @RequirePermission('asset:read')
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Query(new ZodValidationPipe(assetGetSchema, 'query')) query: { expand?: never[] },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { asset, version } = await this.assets.get(auth, id, query.expand);
    setEtag(reply, version);
    return asset;
  }

  @Patch('assets/:id')
  @RequirePermission('asset:update')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(assetUpdateSchema)) body: AssetUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { asset, version } = await this.assets.update(auth, id, ifMatch, body);
    setEtag(reply, version);
    return asset;
  }

  @Delete('assets/:id')
  @RequirePermission('asset:delete')
  @HttpCode(204)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
  ): Promise<void> {
    await this.assets.archive(auth, id, ifMatch);
  }

  @Post('assets/:id/restore')
  @RequirePermission('asset:delete')
  @HttpCode(200)
  async restore(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { asset, version } = await this.assets.restore(auth, id, ifMatch);
    setEtag(reply, version);
    return asset;
  }

  @Post('assets/:id/clone')
  @RequirePermission('asset:create')
  @HttpCode(201)
  clone(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(cloneSchema)) body: CloneBody,
  ) {
    return this.assets.clone(auth, id, body);
  }

  @Get('scan/resolve')
  @RequirePermission('asset:read')
  async resolve(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(scanResolveSchema, 'query')) query: { code: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.assets.resolveScan(auth, query.code);
    setEtag(reply, version);
    return data;
  }
}

/** `GET /v1/search` (tag Search). */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RequirePermission('search:read')
  run(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(searchSchema, 'query'))
    query: { q: string; types?: string[]; limit: number },
  ) {
    return this.search.search(auth, query);
  }
}
