import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth, RequirePermission, type AuthContext } from '../auth/index.js';
import {
  IdempotencyRequired,
  type IfMatch,
  OptionalIfMatch,
  ZodValidationPipe,
  setEtag,
} from '../platform/index.js';
import { CustodyService } from './custody.service.js';
import {
  assetAssignmentsListSchema,
  checkinSchema,
  checkoutSchema,
  personAssignmentsListSchema,
  personHistoryListSchema,
  transferSchema,
  uuidParam,
  type AssetAssignmentsQuery,
  type CheckinBody,
  type CheckoutBody,
  type PersonAssignmentsQuery,
  type PersonHistoryQuery,
  type TransferBody,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/**
 * Custody endpoints (tag Custody) and the assignment / history lists of assets and people.
 * Check-out, check-in and transfer need an `Idempotency-Key`, accept `If-Match` on the asset and
 * answer `{asset, assignment}` with the asset's new ETag (ED-13).
 */
@Controller()
export class CustodyController {
  constructor(private readonly custody: CustodyService) {}

  @Post('assets/:id/checkout')
  @RequirePermission('asset:checkout')
  @IdempotencyRequired()
  @HttpCode(201)
  async checkout(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @OptionalIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(checkoutSchema)) body: CheckoutBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { asset, assignment, version } = await this.custody.checkout(auth, id, ifMatch, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/assets/${id}/assignments`);
    return { asset, assignment };
  }

  @Post('assets/:id/checkin')
  @RequirePermission('asset:checkin')
  @IdempotencyRequired()
  @HttpCode(200)
  async checkin(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @OptionalIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(checkinSchema.default({}))) body: CheckinBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { asset, assignment, version } = await this.custody.checkin(auth, id, ifMatch, body);
    setEtag(reply, version);
    return { asset, assignment };
  }

  @Post('assets/:id/transfer')
  @RequirePermission('asset:transfer')
  @IdempotencyRequired()
  @HttpCode(201)
  async transfer(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @OptionalIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(transferSchema)) body: TransferBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { asset, assignment, transfer, version } = await this.custody.transfer(
      auth,
      id,
      ifMatch,
      body,
    );
    setEtag(reply, version);
    void reply.header('location', `/v1/assets/${id}/assignments`);
    return { asset, transfer, assignment };
  }

  @Get('assets/:id/assignments')
  @RequirePermission('asset:read')
  assetAssignments(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Query(new ZodValidationPipe(assetAssignmentsListSchema, 'query')) query: AssetAssignmentsQuery,
  ) {
    return this.custody.assetAssignments(auth, id, query);
  }

  @Get('people/:id/assignments')
  @RequirePermission('person:read')
  personAssignments(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Query(new ZodValidationPipe(personAssignmentsListSchema, 'query'))
    query: PersonAssignmentsQuery,
  ) {
    return this.custody.personAssignments(auth, id, query);
  }

  @Get('people/:id/history')
  @RequirePermission('person:read')
  personHistory(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Query(new ZodValidationPipe(personHistoryListSchema, 'query')) query: PersonHistoryQuery,
  ) {
    return this.custody.personHistory(auth, id, query);
  }
}
