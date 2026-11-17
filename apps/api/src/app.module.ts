import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { pinoHttpParams } from './logging/logger.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot(pinoHttpParams(config)),
        DbModule,
        HealthModule,
      ],
    };
  }
}
