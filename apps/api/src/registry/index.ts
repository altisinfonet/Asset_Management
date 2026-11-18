// Public facade of the registry module (M1-REG). Other modules import from here only.
export { AssetsFacade, BULK_MAX, type AssetWithVersion } from './assets.facade.js';
export { AssetTagService, formatAssetTag } from './asset-tags.js';
export { type AssetDto } from './asset-queries.js';
export { RegistryModule } from './registry.module.js';
export {
  coerceValue,
  validateDefinition,
  validateProvided,
  type FieldDef,
} from './custom-fields.js';
