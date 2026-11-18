import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  type Type,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ZodType } from 'zod';
import { CurrentAuth, RequirePermission, type AuthContext } from '../auth/index.js';
import { type IfMatch, RequiredIfMatch, ZodValidationPipe, setEtag } from '../platform/index.js';
import { AssetTagService } from './asset-tags.js';
import {
  CategoriesService,
  CustomFieldsService,
  ManufacturersService,
  ModelsService,
  StatusLabelsService,
  VendorsService,
} from './catalog-services.js';
import {
  assetTagTemplateSchema,
  categoryCreateSchema,
  categoryListSchema,
  categoryUpdateSchema,
  customFieldCreateSchema,
  customFieldListSchema,
  customFieldUpdateSchema,
  manufacturerCreateSchema,
  manufacturerUpdateSchema,
  modelCreateSchema,
  modelListSchema,
  modelUpdateSchema,
  nameListSchema,
  statusLabelCreateSchema,
  statusLabelListSchema,
  statusLabelUpdateSchema,
  uuidParam,
  vendorCreateSchema,
  vendorUpdateSchema,
  type AssetTagTemplate,
} from './schemas.js';

/** The CRUD surface the generated controllers need from a catalog service (params are contravariant). */
interface CrudService {
  list(auth: AuthContext, query: never): Promise<unknown>;
  get(auth: AuthContext, id: string): Promise<{ data: Record<string, unknown>; version: number }>;
  create(
    auth: AuthContext,
    body: never,
  ): Promise<{ data: Record<string, unknown>; version: number }>;
  update(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: never,
  ): Promise<{ data: Record<string, unknown>; version: number }>;
  archive(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<void>;
}

interface CrudOptions {
  /** Route prefix under /v1, e.g. `categories`. */
  path: string;
  /** Class name (shows up in the route-rules test output). */
  name: string;
  service: Type<CrudService>;
  createSchema: ZodType;
  updateSchema: ZodType;
  listSchema: ZodType;
}

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/**
 * One controller per catalog resource with the contract's five operations (list, create, get,
 * patch, archive): permissions `catalog:read` for reads and `catalog:manage` for writes, ETag on
 * every single-resource response, `If-Match` required on PATCH and DELETE, `Location` on create.
 * The route-rules test checks each generated route against the contract.
 */
function crudController(opts: CrudOptions): Type<unknown> {
  @Controller(opts.path)
  class CatalogController {
    constructor(@Inject(opts.service) private readonly service: CrudService) {}

    @Get()
    @RequirePermission('catalog:read')
    list(
      @CurrentAuth() auth: AuthContext,
      @Query(new ZodValidationPipe(opts.listSchema, 'query')) query: unknown,
    ) {
      return this.service.list(auth, query as never);
    }

    @Post()
    @RequirePermission('catalog:manage')
    @HttpCode(201)
    async create(
      @CurrentAuth() auth: AuthContext,
      @Body(new ZodValidationPipe(opts.createSchema)) body: unknown,
      @Res({ passthrough: true }) reply: FastifyReply,
    ) {
      const { data, version } = await this.service.create(auth, body as never);
      setEtag(reply, version);
      void reply.header('location', `/v1/${opts.path}/${String(data.id)}`);
      return data;
    }

    @Get(':id')
    @RequirePermission('catalog:read')
    async get(
      @CurrentAuth() auth: AuthContext,
      @Param('id', idParam()) id: string,
      @Res({ passthrough: true }) reply: FastifyReply,
    ) {
      const { data, version } = await this.service.get(auth, id);
      setEtag(reply, version);
      return data;
    }

    @Patch(':id')
    @RequirePermission('catalog:manage')
    async update(
      @CurrentAuth() auth: AuthContext,
      @Param('id', idParam()) id: string,
      @RequiredIfMatch() ifMatch: IfMatch,
      @Body(new ZodValidationPipe(opts.updateSchema)) body: unknown,
      @Res({ passthrough: true }) reply: FastifyReply,
    ) {
      const { data, version } = await this.service.update(auth, id, ifMatch, body as never);
      setEtag(reply, version);
      return data;
    }

    @Delete(':id')
    @RequirePermission('catalog:manage')
    @HttpCode(204)
    async archive(
      @CurrentAuth() auth: AuthContext,
      @Param('id', idParam()) id: string,
      @RequiredIfMatch() ifMatch: IfMatch,
    ): Promise<void> {
      await this.service.archive(auth, id, ifMatch);
    }
  }
  Object.defineProperty(CatalogController, 'name', { value: opts.name });
  return CatalogController;
}

export const CategoriesController = crudController({
  path: 'categories',
  name: 'CategoriesController',
  service: CategoriesService,
  createSchema: categoryCreateSchema,
  updateSchema: categoryUpdateSchema,
  listSchema: categoryListSchema,
});
export const ManufacturersController = crudController({
  path: 'manufacturers',
  name: 'ManufacturersController',
  service: ManufacturersService,
  createSchema: manufacturerCreateSchema,
  updateSchema: manufacturerUpdateSchema,
  listSchema: nameListSchema,
});
export const ModelsController = crudController({
  path: 'models',
  name: 'ModelsController',
  service: ModelsService,
  createSchema: modelCreateSchema,
  updateSchema: modelUpdateSchema,
  listSchema: modelListSchema,
});
export const StatusLabelsController = crudController({
  path: 'status-labels',
  name: 'StatusLabelsController',
  service: StatusLabelsService,
  createSchema: statusLabelCreateSchema,
  updateSchema: statusLabelUpdateSchema,
  listSchema: statusLabelListSchema,
});
export const VendorsController = crudController({
  path: 'vendors',
  name: 'VendorsController',
  service: VendorsService,
  createSchema: vendorCreateSchema,
  updateSchema: vendorUpdateSchema,
  listSchema: nameListSchema,
});
export const CustomFieldsController = crudController({
  path: 'custom-fields',
  name: 'CustomFieldsController',
  service: CustomFieldsService,
  createSchema: customFieldCreateSchema,
  updateSchema: customFieldUpdateSchema,
  listSchema: customFieldListSchema,
});

/** The tenant's asset tag numbering template (M1-REG-06): not in the original contract, see openapi `x-registry-additions`. */
@Controller('settings/asset-tag-template')
export class AssetTagTemplateController {
  constructor(private readonly tags: AssetTagService) {}

  @Get()
  @RequirePermission('catalog:read')
  async get(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) reply: FastifyReply) {
    const { data, version } = await this.tags.get(auth);
    setEtag(reply, version);
    return data;
  }

  @Put()
  @RequirePermission('catalog:manage')
  async put(
    @CurrentAuth() auth: AuthContext,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(assetTagTemplateSchema)) body: AssetTagTemplate,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.tags.put(auth, ifMatch, body);
    setEtag(reply, version);
    return data;
  }
}
