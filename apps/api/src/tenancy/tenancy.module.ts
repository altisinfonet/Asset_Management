import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { TenancyService } from './tenancy.service.js';

@Global()
@Module({
  providers: [
    {
      provide: TenancyService,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new TenancyService({
          connectionString: config.DATABASE_URL!,
          poolMax: config.DB_POOL_MAX,
          applicationName: `assettracker-${config.APP_ROLE}`,
        }),
    },
  ],
  exports: [TenancyService],
})
export class TenancyModule {}
