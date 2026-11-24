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
  IdempotencyRequired,
  type IfMatch,
  RequiredIfMatch,
  ZodValidationPipe,
  setEtag,
} from '../platform/index.js';
import { LoansService } from './loans.service.js';
import { PoolsService } from './pools.service.js';
import {
  addMemberSchema,
  assetIdParams,
  bulkMembersSchema,
  loanerCheckoutSchema,
  memberListSchema,
  poolCreateSchema,
  poolListSchema,
  poolUpdateSchema,
  quickLoanSchema,
  uuidParam,
  type AddMemberBody,
  type BulkMembersBody,
  type LoanerCheckoutBody,
  type MemberListQuery,
  type PoolCreate,
  type PoolListQuery,
  type PoolUpdate,
  type QuickLoanBody,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/** `/v1/loaner-pools` (tag Loaners): the pools, their members and the loans out of a pool. */
@Controller('loaner-pools')
export class LoanerPoolsController {
  constructor(
    private readonly pools: PoolsService,
    private readonly loans: LoansService,
  ) {}

  @Get()
  @RequirePermission('loaner:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(poolListSchema, 'query')) query: PoolListQuery,
  ) {
    return this.pools.list(auth, query);
  }

  @Post()
  @RequirePermission('loaner:manage')
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(poolCreateSchema)) body: PoolCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.pools.create(auth, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/loaner-pools/${String(data.id)}`);
    return data;
  }

  @Get(':id')
  @RequirePermission('loaner:read')
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.pools.get(auth, id);
    setEtag(reply, version);
    return data;
  }

  @Patch(':id')
  @RequirePermission('loaner:manage')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(poolUpdateSchema)) body: PoolUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.pools.update(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  @Delete(':id')
  @RequirePermission('loaner:manage')
  @HttpCode(204)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
  ): Promise<void> {
    await this.pools.archive(auth, id, ifMatch);
  }

  // ------------------------------------------------------------------------------- members

  @Get(':id/members')
  @RequirePermission('loaner:read')
  listMembers(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Query(new ZodValidationPipe(memberListSchema, 'query')) query: MemberListQuery,
  ) {
    return this.pools.listMembers(auth, id, query);
  }

  @Post(':id/members')
  @RequirePermission('loaner:manage')
  @HttpCode(201)
  async addMember(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(addMemberSchema)) body: AddMemberBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, created } = await this.pools.addMember(auth, id, body.asset_id);
    if (!created) void reply.status(200);
    return data;
  }

  // the two bulk routes first: `members/bulk-*` must not be read as `members/:asset_id`
  @Post(':id/members/bulk-add')
  @RequirePermission('loaner:manage')
  @HttpCode(200)
  bulkAdd(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(bulkMembersSchema)) body: BulkMembersBody,
  ) {
    return this.pools.bulkAdd(auth, id, body);
  }

  @Post(':id/members/bulk-remove')
  @RequirePermission('loaner:manage')
  @HttpCode(200)
  bulkRemove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(bulkMembersSchema)) body: BulkMembersBody,
  ) {
    return this.pools.bulkRemove(auth, id, body);
  }

  @Delete(':id/members/:asset_id')
  @RequirePermission('loaner:manage')
  @HttpCode(204)
  async removeMember(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodValidationPipe(assetIdParams, 'params')) params: { id: string; asset_id: string },
  ): Promise<void> {
    await this.pools.removeMember(auth, params.id, params.asset_id);
  }

  // --------------------------------------------------------------------------------- loans

  @Post(':id/checkout')
  @RequirePermission('loaner:checkout')
  @IdempotencyRequired()
  @HttpCode(201)
  async checkout(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(loanerCheckoutSchema)) body: LoanerCheckoutBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { asset, assignment, version } = await this.loans.checkoutOne(auth, id, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/assets/${String(asset.id)}/assignments`);
    return { asset, assignment };
  }

  @Post(':id/quick-checkout')
  @RequirePermission('loaner:checkout')
  @IdempotencyRequired()
  @HttpCode(200)
  quickCheckout(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(quickLoanSchema)) body: QuickLoanBody,
  ) {
    return this.loans.quickCheckout(auth, id, body);
  }
}
