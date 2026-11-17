import { Global, Module } from '@nestjs/common';
import { IdentityLookupService } from './identity-lookup.service.js';

@Global()
@Module({ providers: [IdentityLookupService], exports: [IdentityLookupService] })
export class IdentityModule {}
