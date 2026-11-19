import { Module } from '@nestjs/common';
import { FilesModule } from '../files/index.js';
import { LifecycleModule } from '../lifecycle/index.js';
import { RepairsController } from './repairs.controller.js';
import { RepairsService } from './repairs.service.js';

/**
 * Maintenance (M2-MNT-01): the repair and maintenance log. Builds on the registry facade (asset
 * locking, state rules, history writer), the lifecycle facade (a forced check-in), the files facade
 * (photos and invoices) and the audit / outbox ports.
 */
@Module({
  imports: [FilesModule, LifecycleModule],
  controllers: [RepairsController],
  providers: [RepairsService],
  exports: [RepairsService],
})
export class MaintenanceModule {}
