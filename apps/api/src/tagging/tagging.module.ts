import { Module, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry } from '../jobs/index.js';
import { LabelPipeline } from './label-pipeline.js';
import { LabelsController } from './labels.controller.js';
import { LabelsService } from './labels.service.js';
import { LABEL_SWEEP_JOB, RENDER_JOB } from './jobs.js';

/**
 * Tagging (M2-TAG-02): fixed label templates, label batches and the `label.render` / `label.sweep`
 * job handlers. Depends on kernel ports (STORAGE_ADAPTER, AUDIT_WRITER, OUTBOX_PUBLISHER, JOB_QUEUE)
 * and on the registry facade for asset selection. The scan-code endpoint (M2-TAG-01) still lives with
 * the registry.
 */
@Module({
  controllers: [LabelsController],
  providers: [LabelsService, LabelPipeline],
  exports: [LabelsService],
})
export class TaggingModule implements OnModuleInit {
  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly pipeline: LabelPipeline,
  ) {}

  onModuleInit(): void {
    this.registry.registerTenant(RENDER_JOB, (payload, ctx) => this.pipeline.render(payload, ctx));
    this.registry.registerTenant(LABEL_SWEEP_JOB, (payload, ctx) =>
      this.pipeline.sweep(payload, ctx),
    );
  }
}
