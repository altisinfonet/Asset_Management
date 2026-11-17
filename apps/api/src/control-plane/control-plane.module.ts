import { Global, Module } from '@nestjs/common';
import { ControlPlaneService } from './control-plane.service.js';
import { AllModulesOnEntitlementSource, ENTITLEMENT_SOURCE } from './entitlements.js';

@Global()
@Module({
  providers: [
    ControlPlaneService,
    { provide: ENTITLEMENT_SOURCE, useClass: AllModulesOnEntitlementSource },
  ],
  exports: [ControlPlaneService, ENTITLEMENT_SOURCE],
})
export class ControlPlaneModule {}
