import { Module, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry } from '../jobs/index.js';
import { LocationsModule } from '../locations/index.js';
import { PeopleModule } from '../people/index.js';
import { RegistryModule } from '../registry/index.js';
import { EXPORT_JOB, EXPORT_SWEEP_JOB, ExportRunner } from './export-runner.js';
import { ExportsController } from './exports.controller.js';
import { ExportsService } from './exports.service.js';

/**
 * Exports (M2-REG-02): CSV exports of the asset, people and location lists. The API stores the request
 * and queues `export.run`; the worker (`ExportRunner`) reads the list through the registry, people and
 * locations facades, writes the file through the StorageAdapter port and publishes `export.completed`
 * (which the notifications module turns into a notification). `export.sweep` deletes expired files.
 */
@Module({
  imports: [RegistryModule, PeopleModule, LocationsModule],
  controllers: [ExportsController],
  providers: [ExportsService, ExportRunner],
  exports: [ExportsService],
})
export class ExportsModule implements OnModuleInit {
  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly runner: ExportRunner,
  ) {}

  onModuleInit(): void {
    this.registry.registerTenant(EXPORT_JOB, (payload, ctx) => this.runner.run(payload, ctx));
    this.registry.registerTenant(EXPORT_SWEEP_JOB, (payload, ctx) => this.runner.sweep(payload, ctx));
  }
}
