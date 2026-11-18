import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uuidv7 } from '../../src/ids/uuidv7.js';
import {
  type IfMatch,
  IdempotencyRequired,
  type ListQuery,
  type ListSpec,
  Principal,
  RequiredIfMatch,
  type RequestPrincipal,
  ZodValidationPipe,
  assertIfMatch,
  etagFor,
  listPage,
  listQuerySchema,
  notModified,
  problem,
  runBulk,
  setEtag,
} from '../../src/platform/index.js';
import { type Prisma, TenancyService } from '../../src/tenancy/index.js';

/**
 * Fixture routes that exercise the API conventions (M1-PLAT-02) against the real `asset` table until
 * the registry module (M1-REG) exists. Authentication is faked: `x-test-tenant` and
 * `x-test-principal` headers become `request.principal`, exactly where the auth guard will put it.
 */
export const counters = { executions: 0 };

@Injectable()
export class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const tenantId = request.headers['x-test-tenant'];
    const principalId = request.headers['x-test-principal'];
    if (typeof tenantId === 'string' && typeof principalId === 'string') {
      request.principal = { tenantId, principalId };
    }
    return true;
  }
}

const createSchema = z.strictObject({
  asset_tag: z.string().min(1).max(40).regex(/^\S+$/, 'must not contain whitespace'),
  name: z.string().min(1).max(200).optional(),
  delay_ms: z.number().int().min(0).max(5000).default(0),
});
const bulkSchema = z.strictObject({ items: z.array(createSchema).max(1000) });
const patchSchema = z.strictObject({ name: z.string().min(1).max(200) });
const listSchema = listQuerySchema.extend({ q: z.string().min(1).max(100).optional() });

const listSpec: ListSpec = {
  sortable: {
    asset_tag: { kind: 'string' },
    created_at: { kind: 'date' },
    updated_at: { kind: 'date' },
  },
  defaultSort: '-created_at',
};

const dto = (a: {
  id: string;
  asset_tag: string;
  name: string | null;
  version: number;
  archived_at: Date | null;
}) => ({
  id: a.id,
  asset_tag: a.asset_tag,
  name: a.name,
  version: a.version,
  archived_at: a.archived_at,
});

@Controller('demo')
export class DemoController {
  constructor(private readonly tenancy: TenancyService) {}

  private tx<T>(p: RequestPrincipal, fn: (trx: Prisma.TransactionClient) => Promise<T>) {
    return this.tenancy.withTenantTx({ tenantId: p.tenantId, actorId: p.principalId }, fn);
  }

  private async insertAsset(p: RequestPrincipal, body: { asset_tag: string; name?: string }) {
    return this.tx(p, async (trx) => {
      const [company, category, status] = await Promise.all([
        trx.company.findFirstOrThrow({ select: { id: true } }),
        trx.category.findFirstOrThrow({ select: { id: true } }),
        trx.status_label.findFirstOrThrow({ where: { is_default: true }, select: { id: true } }),
      ]);
      return trx.asset.create({
        data: {
          id: uuidv7(),
          tenant_id: p.tenantId,
          company_id: company.id,
          asset_tag: body.asset_tag,
          name: body.name ?? null,
          category_id: category.id,
          status_id: status.id,
        },
      });
    });
  }

  @Post('assets')
  @HttpCode(201)
  async create(
    @Principal() p: RequestPrincipal,
    @Body(new ZodValidationPipe(createSchema)) body: z.output<typeof createSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    counters.executions++;
    if (body.delay_ms) await new Promise((r) => setTimeout(r, body.delay_ms));
    const asset = await this.insertAsset(p, body);
    setEtag(reply, asset.version);
    void reply.header('location', `/v1/demo/assets/${asset.id}`);
    return dto(asset);
  }

  /** Same as create, but the Idempotency-Key header is mandatory. */
  @Post('assets/checkout-like')
  @HttpCode(201)
  @IdempotencyRequired()
  async createRequired(
    @Principal() p: RequestPrincipal,
    @Body(new ZodValidationPipe(createSchema)) body: z.output<typeof createSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    counters.executions++;
    const asset = await this.insertAsset(p, body);
    setEtag(reply, asset.version);
    return dto(asset);
  }

  /** Writes a row and then fails: the row and the idempotency claim must both roll back. */
  @Post('assets/fail-after-write')
  async failAfterWrite(
    @Principal() p: RequestPrincipal,
    @Body(new ZodValidationPipe(createSchema)) body: z.output<typeof createSchema>,
  ) {
    counters.executions++;
    await this.insertAsset(p, body);
    throw problem.conflict('forced failure after the write');
  }

  /** Bulk convention: per-item results; expected failures are reported before any write. */
  @Post('assets/bulk')
  @HttpCode(200)
  async bulk(
    @Principal() p: RequestPrincipal,
    @Body(new ZodValidationPipe(bulkSchema)) body: z.output<typeof bulkSchema>,
  ) {
    return runBulk(
      body.items,
      async (item) => {
        const taken = await this.tx(p, (trx) =>
          trx.asset.count({ where: { asset_tag: item.asset_tag } }),
        );
        if (taken > 0) throw problem.conflict(`asset tag ${item.asset_tag} is already used`);
        return dto(await this.insertAsset(p, item));
      },
      { successStatus: 201, max: 5 },
    );
  }

  @Get('assets')
  async list(
    @Principal() p: RequestPrincipal,
    @Query(new ZodValidationPipe(listSchema, 'query')) q: ListQuery & { q?: string },
  ) {
    return this.tx(p, (trx) => {
      const filter: Prisma.assetWhereInput = q.q ? { asset_tag: { startsWith: q.q } } : {};
      return listPage({
        query: q,
        spec: listSpec,
        filters: { q: q.q },
        fetch: ({ take, orderBy, where }) =>
          trx.asset
            .findMany({
              where: where ? { AND: [filter, where as Prisma.assetWhereInput] } : filter,
              orderBy: orderBy as Prisma.assetOrderByWithRelationInput[],
              take,
              select: { id: true, asset_tag: true, name: true, created_at: true, updated_at: true },
            })
            .then((rows) => rows.map((r) => ({ ...r }) as Record<string, unknown>)),
        count: () => trx.asset.count({ where: filter }),
      });
    });
  }

  @Get('assets/:id')
  async get(
    @Principal() p: RequestPrincipal,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const asset = await this.tx(p, (trx) => trx.asset.findUnique({ where: { id } }));
    if (!asset) throw problem.notFound('Asset not found.');
    setEtag(reply, asset.version);
    if (notModified(ifNoneMatch ?? undefined, asset.version)) {
      void reply.status(304);
      return undefined;
    }
    return dto(asset);
  }

  @Patch('assets/:id')
  async update(
    @Principal() p: RequestPrincipal,
    @Param('id') id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(patchSchema)) body: z.output<typeof patchSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const asset = await this.tx(p, async (trx) => {
      const current = await trx.asset.findUnique({ where: { id }, select: { version: true } });
      if (!current) throw problem.notFound('Asset not found.');
      assertIfMatch(ifMatch, current.version);
      // The version in the WHERE closes the race between the check and the write.
      const result = await trx.asset.updateMany({
        where: { id, version: current.version },
        data: { name: body.name },
      });
      if (result.count === 0) {
        const now = await trx.asset.findUniqueOrThrow({ where: { id }, select: { version: true } });
        throw problem.preconditionFailed(
          `The resource has changed (current ETag ${etagFor(now.version)}). Re-read it and retry.`,
        );
      }
      return trx.asset.findUniqueOrThrow({ where: { id } });
    });
    setEtag(reply, asset.version);
    return dto(asset);
  }

  @Delete('assets/:id')
  @HttpCode(204)
  async archive(
    @Principal() p: RequestPrincipal,
    @Param('id') id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
  ) {
    await this.tx(p, async (trx) => {
      const current = await trx.asset.findUnique({ where: { id }, select: { version: true } });
      if (!current) throw problem.notFound('Asset not found.');
      assertIfMatch(ifMatch, current.version);
      await trx.asset.updateMany({
        where: { id, version: current.version },
        data: { archived_at: new Date() },
      });
    });
  }

  /** What the database saw as `app.request_id` inside a tenant transaction (ambient propagation). */
  @Get('request-id')
  async requestId(@Principal() p: RequestPrincipal) {
    // NOTE: no requestId passed: it comes from the ambient request context.
    return this.tx(p, async (trx) => {
      const [row] = await trx.$queryRaw<
        Array<{ request_id: string; actor_id: string }>
      >`select current_setting('app.request_id', true) as request_id, current_setting('app.actor_id', true) as actor_id`;
      return row;
    });
  }

  @Get('boom')
  boom(): never {
    throw new Error('secret internal detail: password=hunter2');
  }

  @Get('public')
  open() {
    return { ok: true };
  }
}

@Module({
  controllers: [DemoController],
  providers: [{ provide: APP_GUARD, useClass: TestAuthGuard }],
})
export class DemoModule {}
