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
import { DepartmentsService } from './departments.service.js';
import {
  departmentArchiveSchema,
  departmentCreateSchema,
  departmentListSchema,
  departmentUpdateSchema,
  uuidParam,
  type DepartmentArchiveQuery,
  type DepartmentCreate,
  type DepartmentListQuery,
  type DepartmentUpdate,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/** `/v1/departments` (tag Departments). Contract: docs/engineering/openapi.yaml. */
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermission('department:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(departmentListSchema, 'query')) query: DepartmentListQuery,
  ) {
    return this.departments.list(auth, query);
  }

  @Post()
  @RequirePermission('department:manage')
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(departmentCreateSchema)) body: DepartmentCreate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.departments.create(auth, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/departments/${String(data.id)}`);
    return data;
  }

  @Get(':id')
  @RequirePermission('department:read')
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.departments.get(auth, id);
    setEtag(reply, version);
    return data;
  }

  @Patch(':id')
  @RequirePermission('department:manage')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(departmentUpdateSchema)) body: DepartmentUpdate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.departments.update(auth, id, ifMatch, body);
    setEtag(reply, version);
    return data;
  }

  @Delete(':id')
  @RequirePermission('department:manage')
  @HttpCode(204)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Query(new ZodValidationPipe(departmentArchiveSchema, 'query')) query: DepartmentArchiveQuery,
  ): Promise<void> {
    await this.departments.archive(auth, id, ifMatch, query.reassign_to);
  }
}
