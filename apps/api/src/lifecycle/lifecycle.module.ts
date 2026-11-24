import { Module } from '@nestjs/common';
import { FilesModule } from '../files/index.js';
import { CustodyController } from './custody.controller.js';
import { CustodySettingsController, CustodySettingsService } from './custody-settings.js';
import { CustodyService } from './custody.service.js';

/**
 * Lifecycle (M2-LIFE): custody of assets (check-out, check-in, transfer), their assignment lists and
 * the chain-of-custody history per person, plus the organisation's custody settings (LIFE-09). Builds
 * on the registry facade (asset locking, state rules, history writer), the files facade (check-in
 * photos) and the audit / outbox ports.
 */
@Module({
  imports: [FilesModule],
  controllers: [CustodyController, CustodySettingsController],
  providers: [CustodyService, CustodySettingsService],
  exports: [CustodyService, CustodySettingsService],
})
export class LifecycleModule {}
