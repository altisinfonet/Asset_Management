import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { AssetTagService } from './asset-tags.js';
import { AssetsController, SearchController } from './assets.controller.js';
import { AssetsFacade } from './assets.facade.js';
import {
  AssetTagTemplateController,
  CategoriesController,
  CustomFieldsController,
  ManufacturersController,
  ModelsController,
  StatusLabelsController,
  VendorsController,
} from './catalog.controller.js';
import {
  CategoriesService,
  CustomFieldsService,
  ManufacturersService,
  ModelsService,
  StatusLabelsService,
  VendorsService,
} from './catalog-services.js';
import { ScanResolveThrottle } from './scan-throttle.js';
import { SearchService } from './search.service.js';

/**
 * Asset registry (M1-REG): categories, manufacturers, models, status labels, vendors, custom fields,
 * assets (CRUD, tag numbering, list/filter/search, clone, bulk, archive/restore) and search.
 * Depends only on kernel facades: tenancy (TenancyService), platform (list/ETag/problem helpers),
 * auth (RequirePermission, CurrentAuth) and the AUDIT_WRITER / OUTBOX_PUBLISHER ports bound by the
 * global PortsModule. `AssetsFacade` is the entry point other modules use in M2.
 */
@Module({
  // ThrottleService (scan-resolve miss limiter)
  imports: [AuthModule],
  controllers: [
    CategoriesController,
    ManufacturersController,
    ModelsController,
    StatusLabelsController,
    VendorsController,
    CustomFieldsController,
    AssetTagTemplateController,
    AssetsController,
    SearchController,
  ],
  providers: [
    CategoriesService,
    ManufacturersService,
    ModelsService,
    StatusLabelsService,
    VendorsService,
    CustomFieldsService,
    AssetTagService,
    AssetsFacade,
    ScanResolveThrottle,
    SearchService,
  ],
  exports: [AssetsFacade, AssetTagService],
})
export class RegistryModule {}
