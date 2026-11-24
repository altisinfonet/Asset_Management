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
import { PeopleService } from './people.service.js';
import {
  personCreateSchema,
  personLinkUserSchema,
  personListSchema,
  personUpdateSchema,
  uuidParam,
  type PersonCreate,
  type PersonLinkUser,
  type PersonListQuery,
  type PersonUpdate,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/** `/v1/people` (tag People). The per-person assignment and history lists live in the lifecycle module. */
@Controller('people')
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get()
  @RequirePermission('person:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(personListSchema, 'query')) query: PersonListQuery,
  ) {
    return this.people.list(auth, query);
  }

  @Post()
  @RequirePermission('person:manage')
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(personCreateSchema)) body: PersonCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.people.create(auth, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/people/${String(data.id)}`);
    return data;
  }

  @Get(':id')
  @RequirePermission('person:read')
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.people.get(auth, id);
    setEtag(reply, version);
    return data;
  }

  @Patch(':id')
  @RequirePermission('person:manage')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(personUpdateSchema)) body: PersonUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.people.update(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  /** M2-USR-03 (ED-22): Administrators only (`user:manage`): it changes who a login account is. */
  @Post(':id/link-user')
  @RequirePermission('user:manage')
  @HttpCode(200)
  async linkUser(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @OptionalIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(personLinkUserSchema)) body: PersonLinkUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.people.linkUser(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  @Delete(':id/link-user')
  @RequirePermission('user:manage')
  @HttpCode(200)
  async unlinkUser(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @OptionalIfMatch() ifMatch: IfMatch,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.people.unlinkUser(auth, id, ifMatch);
    setEtag(reply, version);
    return data;
  }

  @Delete(':id')
  @RequirePermission('person:manage')
  @HttpCode(204)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
  ): Promise<void> {
    await this.people.archive(auth, id, ifMatch);
  }
}
