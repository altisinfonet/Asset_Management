import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import {
  type FieldError,
  type IfMatch,
  type ListSpec,
  type Page,
  type BulkResponse,
  ApiProblem,
  assertIfMatch,
  bindingFor,
  decodeCursor,
  encodeCursor,
  listPage,
  parseSort,
  problem,
  runBulk,
} from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import {
  type AssetRow,
  RegistryBase,
  assetDto,
  duplicate,
  inSavepoint,
  inUse,
  invalidRef,
  loadAssetRows,
  stalePrecondition,
  type TxScope,
} from '../registry/index.js';
import { CustodySettingsService } from '../lifecycle/index.js';
import { Prisma, TenancyService, isUniqueViolation, type Tx } from '../tenancy/index.js';
import { type PoolCounts, type PoolRow, EMPTY_COUNTS, poolAuditView, poolDto } from './dto.js';
import type {
  BulkMembersBody,
  MemberListQuery,
  PoolCreate,
  PoolListQuery,
  PoolUpdate,
} from './schemas.js';

const SPEC: ListSpec = {
  sortable: { name: { kind: 'string' }, created_at: { kind: 'date' } },
  defaultSort: 'name',
};

interface MemberRow {
  tenant_id: string;
  asset_id: string;
  loaner_pool_id: string;
  added_at: Date;
}

export interface MemberDto {
  asset_id: string;
  loaner_pool_id: string;
  added_at: string;
  available: boolean;
  asset: ReturnType<typeof assetDto>;
}

/** An asset that can be lent right now: live, in a `deployable` state and not checked out. */
const isAvailable = (a: AssetRow): boolean =>
  a.archived_at === null && a.status_state_type === 'deployable' && !a.assignment;

/**
 * Loaner pools (M2-LOAN-01, ED-20, ADR 0011): the pool resource, its counts and its membership. An
 * asset belongs to at most one pool (the primary key of `loaner_pool_member`); a member can still be
 * checked out the regular way. The loans themselves are `LoansService`.
 */
@Injectable()
export class PoolsService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
    private readonly settings: CustodySettingsService,
  ) {
    super(tenancy, audit, outbox);
  }

  // ------------------------------------------------------------------------------------ reads

  async list(auth: TxScope, query: PoolListQuery): Promise<Page<Record<string, unknown>>> {
    return this.tx(auth, async (trx) => {
      const archived =
        query.archived === 'only'
          ? { archived_at: { not: null } }
          : query.archived === 'include'
            ? {}
            : { archived_at: null };
      const needle = query.q?.trim().toLowerCase();
      const filter = {
        AND: [
          archived,
          needle ? { name_key: { contains: needle } } : {},
          query.is_active !== undefined ? { is_active: query.is_active } : {},
          query.home_location_id ? { home_location_id: query.home_location_id } : {},
        ],
      };
      const page = await listPage({
        query,
        spec: SPEC,
        filters: {
          archived: query.archived,
          q: query.q,
          is_active: query.is_active,
          home: query.home_location_id,
        },
        fetch: ({ take, orderBy, where }) =>
          trx.loaner_pool.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<PoolRow & Record<string, unknown>>>,
        count: () => trx.loaner_pool.count({ where: filter }),
      });
      const counts = await this.counts(
        trx,
        page.data.map((p) => p.id),
      );
      const tenantDays = (await this.settings.read(trx)).default_expected_return_days;
      return {
        data: page.data.map((r) => poolDto(r, counts.get(r.id) ?? EMPTY_COUNTS, tenantDays)),
        page: page.page,
      };
    });
  }

  async get(
    auth: AuthContext,
    id: string,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const row = await trx.loaner_pool.findUnique({ where: { id } });
      if (!row) throw problem.notFound('Loaner pool not found.');
      return { data: await this.view(trx, row), version: row.version };
    });
  }

  /**
   * The live counts of the given pools from ONE grouped query over members x assets x open
   * custody. Live = the asset is not archived. "Today" is the UTC date; `due_soon` looks
   * `loan_reminder_days` ahead (the tenant's custody setting).
   */
  async counts(trx: Tx, ids: string[]): Promise<Map<string, PoolCounts>> {
    const out = new Map<string, PoolCounts>();
    if (ids.length === 0) return out;
    const { loan_reminder_days: soon } = await this.settings.read(trx);
    const rows = await trx.$queryRaw<
      Array<{
        pool_id: string;
        member_count: bigint;
        available_count: bigint;
        checked_out_count: bigint;
        overdue_count: bigint;
        due_today_count: bigint;
        due_soon_count: bigint;
      }>
    >`
      with d as (select (now() at time zone 'UTC')::date as today)
      select m.loaner_pool_id as pool_id,
             count(*) as member_count,
             count(*) filter (where sl.state_type = 'deployable' and s.id is null) as available_count,
             count(*) filter (where s.id is not null) as checked_out_count,
             count(*) filter (where s.expected_return < d.today) as overdue_count,
             count(*) filter (where s.expected_return = d.today) as due_today_count,
             count(*) filter (where s.expected_return > d.today
                                and s.expected_return <= d.today + ${soon}::int) as due_soon_count
        from app.loaner_pool_member m
        join app.asset a on a.tenant_id = m.tenant_id and a.id = m.asset_id and a.archived_at is null
        join app.status_label sl on sl.tenant_id = a.tenant_id and sl.id = a.status_id
        left join app.assignment s on s.tenant_id = a.tenant_id and s.asset_id = a.id and s.checked_in_at is null
        cross join d
       where m.loaner_pool_id = any(${ids}::uuid[])
       group by m.loaner_pool_id`;
    for (const r of rows) {
      out.set(r.pool_id, {
        member_count: Number(r.member_count),
        available_count: Number(r.available_count),
        checked_out_count: Number(r.checked_out_count),
        overdue_count: Number(r.overdue_count),
        due_today_count: Number(r.due_today_count),
        due_soon_count: Number(r.due_soon_count),
      });
    }
    return out;
  }

  private async view(trx: Tx, row: PoolRow): Promise<Record<string, unknown>> {
    const counts = await this.counts(trx, [row.id]);
    const tenantDays = (await this.settings.read(trx)).default_expected_return_days;
    return poolDto(row, counts.get(row.id) ?? EMPTY_COUNTS, tenantDays);
  }

  // ----------------------------------------------------------------------------------- writes

  async create(
    auth: AuthContext,
    body: PoolCreate,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const merged = {
          default_loan_days: body.default_loan_days ?? null,
          max_loan_days: body.max_loan_days ?? null,
        };
        await this.validate(trx, body, merged);
        await this.assertUnique(trx, body.name, undefined);
        const row = await trx.loaner_pool.create({
          data: {
            id: uuidv7(),
            tenant_id: auth.tenantId,
            name: body.name,
            description: body.description ?? null,
            home_location_id: body.home_location_id ?? null,
            default_loan_days: merged.default_loan_days,
            email_borrowers_without_login: body.email_borrowers_without_login ?? null,
            max_loan_days: merged.max_loan_days,
            max_loans_per_person: body.max_loans_per_person ?? null,
            eligible_person_kinds: body.eligible_person_kinds ?? [],
            owner_user_id: body.owner_user_id ?? null,
            is_active: body.is_active ?? true,
            created_by: auth.userId,
          },
        });
        await this.record(trx, {
          entity: 'loaner_pool',
          verb: 'created',
          id: row.id,
          version: row.version,
          before: null,
          after: poolAuditView(row),
        });
        return { data: await this.view(trx, row), version: row.version };
      });
    } catch (err) {
      throw this.translate(err, body);
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: PoolUpdate,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const row = await trx.loaner_pool.findUnique({ where: { id } });
        if (!row || row.archived_at) throw problem.notFound('Loaner pool not found.');
        assertIfMatch(ifMatch, row.version);

        const merged = {
          default_loan_days:
            body.default_loan_days !== undefined ? body.default_loan_days : row.default_loan_days,
          max_loan_days: body.max_loan_days !== undefined ? body.max_loan_days : row.max_loan_days,
        };
        await this.validate(
          trx,
          {
            ...(body.home_location_id !== undefined &&
            body.home_location_id !== row.home_location_id
              ? { home_location_id: body.home_location_id }
              : {}),
            ...(body.owner_user_id !== undefined && body.owner_user_id !== row.owner_user_id
              ? { owner_user_id: body.owner_user_id }
              : {}),
          },
          merged,
        );

        const changes: Record<string, unknown> = {};
        for (const key of [
          'name',
          'description',
          'home_location_id',
          'default_loan_days',
          'email_borrowers_without_login',
          'max_loan_days',
          'max_loans_per_person',
          'owner_user_id',
          'is_active',
        ] as const) {
          const value = body[key];
          if (value !== undefined && value !== row[key]) changes[key] = value;
        }
        if (body.eligible_person_kinds !== undefined) {
          const next = body.eligible_person_kinds ?? [];
          if (next.join(',') !== row.eligible_person_kinds.join(',')) {
            changes.eligible_person_kinds = next;
          }
        }
        if (Object.keys(changes).length === 0) {
          return { data: await this.view(trx, row), version: row.version };
        }
        if ('name' in changes) await this.assertUnique(trx, changes.name as string, id);
        const result = await trx.loaner_pool.updateMany({
          where: { id, version: row.version },
          data: { ...changes, updated_by: auth.userId },
        });
        if (result.count === 0) {
          return stalePrecondition(
            () => trx.loaner_pool.findUnique({ where: { id } }),
            'Loaner pool',
          );
        }
        const updated = (await trx.loaner_pool.findUnique({ where: { id } }))!;
        await this.record(trx, {
          entity: 'loaner_pool',
          verb: 'updated',
          id,
          version: updated.version,
          before: poolAuditView(row),
          after: poolAuditView(updated),
        });
        return { data: await this.view(trx, updated), version: updated.version };
      });
    } catch (err) {
      throw this.translate(err, body);
    }
  }

  /**
   * Archives the pool. A member that is checked out makes it a `409` with `usage.open_loans`;
   * otherwise the memberships are removed (so the assets can join another pool) and the pool is
   * archived, in one transaction.
   */
  async archive(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<void> {
    await this.tx(auth, async (trx) => {
      const row = await trx.loaner_pool.findUnique({ where: { id } });
      if (!row || row.archived_at) throw problem.notFound('Loaner pool not found.');
      assertIfMatch(ifMatch, row.version);
      const [open] = await trx.$queryRaw<Array<{ n: bigint }>>`
        select count(*) as n
          from app.loaner_pool_member m
          join app.assignment s on s.tenant_id = m.tenant_id and s.asset_id = m.asset_id and s.checked_in_at is null
         where m.loaner_pool_id = ${id}::uuid`;
      if (Number(open!.n) > 0) throw inUse('Loaner pool', { open_loans: Number(open!.n) });
      const removed = await trx.loaner_pool_member.deleteMany({ where: { loaner_pool_id: id } });
      const result = await trx.loaner_pool.updateMany({
        where: { id, version: row.version },
        data: { archived_at: new Date(), updated_by: auth.userId },
      });
      if (result.count === 0) {
        return stalePrecondition(
          () => trx.loaner_pool.findUnique({ where: { id } }),
          'Loaner pool',
        );
      }
      const updated = (await trx.loaner_pool.findUnique({ where: { id } }))!;
      await this.record(trx, {
        entity: 'loaner_pool',
        verb: 'archived',
        id,
        version: updated.version,
        before: poolAuditView(row),
        after: poolAuditView(updated),
        meta: { members_removed: removed.count },
      });
    });
  }

  // --------------------------------------------------------------------------------- members

  /** One page of members in asset-tag order, with their assets (keyset on `(asset_tag_key, id)`). */
  async listMembers(
    auth: AuthContext,
    poolId: string,
    query: MemberListQuery,
  ): Promise<Page<MemberDto>> {
    return this.tx(auth, async (trx) => {
      const pool = await trx.loaner_pool.findUnique({ where: { id: poolId } });
      if (!pool) throw problem.notFound('Loaner pool not found.');
      const terms = parseSort('asset_tag', {
        sortable: { asset_tag: { kind: 'string', column: 'k0' } },
        defaultSort: 'asset_tag',
      });
      const binding = bindingFor(terms, { pool: poolId, available: query.available });
      const where: Prisma.Sql[] = [Prisma.sql`m.loaner_pool_id = ${poolId}::uuid`];
      if (query.cursor) {
        const [k0, k1] = decodeCursor(query.cursor, terms, binding) as [string, string];
        if (
          typeof k0 !== 'string' ||
          !UUID_SHAPE.test(k1) ||
          k0.length > 300 ||
          k0.includes('\0')
        ) {
          throw invalidCursor();
        }
        where.push(Prisma.sql`(a.asset_tag_key, a.id) > (${k0}::text, ${k1}::uuid)`);
      }
      if (query.available !== undefined) {
        const lendable = Prisma.sql`(a.archived_at is null and sl.state_type = 'deployable'
          and not exists (select 1 from app.assignment s
                           where s.tenant_id = a.tenant_id and s.asset_id = a.id and s.checked_in_at is null))`;
        where.push(query.available ? lendable : Prisma.sql`not ${lendable}`);
      }
      const rows = await trx.$queryRaw<Array<{ id: string; k0: string }>>`
        select a.id, a.asset_tag_key as k0
          from app.loaner_pool_member m
          join app.asset a on a.tenant_id = m.tenant_id and a.id = m.asset_id
          join app.status_label sl on sl.tenant_id = a.tenant_id and sl.id = a.status_id
         where ${Prisma.join(where, ' and ')}
         order by a.asset_tag_key, a.id
         limit ${query.limit + 1}`;
      const hasMore = rows.length > query.limit;
      const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
      const last = pageRows.at(-1);
      const data = await this.memberDtos(
        trx,
        pageRows.map((r) => r.id),
        poolId,
      );
      return {
        data,
        page: {
          next_cursor:
            hasMore && last ? encodeCursor(terms, binding, { k0: last.k0, id: last.id }) : null,
          has_more: hasMore,
        },
      };
    });
  }

  /** Members of the pool among `assetIds`, with their assets, in the order of `assetIds`. */
  private async memberDtos(trx: Tx, assetIds: string[], poolId: string): Promise<MemberDto[]> {
    if (assetIds.length === 0) return [];
    const [assets, members] = await Promise.all([
      loadAssetRows(trx, Prisma.sql`a.id = any(${assetIds}::uuid[])`, assetIds.length),
      trx.loaner_pool_member.findMany({
        where: { loaner_pool_id: poolId, asset_id: { in: assetIds } },
      }) as Promise<MemberRow[]>,
    ]);
    const byAsset = new Map(assets.map((a) => [a.id, a]));
    const byMember = new Map(members.map((m) => [m.asset_id, m]));
    return assetIds.flatMap((id) => {
      const asset = byAsset.get(id);
      const member = byMember.get(id);
      if (!asset || !member) return [];
      return [
        {
          asset_id: id,
          loaner_pool_id: poolId,
          added_at: member.added_at.toISOString(),
          available: isAvailable(asset),
          asset: assetDto(asset),
        },
      ];
    });
  }

  async addMember(
    auth: AuthContext,
    poolId: string,
    assetId: string,
    pointer = '/asset_id',
  ): Promise<{ data: MemberDto; created: boolean }> {
    try {
      return await this.tx(auth, (trx) => this.addMemberInTx(trx, auth, poolId, assetId, pointer));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw problem.conflict('The asset is already a member of a loaner pool.');
      }
      throw err;
    }
  }

  private async addMemberInTx(
    trx: Tx,
    auth: AuthContext,
    poolId: string,
    assetId: string,
    pointer: string,
  ): Promise<{ data: MemberDto; created: boolean }> {
    const pool = await trx.loaner_pool.findUnique({ where: { id: poolId } });
    if (!pool || pool.archived_at) throw problem.notFound('Loaner pool not found.');
    const asset = await trx.asset.findUnique({
      where: { id: assetId },
      select: { id: true, archived_at: true },
    });
    if (!asset) throw problem.validation([invalidRef(pointer, 'No such asset.')]);
    if (asset.archived_at) {
      throw problem.validation([
        { pointer, message: 'an archived asset cannot join a pool', code: 'archived' },
      ]);
    }
    const existing = await trx.loaner_pool_member.findFirst({ where: { asset_id: assetId } });
    if (existing) {
      if (existing.loaner_pool_id !== poolId) {
        throw new ApiProblem({
          code: 'conflict',
          detail: 'The asset is already a member of another loaner pool.',
          errors: [{ pointer, message: 'is a member of another pool', code: 'in-other-pool' }],
        });
      }
      const [dto] = await this.memberDtos(trx, [assetId], poolId);
      return { data: dto!, created: false };
    }
    await trx.loaner_pool_member.create({
      data: {
        tenant_id: auth.tenantId,
        asset_id: assetId,
        loaner_pool_id: poolId,
        added_by: auth.userId,
      },
    });
    await this.record(trx, {
      entity: 'loaner_pool',
      verb: 'member_added',
      id: poolId,
      version: pool.version,
      meta: { asset_id: assetId },
      refs: { assetId },
    });
    const [dto] = await this.memberDtos(trx, [assetId], poolId);
    return { data: dto!, created: true };
  }

  async removeMember(auth: AuthContext, poolId: string, assetId: string): Promise<void> {
    await this.tx(auth, (trx) => this.removeMemberInTx(trx, poolId, assetId));
  }

  private async removeMemberInTx(trx: Tx, poolId: string, assetId: string): Promise<void> {
    const pool = await trx.loaner_pool.findUnique({ where: { id: poolId } });
    if (!pool) throw problem.notFound('Loaner pool not found.');
    const member = await trx.loaner_pool_member.findFirst({
      where: { asset_id: assetId, loaner_pool_id: poolId },
    });
    if (!member) throw problem.notFound('The asset is not a member of this pool.');
    const [loan] = await trx.$queryRaw<Array<{ n: bigint }>>`
      select count(*) as n from app.assignment
       where asset_id = ${assetId}::uuid and loaner_pool_id = ${poolId}::uuid and checked_in_at is null`;
    if (Number(loan!.n) > 0) throw inUse('Loaner pool member', { open_loans: Number(loan!.n) });
    await trx.loaner_pool_member.deleteMany({
      where: { asset_id: assetId, loaner_pool_id: poolId },
    });
    await this.record(trx, {
      entity: 'loaner_pool',
      verb: 'member_removed',
      id: poolId,
      version: pool.version,
      meta: { asset_id: assetId },
      refs: { assetId },
    });
  }

  async bulkAdd(
    auth: AuthContext,
    poolId: string,
    body: BulkMembersBody,
  ): Promise<BulkResponse<MemberDto>> {
    return this.tx(auth, async (trx) => {
      const pool = await trx.loaner_pool.findUnique({ where: { id: poolId } });
      if (!pool || pool.archived_at) throw problem.notFound('Loaner pool not found.');
      return runBulk(
        body.ids,
        (assetId, index) =>
          inSavepoint(trx, async () => {
            try {
              return (await this.addMemberInTx(trx, auth, poolId, assetId, `/ids/${index}`)).data;
            } catch (err) {
              if (isUniqueViolation(err)) {
                throw problem.conflict('The asset is already a member of a loaner pool.');
              }
              throw err;
            }
          }),
        { successStatus: 201, pointer: '/ids' },
      );
    });
  }

  async bulkRemove(
    auth: AuthContext,
    poolId: string,
    body: BulkMembersBody,
  ): Promise<BulkResponse<void>> {
    return this.tx(auth, async (trx) => {
      const pool = await trx.loaner_pool.findUnique({ where: { id: poolId } });
      if (!pool) throw problem.notFound('Loaner pool not found.');
      return runBulk(
        body.ids,
        (assetId) => inSavepoint(trx, () => this.removeMemberInTx(trx, poolId, assetId)),
        { successStatus: 204, pointer: '/ids' },
      );
    });
  }

  // ------------------------------------------------------------------------------------ helpers

  /** Refs and rules: live home location and owner, `max_loan_days >= default_loan_days`. */
  private async validate(
    trx: Tx,
    body: {
      home_location_id?: string | null | undefined;
      owner_user_id?: string | null | undefined;
    },
    days: { default_loan_days: number | null; max_loan_days: number | null },
  ): Promise<void> {
    const errors: FieldError[] = [];
    if (body.home_location_id) {
      const location = await trx.location.findUnique({
        where: { id: body.home_location_id },
        select: { archived_at: true },
      });
      if (!location || location.archived_at) {
        errors.push(invalidRef('/home_location_id', 'No such location.'));
      }
    }
    if (body.owner_user_id) {
      const user = await trx.user_account.findUnique({
        where: { id: body.owner_user_id },
        select: { status: true, archived_at: true },
      });
      if (!user || user.archived_at || user.status !== 'active') {
        errors.push(invalidRef('/owner_user_id', 'No such active user.'));
      }
    }
    if (
      days.max_loan_days !== null &&
      days.default_loan_days !== null &&
      days.max_loan_days < days.default_loan_days
    ) {
      errors.push({
        pointer: '/max_loan_days',
        message: 'must not be less than default_loan_days',
        code: 'invalid',
      });
    }
    if (errors.length > 0) throw problem.validation(errors);
  }

  /** The name is unique among live pools (`409`, pointer `/name`). */
  private async assertUnique(trx: Tx, name: string | undefined, selfId: string | undefined) {
    if (!name) return;
    const taken = await trx.loaner_pool.findFirst({
      where: {
        name_key: name.trim().toLowerCase(),
        archived_at: null,
        ...(selfId ? { NOT: { id: selfId } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw duplicate('A loaner pool named', '/name', name);
  }

  private translate(err: unknown, body: { name?: string | undefined }): unknown {
    if (isUniqueViolation(err)) {
      return duplicate('A loaner pool named', '/name', body.name ?? '(this name)');
    }
    return err;
  }
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidCursor(): ApiProblem {
  return new ApiProblem({
    code: 'invalid-cursor',
    detail: 'The cursor is not valid for this list. Start again without a cursor.',
    errors: [{ pointer: 'query:cursor', message: 'invalid cursor', code: 'invalid_cursor' }],
  });
}
