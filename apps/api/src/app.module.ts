import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.js';
import { ControlPlaneModule } from './control-plane/control-plane.module.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { pinoHttpParams } from './logging/logger.js';
import { TenancyModule } from './tenancy/tenancy.module.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot(pinoHttpParams(config)),
        TenancyModule,
        ControlPlaneModule,
        IdentityModule,
        HealthModule,
      ],
    };
  }
}
