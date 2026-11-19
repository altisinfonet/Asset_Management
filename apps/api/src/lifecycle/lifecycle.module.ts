import { Module } from '@nestjs/common';
import { CustodyController } from './custody.controller.js';
import { CustodyService } from './custody.service.js';

/**
 * Lifecycle (M2-LIFE): custody of assets (check-out, check-in, transfer), their assignment lists and
 * the chain-of-custody history per person. Builds on the registry facade (asset locking, state rules,
 * history writer) and the audit / outbox ports.
 */
@Module({
  controllers: [CustodyController],
  providers: [CustodyService],
  exports: [CustodyService],
})
export class LifecycleModule {}
