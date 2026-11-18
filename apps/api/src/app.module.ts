import { type DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.js';
import { ControlPlaneModule } from './control-plane/index.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './identity/index.js';
import { pinoHttpParams } from './logging/logger.js';
import { PlatformModule } from './platform/index.js';
import { TenancyModule } from './tenancy/index.js';

@Module({})
export class AppModule {
  /** `extraImports`: feature modules (and, in e2e tests, fixture controllers) added to the app. */
  static register(config: AppConfig, extraImports: ModuleMetadata['imports'] = []): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot(pinoHttpParams(config)),
        TenancyModule,
        PlatformModule,
        ControlPlaneModule,
        IdentityModule,
        HealthModule,
        ...extraImports,
      ],
    };
  }
}
