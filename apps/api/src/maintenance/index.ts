// Public facade of the maintenance module (M2-MNT). Other modules import from here only.
export { MaintenanceModule } from './maintenance.module.js';
export { RepairsService, repairDto } from './repairs.service.js';
export { REPAIR_KINDS, REPAIR_STATUSES } from './schemas.js';
