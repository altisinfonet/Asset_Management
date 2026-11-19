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
import {
  type IfMatch,
  OptionalIfMatch,
  RequiredIfMatch,
  ZodValidationPipe,
  setEtag,
} from '../platform/index.js';
import { AssetsFacade } from './assets.facade.js';
import { SearchService } from './search.service.js';
import {
  assetCreateSchema,
  assetGetSchema,
  assetUpdateSchema,
  bulkIdsSchema,
  bulkMoveSchema,
  bulkUpdateSchema,
  cloneSchema,
  disposeSchema,
  historyListSchema,
  markFoundSchema,
  markLostSchema,
  moveSchema,
  scanResolveSchema,
  searchSchema,
  uuidParam,
  type AssetCreate,
  type AssetUpdate,
  type BulkMoveBody,
  type BulkUpdateBody,
  type CloneBody,
  type DisposeBody,
  type HistoryListQuery,
  type MarkFoundBody,
  type MarkLostBody,
  type MoveBody,
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

  // ---- M2 wave 1: moves (M2-LOC-02), disposal and lost/found (M2-LIFE-05), history (M2-LIFE-06)

  @Post('assets/bulk-move')
  @RequirePermission('asset:update')
  @HttpCode(200)
  bulkMove(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(bulkMoveSchema)) body: BulkMoveBody,
  ) {
    return this.assets.bulkMove(auth, body);
  }

  @Post('assets/:id/move')
  @RequirePermission('asset:update')
  @HttpCode(200)
  async move(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @OptionalIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(moveSchema)) body: MoveBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { asset, version } = await this.assets.move(auth, id, ifMatch, body);
    setEtag(reply, version);
    return asset;
  }

  @Post('assets/:id/dispose')
  @RequirePermission('asset:delete')
  @HttpCode(200)
  async dispose(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @OptionalIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(disposeSchema)) body: DisposeBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { asset, version } = await this.assets.dispose(auth, id, ifMatch, body);
    setEtag(reply, version);
    return asset;
  }

  @Post('assets/:id/mark-lost')
  @RequirePermission('asset:update')
  @HttpCode(200)
  async markLost(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @OptionalIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(markLostSchema.default({}))) body: MarkLostBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { asset, version } = await this.assets.markLost(auth, id, ifMatch, body);
    setEtag(reply, version);
    return asset;
  }

  @Post('assets/:id/mark-found')
  @RequirePermission('asset:update')
  @HttpCode(200)
  async markFound(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @OptionalIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(markFoundSchema.default({}))) body: MarkFoundBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { asset, version } = await this.assets.markFound(auth, id, ifMatch, body);
    setEtag(reply, version);
    return asset;
  }

  @Get('assets/:id/history')
  @RequirePermission('asset:read')
  history(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Query(new ZodValidationPipe(historyListSchema, 'query')) query: HistoryListQuery,
  ) {
    return this.assets.history(auth, id, query);
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
    // A scan result is for the person who scanned: never cached by a shared proxy or the browser.
    void reply.header('cache-control', 'private, no-store');
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
