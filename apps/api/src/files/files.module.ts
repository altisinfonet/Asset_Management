import { Module, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry } from '../jobs/index.js';
import { AttachmentsController, FilesSettingsController } from './attachments.controller.js';
import { AttachmentsService, SCAN_JOB, SWEEP_JOB, THUMBNAIL_JOB } from './attachments.service.js';
import { FilesSettingsService } from './files-settings.service.js';
import { LocalFilesController } from './local-files.controller.js';
import { AttachmentPipeline } from './pipeline.js';

/**
 * Files and attachments (M2-FILE-01..03, M2-SEC-02): the attachments API, the local-driver file
 * endpoints, per-tenant file settings and the `attachment.scan` / `attachment.thumbnail` /
 * `attachment.sweep` job handlers. Depends only on kernel ports (STORAGE_ADAPTER, VIRUS_SCANNER,
 * AUDIT_WRITER, OUTBOX_PUBLISHER, JOB_QUEUE) bound by the global PortsModule.
 * `AttachmentsService` is the facade other modules use (`linkToOwner`, `assertUsableImage`).
 */
@Module({
  controllers: [AttachmentsController, FilesSettingsController, LocalFilesController],
  providers: [AttachmentsService, FilesSettingsService, AttachmentPipeline],
  exports: [AttachmentsService],
})
export class FilesModule implements OnModuleInit {
  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly pipeline: AttachmentPipeline,
  ) {}

  onModuleInit(): void {
    this.registry.registerTenant(SCAN_JOB, (payload, ctx) => this.pipeline.scan(payload, ctx));
    this.registry.registerTenant(THUMBNAIL_JOB, (payload, ctx) =>
      this.pipeline.thumbnail(payload, ctx),
    );
    this.registry.registerTenant(SWEEP_JOB, (payload, ctx) => this.pipeline.sweep(payload, ctx));
  }
}
