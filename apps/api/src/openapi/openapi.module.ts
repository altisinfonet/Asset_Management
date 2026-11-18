import { Module } from '@nestjs/common';
import { OpenApiController } from './openapi.controller.js';

/** Serves the API contract at `GET /v1/openapi.json` (M1-PLAT-03, server side). */
@Module({ controllers: [OpenApiController] })
export class OpenApiModule {}
