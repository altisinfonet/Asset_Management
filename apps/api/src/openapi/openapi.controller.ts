import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Controller, Get, Header, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../auth/index.js';

/**
 * The OpenAPI 3.1 document, bundled from `docs/engineering/openapi.yaml` at build time into
 * `apps/api/openapi.generated.json` (`scripts/bundle-openapi.mjs`; src/ and dist/ both sit two
 * levels below the package root here, so the same relative URL resolves from either). Read once,
 * served from memory with a strong ETag, so a cached copy revalidates with `If-None-Match` (304).
 */
const DOCUMENT_URL = new URL('../../openapi.generated.json', import.meta.url);

let cached: { body: string; etag: string } | undefined;
function document(): { body: string; etag: string } {
  if (!cached) {
    const body = readFileSync(DOCUMENT_URL, 'utf8');
    cached = { body, etag: `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"` };
  }
  return cached;
}

@Public()
@Controller()
export class OpenApiController {
  @Get('openapi.json')
  @Header('content-type', 'application/json; charset=utf-8')
  @Header('cache-control', 'public, max-age=300')
  openapi(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): string {
    const { body, etag } = document();
    void reply.header('etag', etag);
    if (request.headers['if-none-match'] === etag) {
      void reply.status(304);
      return '';
    }
    return body;
  }
}
