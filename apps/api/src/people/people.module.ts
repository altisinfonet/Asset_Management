import { Module } from '@nestjs/common';
import { PeopleController } from './people.controller.js';
import { PeopleService } from './people.service.js';

/**
 * People (M2-USR-01, ED-01): assignable persons with or without a login. Depends only on kernel
 * facades, the registry facade (shared CRUD plumbing) and the audit / outbox ports.
 */
@Module({
  controllers: [PeopleController],
  providers: [PeopleService],
  exports: [PeopleService],
})
export class PeopleModule {}
