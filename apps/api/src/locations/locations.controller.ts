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
import { LocationsService } from './locations.service.js';
import {
  locationCreateSchema,
  locationListSchema,
  locationUpdateSchema,
  uuidParam,
  type LocationCreate,
  type LocationListQuery,
  type LocationUpdate,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/** `/v1/locations` (tag Locations). Contract: docs/engineering/openapi.yaml. */
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @RequirePermission('location:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(locationListSchema, 'query')) query: LocationListQuery,
  ) {
    return this.locations.list(auth, query);
  }

  @Post()
  @RequirePermission('location:manage')
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(locationCreateSchema)) body: LocationCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.locations.create(auth, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/locations/${String(data.id)}`);
    return data;
  }

  @Get(':id')
  @RequirePermission('location:read')
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.locations.get(auth, id);
    setEtag(reply, version);
    return data;
  }

  @Patch(':id')
  @RequirePermission('location:manage')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(locationUpdateSchema)) body: LocationUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.locations.update(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  @Delete(':id')
  @RequirePermission('location:manage')
  @HttpCode(204)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
  ): Promise<void> {
    await this.locations.archive(auth, id, ifMatch);
  }
}
