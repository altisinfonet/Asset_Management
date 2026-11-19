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
import { AccessoriesService } from './accessories.service.js';
import { ConsumablesService } from './consumables.service.js';
import {
  accessoryAssignmentsListSchema,
  accessoryCheckinSchema,
  accessoryCheckoutSchema,
  accessoryCreateSchema,
  accessoryListSchema,
  accessoryUpdateSchema,
  consumableCreateSchema,
  consumableListSchema,
  consumableUpdateSchema,
  personStockMovementListSchema,
  stockMovementCreateSchema,
  stockMovementListSchema,
  uuidParam,
  type AccessoryAssignmentsQuery,
  type AccessoryCheckinBody,
  type AccessoryCheckoutBody,
  type AccessoryCreate,
  type AccessoryListQuery,
  type AccessoryUpdate,
  type ConsumableCreate,
  type ConsumableListQuery,
  type ConsumableUpdate,
  type PersonStockMovementListQuery,
  type StockMovementCreate,
  type StockMovementListQuery,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/** `/v1/accessories` (tag Accessories). */
@Controller('accessories')
export class AccessoriesController {
  constructor(private readonly accessories: AccessoriesService) {}

  @Get()
  @RequirePermission('accessory:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(accessoryListSchema, 'query')) query: AccessoryListQuery,
  ) {
    return this.accessories.list(auth, query);
  }

  @Post()
  @RequirePermission('accessory:manage')
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(accessoryCreateSchema)) body: AccessoryCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.accessories.create(auth, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/accessories/${data.id}`);
    return data;
  }

  @Get(':id')
  @RequirePermission('accessory:read')
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.accessories.get(auth, id);
    setEtag(reply, version);
    return data;
  }

  @Patch(':id')
  @RequirePermission('accessory:manage')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(accessoryUpdateSchema)) body: AccessoryUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.accessories.update(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  @Delete(':id')
  @RequirePermission('accessory:manage')
  @HttpCode(204)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
  ): Promise<void> {
    await this.accessories.archive(auth, id, ifMatch);
  }

  @Post(':id/checkout')
  @RequirePermission('accessory:checkout')
  @IdempotencyRequired()
  @HttpCode(201)
  async checkout(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(accessoryCheckoutSchema)) body: AccessoryCheckoutBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { assignment } = await this.accessories.checkout(auth, id, body);
    void reply.header('location', `/v1/accessories/${id}/assignments`);
    return assignment;
  }

  @Post(':id/checkin')
  @RequirePermission('accessory:checkout')
  @IdempotencyRequired()
  @HttpCode(200)
  async checkin(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(accessoryCheckinSchema)) body: AccessoryCheckinBody,
  ) {
    const { assignment } = await this.accessories.checkin(auth, id, body);
    return assignment;
  }

  @Get(':id/assignments')
  @RequirePermission('accessory:read')
  assignments(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Query(new ZodValidationPipe(accessoryAssignmentsListSchema, 'query'))
    query: AccessoryAssignmentsQuery,
  ) {
    return this.accessories.assignments(auth, id, query);
  }
}

/** `/v1/consumables` (tag Consumables) and the per-person consume log. */
@Controller('consumables')
export class ConsumablesController {
  constructor(private readonly consumables: ConsumablesService) {}

  @Get()
  @RequirePermission('consumable:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(consumableListSchema, 'query')) query: ConsumableListQuery,
  ) {
    return this.consumables.list(auth, query);
  }

  @Post()
  @RequirePermission('consumable:manage')
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(consumableCreateSchema)) body: ConsumableCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.consumables.create(auth, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/consumables/${data.id}`);
    return data;
  }

  @Get(':id')
  @RequirePermission('consumable:read')
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.consumables.get(auth, id);
    setEtag(reply, version);
    return data;
  }

  @Patch(':id')
  @RequirePermission('consumable:manage')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(consumableUpdateSchema)) body: ConsumableUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.consumables.update(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  @Delete(':id')
  @RequirePermission('consumable:manage')
  @HttpCode(204)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
  ): Promise<void> {
    await this.consumables.archive(auth, id, ifMatch);
  }

  @Get(':id/movements')
  @RequirePermission('consumable:read')
  movements(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Query(new ZodValidationPipe(stockMovementListSchema, 'query')) query: StockMovementListQuery,
  ) {
    return this.consumables.movements(auth, id, query);
  }

  @Post(':id/movements')
  @RequirePermission('consumable:adjust')
  @IdempotencyRequired()
  @HttpCode(201)
  async createMovement(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(stockMovementCreateSchema)) body: StockMovementCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const movement = await this.consumables.createMovement(auth, id, body);
    void reply.header('location', `/v1/consumables/${id}/movements`);
    return movement;
  }
}

/** `GET /v1/people/{id}/stock-movements` (tag Consumables): the consume log of a person. */
@Controller('people')
export class PersonStockController {
  constructor(private readonly consumables: ConsumablesService) {}

  @Get(':id/stock-movements')
  @RequirePermission('consumable:read')
  personMovements(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Query(new ZodValidationPipe(personStockMovementListSchema, 'query'))
    query: PersonStockMovementListQuery,
  ) {
    return this.consumables.personMovements(auth, id, query);
  }
}
