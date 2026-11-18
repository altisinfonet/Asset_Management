import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { TenancyService } from '../tenancy/index.js';
import {
  IDEMPOTENCY_OPTIONS,
  IdempotencyInterceptor,
  type IdempotencyOptions,
} from './idempotency.js';
import { PortsModule } from './ports.module.js';
import { PROBLEM_TYPE_BASE, ProblemFilter } from './problem.filter.js';
import { RequestIdentityInterceptor } from './request-identity.interceptor.js';

/**
 * Platform kernel, HTTP conventions (M1-PLAT-02): problem+json for every error, Idempotency-Key
 * for mutating requests. Pipes, pagination and ETag helpers are plain exports (see `index.ts`).
 * Request-id propagation is installed on the Fastify instance by `createApiApp` (it must exist
 * before Nest routes). Imports {@link PortsModule}, which binds the shared ports (audit, outbox, jobs,
 * mail, secret box) for every module.
 */
@Module({
  imports: [PortsModule],
  providers: [
    {
      provide: PROBLEM_TYPE_BASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => config.PROBLEM_TYPE_BASE,
    },
    {
      provide: IDEMPOTENCY_OPTIONS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): IdempotencyOptions => ({
        lockTimeoutMs: config.IDEMPOTENCY_LOCK_TIMEOUT_MS,
      }),
    },
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestIdentityInterceptor },
    {
      provide: APP_INTERCEPTOR,
      inject: [TenancyService, Reflector, IDEMPOTENCY_OPTIONS],
      useFactory: (tenancy: TenancyService, reflector: Reflector, options: IdempotencyOptions) =>
        new IdempotencyInterceptor(tenancy, reflector, options),
    },
  ],
})
export class PlatformModule {}
