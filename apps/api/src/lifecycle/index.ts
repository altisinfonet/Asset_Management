// Public facade of the lifecycle module (M2-LIFE). Other modules import from here only.
export { LifecycleModule } from './lifecycle.module.js';
export { CustodyService, type CustodyResult, type TransferResult } from './custody.service.js';
export {
  type CustodySettings,
  CustodySettingsService,
  DEFAULT_CUSTODY_SETTINGS,
  parseCustodySettings,
} from './custody-settings.js';
export {
  type AssignmentExtras,
  type AssignmentRow,
  assignmentDto,
  listAssignments,
  loadAssignment,
  todayUtc,
} from './assignments.js';
