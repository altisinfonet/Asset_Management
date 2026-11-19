import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller.js';
import { LocationsService } from './locations.service.js';

/**
 * Locations (M2-LOC-01): the site > building > floor > room tree, with asset counts, subtree moves
 * and archive rules. Depends only on kernel facades, the registry facade (shared CRUD plumbing,
 * the location dto) and the audit / outbox ports bound by the global PortsModule.
 */
@Module({
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
