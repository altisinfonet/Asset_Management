// Public facade of the stock module (M2-ACC): accessories and consumables. Other modules import from here only.
export { AccessoriesService } from './accessories.service.js';
export { ConsumablesService } from './consumables.service.js';
export { StockModule } from './stock.module.js';
export { STOCK_REASONS, type StockReason } from './schemas.js';
