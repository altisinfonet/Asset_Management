import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller.js';
import { DepartmentsService } from './departments.service.js';

/**
 * Departments (ED-17): the managed list of departments that people and assets reference. Depends only
 * on kernel facades, the registry facade (shared CRUD plumbing) and the audit / outbox ports.
 */
@Module({
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
