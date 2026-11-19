// Public facade of the registry module (M1-REG). Other modules import from here only.
export { AssetsFacade, BULK_MAX, type AssetWithVersion } from './assets.facade.js';
export { AssetTagService, formatAssetTag } from './asset-tags.js';
export {
  type AssetDto,
  type AssetRow,
  type AssignmentSummaryDto,
  assetDto,
  loadAsset,
  lockAsset,
  openAssignmentSummaries,
  withStatus,
} from './asset-queries.js';
export {
  ASSET_ACTIONS,
  type AssetAction,
  type AssetActionContext,
  type Refusal,
  assertAssetAction,
  refuseAssetAction,
} from './asset-actions.js';
export {
  HISTORY_EVENT_TYPES,
  type HistoryEntry,
  type HistoryEventDto,
  type HistoryEventType,
  historyActor,
  listHistory,
  writeAssetHistory,
} from './asset-history.js';
export { type LocationCounts, locationDto } from './dto.js';
export {
  type ChangeRecord,
  RegistryBase,
  duplicate,
  inUse,
  invalidRef,
  isForeignKeyViolation,
  stalePrecondition,
} from './registry-base.js';
export { inSavepoint } from './savepoint.js';
export { RegistryModule } from './registry.module.js';
export {
  coerceValue,
  validateDefinition,
  validateProvided,
  type FieldDef,
} from './custom-fields.js';
