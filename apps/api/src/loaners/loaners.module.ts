import { Module, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry } from '../jobs/index.js';
import { LifecycleModule } from '../lifecycle/index.js';
import { RegistryModule } from '../registry/index.js';
import { LOAN_ALERTS_JOB, LoanAlerts } from './loan-alerts.js';
import { LoanerPoolsController } from './loaners.controller.js';
import { LoansController } from './loans.controller.js';
import { LoansService } from './loans.service.js';
import { PoolsService } from './pools.service.js';

/**
 * Loaner pools (M2-LOAN, ED-20/21, ADR 0011): the pools and their members, quick loans and returns by
 * scanning, the loan lists and the dashboard, and the daily overdue / due-soon alert job. Loans are
 * normal custody periods: this module drives `CustodyService` (lifecycle) and the registry's scan
 * lookup, and only adds the pool rules on top.
 */
@Module({
  imports: [LifecycleModule, RegistryModule],
  controllers: [LoanerPoolsController, LoansController],
  providers: [PoolsService, LoansService, LoanAlerts],
  exports: [PoolsService, LoansService],
})
export class LoanersModule implements OnModuleInit {
  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly alerts: LoanAlerts,
  ) {}

  onModuleInit(): void {
    this.registry.registerTenant(LOAN_ALERTS_JOB, async (payload, ctx) => {
      await this.alerts.run(payload, ctx);
    });
  }
}
