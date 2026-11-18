import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { registerBuiltinJobs } from './builtin.js';
import { JobsRuntime } from './jobs-runtime.js';
import { JobHandlerRegistry } from './registry.js';

/**
 * pg-boss behind the adapter. Global: any module can inject {@link JobHandlerRegistry} to register
 * handlers, and the JOB_QUEUE port (bound in PortsModule) enqueues through {@link JobsRuntime}.
 */
@Global()
@Module({
  providers: [JobsRuntime, JobHandlerRegistry],
  exports: [JobsRuntime, JobHandlerRegistry],
})
export class JobsModule implements OnModuleInit {
  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    registerBuiltinJobs(this.registry, {
      ownerDatabaseUrl: this.config.MAINTENANCE_DATABASE_URL ?? this.config.MIGRATOR_DATABASE_URL,
    });
  }
}
