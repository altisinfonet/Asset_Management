import { type DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule, TemporaryPortBindingsModule } from './auth/index.js';
import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.js';
import { ControlPlaneModule } from './control-plane/index.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './identity/index.js';
import { pinoHttpParams } from './logging/logger.js';
import { PlatformModule } from './platform/index.js';
import { TenancyModule } from './tenancy/index.js';

export interface AppModuleOptions {
  /**
   * Register the auth module (default true). Only e2e fixtures that fake authentication themselves
   * (test/support/demo-module.ts) turn it off; production code never does.
   */
  auth?: boolean;
}

@Module({})
export class AppModule {
  /** `extraImports`: feature modules (and, in e2e tests, fixture controllers) added to the app. */
  static register(
    config: AppConfig,
    extraImports: ModuleMetadata['imports'] = [],
    options: AppModuleOptions = {},
  ): DynamicModule {
    const auth = options.auth !== false;
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot(pinoHttpParams(config)),
        TenancyModule,
        PlatformModule,
        ControlPlaneModule,
        IdentityModule,
        // After PlatformModule: the auth problem filter must be registered later to take precedence.
        ...(auth ? [AuthModule] : []),
        // TEMPORARY: remove with src/auth/temporary-port-bindings.ts when the platform ports land.
        ...(auth && config.NODE_ENV !== 'test' ? [TemporaryPortBindingsModule] : []),
        HealthModule,
        ...extraImports,
      ],
    };
  }
}
