import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { DepartmentsModule, DepartmentsService } from '../departments/index.js';
import { JobHandlerRegistry, type TenantJobContext } from '../jobs/index.js';
import { LifecycleModule, CustodyService } from '../lifecycle/index.js';
import { LocationsModule, LocationsService } from '../locations/index.js';
import { PeopleModule, PeopleService } from '../people/index.js';
import {
  AUDIT_WRITER,
  JOB_QUEUE,
  OUTBOX_PUBLISHER,
  STORAGE_ADAPTER,
  type AuditWriter,
  type JobQueue,
  type OutboxPublisher,
  type StorageAdapter,
} from '../ports/index.js';
import {
  AssetsFacade,
  CategoriesService,
  ManufacturersService,
  ModelsService,
  RegistryModule,
  VendorsService,
} from '../registry/index.js';
import { ImportEngine, IMPORT_ANALYZE_JOB, IMPORT_STEP_JOB } from './engine.js';
import { AssetHandler } from './handlers/asset.js';
import { DepartmentHandler } from './handlers/department.js';
import { LocationHandler } from './handlers/location.js';
import { PersonHandler } from './handlers/person.js';
import { ImportsController, ImportTemplatesController } from './importer.controller.js';
import { ImportsService } from './importer.service.js';
import type { RefServices } from './refs.js';
import { ImportTemplatesService } from './templates.service.js';
import { RefServicesToken } from './tokens.js';

export const IMPORT_SWEEP_JOB = 'import.sweep';

/** The worker side: job handlers over the engine, and the sweep that wakes imports whose job was lost. */
@Injectable()
export class ImportRunner {
  constructor(
    private readonly engine: ImportEngine,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
  ) {}

  analyze(payload: { tenantId: string; importId?: unknown }, ctx: TenantJobContext): Promise<void> {
    return this.engine.analyze(ctx.tx, ctx.tenantId, String(payload.importId ?? ''), ctx);
  }

  step(payload: { tenantId: string; importId?: unknown }, ctx: TenantJobContext): Promise<void> {
    return this.engine.step(ctx.tx, ctx.tenantId, String(payload.importId ?? ''), ctx);
  }

  /** Imports that are "running" but have not moved for ten minutes lost their job: queue it again. */
  async sweep(_payload: { tenantId: string }, ctx: TenantJobContext): Promise<void> {
    const stale = await ctx.tx.$queryRaw<Array<{ id: string; state: string; abandoned: boolean }>>`
      select id, state, coalesce(started_at, created_at) < now() - interval '6 hours' as abandoned
        from app.import_job
       where state in ('analyzing','dry_running','committing') and updated_at < now() - interval '10 minutes'
       limit 20`;
    for (const job of stale) {
      if (job.abandoned) {
        // a job that kept failing for hours is not woken again: it ends, and the user starts it over
        await this.engine.abandon(ctx.tx, job.id, ctx);
        continue;
      }
      await this.jobs.enqueue(
        job.state === 'analyzing' ? IMPORT_ANALYZE_JOB : IMPORT_STEP_JOB,
        { tenantId: ctx.tenantId, importId: job.id },
        { tx: ctx.tx, singletonKey: `sweep:${job.id}` },
      );
    }
    if (stale.length > 0)
      ctx.logger.warn({ imports: stale.length }, 'import jobs re-queued by the sweep');
  }
}

/**
 * Imports (M2-IMP-01..07, ED-18, ADR 0010): CSV / XLSX import with a mandatory dry run. The API moves a job
 * through its states and queues worker jobs (ids only); the worker (`ImportRunner` over `ImportEngine`)
 * parses the file, validates and writes through the same services as the API (assets facade, people,
 * locations, departments, catalogue and custody services), one transaction per batch.
 */
@Module({
  imports: [RegistryModule, PeopleModule, LocationsModule, DepartmentsModule, LifecycleModule],
  controllers: [ImportsController, ImportTemplatesController],
  providers: [
    {
      provide: RefServicesToken,
      inject: [
        CategoriesService,
        ManufacturersService,
        VendorsService,
        ModelsService,
        DepartmentsService,
        LocationsService,
        PeopleService,
      ],
      useFactory: (
        categories: CategoriesService,
        manufacturers: ManufacturersService,
        vendors: VendorsService,
        models: ModelsService,
        departments: DepartmentsService,
        locations: LocationsService,
        people: PeopleService,
      ): RefServices =>
        ({
          categories,
          manufacturers,
          vendors,
          models,
          departments,
          locations,
          people,
        }) as unknown as RefServices,
    },
    {
      provide: ImportEngine,
      inject: [
        STORAGE_ADAPTER,
        JOB_QUEUE,
        AUDIT_WRITER,
        OUTBOX_PUBLISHER,
        RefServicesToken,
        AssetsFacade,
        CustodyService,
        PeopleService,
        LocationsService,
        DepartmentsService,
        APP_CONFIG,
      ],
      useFactory: (
        storage: StorageAdapter,
        jobs: JobQueue,
        audit: AuditWriter,
        outbox: OutboxPublisher,
        refs: RefServices,
        assets: AssetsFacade,
        custody: CustodyService,
        people: PeopleService,
        locations: LocationsService,
        departments: DepartmentsService,
        config: AppConfig,
      ) =>
        new ImportEngine({
          storage,
          jobs,
          audit,
          outbox,
          refs,
          handlers: {
            asset: new AssetHandler(assets, custody),
            person: new PersonHandler(people),
            location: new LocationHandler(locations),
            department: new DepartmentHandler(departments),
          },
          config: { batchRows: config.IMPORT_BATCH_ROWS, maxRows: config.IMPORT_MAX_ROWS },
        }),
    },
    ImportsService,
    ImportTemplatesService,
    ImportRunner,
  ],
  exports: [ImportsService, ImportEngine],
})
export class ImportModule implements OnModuleInit {
  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly runner: ImportRunner,
  ) {}

  onModuleInit(): void {
    this.registry.registerTenant(IMPORT_ANALYZE_JOB, (payload, ctx) =>
      this.runner.analyze(payload, ctx),
    );
    this.registry.registerTenant(IMPORT_STEP_JOB, (payload, ctx) => this.runner.step(payload, ctx));
    this.registry.registerTenant(IMPORT_SWEEP_JOB, (payload, ctx) =>
      this.runner.sweep(payload, ctx),
    );
  }
}
