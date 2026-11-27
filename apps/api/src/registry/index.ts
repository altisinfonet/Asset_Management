// Public facade of the registry module (M1-REG). Other modules import from here only.
export { AssetsFacade, BULK_MAX, type AssetWithVersion } from './assets.facade.js';
export { AssetTagService, formatAssetTag } from './asset-tags.js';
export { type AssetMatchType, findAssetByCode, scanCandidates } from './asset-codes.js';
export { ScanResolveThrottle } from './scan-throttle.js';
export {
  type AssetDto,
  type AssetRow,
  type AssignmentSummaryDto,
  assetDto,
  loadAsset,
  loadAssetRows,
  lockAsset,
  openAssignmentSummaries,
  withStatus,
} from './asset-queries.js';
// [M2-W2 LABELS] bulk selection by ids or by the list's own filter language
export {
  ASSET_SELECTION_KEYS,
  type AssetSelectionFilter,
  type LabelAssetRow,
  loadLabelAssets,
  parseAssetSelection,
  selectAssetIds,
} from './asset-selection.js';
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
  flushHistoryRows,
  writeAssetHistory,
} from './asset-history.js';
export { type DepartmentCounts, type LocationCounts, departmentDto, locationDto } from './dto.js';
export {
  type ChangeRecord,
  RegistryBase,
  type TxScope,
  duplicate,
  inUse,
  invalidRef,
  isForeignKeyViolation,
  nonZero,
  stalePrecondition,
  takenBy,
} from './registry-base.js';
export { inSavepoint } from './savepoint.js';
export { ScanResolverRegistry, type ScanResolution, type ScanResolver } from './scan-resolvers.js';
export { RegistryModule } from './registry.module.js';
export {
  coerceValue,
  validateDefinition,
  validateProvided,
  type FieldDef,
} from './custom-fields.js';
// M2-IMP: reference data the importer creates through the services of the API
export {
  CategoriesService,
  CustomFieldsService,
  ManufacturersService,
  ModelsService,
  StatusLabelsService,
  VendorsService,
} from './catalog-services.js';
export {
  assetCreateSchema,
  assetUpdateSchema,
  type AssetCreate,
  type AssetUpdate,
} from './schemas.js';
export { toFieldDef } from './asset-refs.js';
export { missingRequired, mergeCustomData } from './custom-fields.js';
