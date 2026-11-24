// Public facade of the locations module (M2-LOC-01). Other modules import from here only.
export { LocationsModule } from './locations.module.js';
export { LocationsService } from './locations.service.js';
export { LOCATION_KINDS, MAX_LOCATION_DEPTH } from './schemas.js';
export { locationListSchema, type LocationListQuery } from './schemas.js';
export { locationCreateSchema, locationUpdateSchema } from './schemas.js';
