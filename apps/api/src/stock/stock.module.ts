import { Module } from '@nestjs/common';
import { RegistryModule } from '../registry/index.js';
import { AccessoriesService } from './accessories.service.js';
import { ConsumablesService } from './consumables.service.js';
import { StockScanResolver } from './scan-resolver.js';
import {
  AccessoriesController,
  ConsumablesController,
  PersonStockController,
} from './stock.controller.js';

/**
 * Accessories and consumables (M2-ACC-01..03): quantity-tracked stock. Accessories are checked out
 * and returned through the custody assignment table (ED-11); consumables have an append-only stock
 * ledger. Depends on the registry facade (shared CRUD plumbing, the scan-resolve extension point),
 * the lifecycle facade (assignment mapping and lists) and the audit / outbox ports. Low-stock events
 * (`consumable.low_stock`, `accessory.low_stock`) are published to the outbox only: the notification
 * subscriber is wired elsewhere.
 */
@Module({
  imports: [RegistryModule],
  controllers: [AccessoriesController, ConsumablesController, PersonStockController],
  providers: [AccessoriesService, ConsumablesService, StockScanResolver],
  exports: [AccessoriesService, ConsumablesService],
})
export class StockModule {}
