import { Module } from '@nestjs/common';
import { ViewsController } from './views.controller.js';
import { ViewsService } from './views.service.js';

/** Saved views (M2-REG-01): per-user list views, optionally shared tenant-wide. Kernel ports and the registry plumbing only. */
@Module({
  controllers: [ViewsController],
  providers: [ViewsService],
  exports: [ViewsService],
})
export class ViewsModule {}
