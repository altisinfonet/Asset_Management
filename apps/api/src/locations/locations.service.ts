import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import {
  type FieldError,
  type IfMatch,
  type ListSpec,
  type Page,
  assertIfMatch,
  listPage,
  problem,
} from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import {
  type LocationCounts,
  RegistryBase,
  type TxScope,
  duplicate,
  inUse,
  invalidRef,
  locationDto,
  stalePrecondition,
} from '../registry/index.js';
import { Prisma, TenancyService, isUniqueViolation, type Tx } from '../tenancy/index.js';
import {
  MAX_LOCATION_DEPTH,
  type LocationCreate,
  type LocationListQuery,
  type LocationUpdate,
} from './schemas.js';

type LocationRow = NonNullable<Awaited<ReturnType<Tx['location']['findUnique']>>>;
type LocationBody = Record<string, unknown>;

const SPEC: ListSpec = {
  sortable: {
    name: { kind: 'string' },
    depth: { kind: 'number' },
    created_at: { kind: 'date' },
  },
  defaultSort: 'name',
};

/** Audit view of a location: the dto without noise. */
const auditView = (dto: Record<string, unknown>) => {
  const { created_at: _c, updated_at: _u, ...rest } = dto;
  return rest;
};

/** A nullable JSONB column: Prisma needs DbNull to store SQL NULL. */
const dbJson = (v: unknown) =>
  v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);

/**
 * Locations (M2-LOC-01): a tree of sites, buildings, floors, rooms... Adjacency list plus the
 * trigger-maintained `ancestor_ids` path (ED-07): descendants are `ancestor_ids @> {id}`, the path
 * and depth of a whole subtree are rewritten by the database in the SAME statement that moves its
 * root. Cycles are impossible (trigger) and refused earlier with a clear error; the depth limit is
 * {@link MAX_LOCATION_DEPTH}. Tree-shape changes of one tenant are serialised with a transaction
 * advisory lock, so two concurrent moves cannot each look fine and together form a cycle.
 */
@Injectable()
export class LocationsService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  // ------------------------------------------------------------------------------------ reads

  async list(auth: TxScope, query: LocationListQuery): Promise<Page<Record<string, unknown>>> {
    return this.tx(auth, async (trx) => {
      const archived =
        query.archived === 'only'
          ? { archived_at: { not: null } }
          : query.archived === 'include'
            ? {}
            : { archived_at: null };
      const filter = {
        AND: [
          archived,
          query.q
            ? {
                OR: [
                  { name: { contains: query.q, mode: 'insensitive' as const } },
                  { code: { contains: query.q, mode: 'insensitive' as const } },
                ],
              }
            : {},
          query.parent_id ? { parent_id: query.parent_id } : {},
          query.root === true
            ? { parent_id: null }
            : query.root === false
              ? { NOT: { parent_id: null } }
              : {},
          query.descendants_of
            ? { ancestor_ids: { has: query.descendants_of }, NOT: { id: query.descendants_of } }
            : {},
          query.kind?.length ? { kind: { in: query.kind } } : {},
          query.company_id ? { company_id: query.company_id } : {},
        ],
      };
      const page = await listPage({
        query,
        spec: SPEC,
        filters: {
          archived: query.archived,
          q: query.q,
          parent_id: query.parent_id,
          root: query.root,
          descendants_of: query.descendants_of,
          kind: query.kind,
          company_id: query.company_id,
        },
        fetch: ({ take, orderBy, where }) =>
          trx.location.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<LocationRow & Record<string, unknown>>>,
        count: () => trx.location.count({ where: filter }),
      });
      const counts = await this.counts(trx);
      return {
        data: page.data.map((r) => locationDto(r, counts(r.id))),
        page: page.page,
      };
    });
  }

  async get(
    auth: AuthContext,
    id: string,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const row = await trx.location.findUnique({ where: { id } });
      if (!row) throw problem.notFound('Location not found.');
      const counts = await this.counts(trx);
      return { data: locationDto(row, counts(id)), version: row.version };
    });
  }

  /**
   * `asset_count` (live assets here and below), `direct_asset_count` and `child_count` of every
   * location, from two grouped queries over the tenant: the trees are small (hundreds of rows), so
   * the roll-up happens in memory over `ancestor_ids`.
   */
  private async counts(trx: Tx): Promise<(id: string) => LocationCounts> {
    const [locations, direct] = await Promise.all([
      trx.location.findMany({
        where: { archived_at: null },
        select: { id: true, parent_id: true, ancestor_ids: true },
      }),
      trx.$queryRaw<Array<{ location_id: string; n: bigint }>>`
        select location_id, count(*) as n from app.asset
         where location_id is not null and archived_at is null
         group by location_id`,
    ]);
    const own = new Map(direct.map((d) => [d.location_id, Number(d.n)]));
    const total = new Map<string, number>();
    const children = new Map<string, number>();
    for (const l of locations) {
      const n = own.get(l.id) ?? 0;
      if (n > 0)
        for (const ancestor of l.ancestor_ids) total.set(ancestor, (total.get(ancestor) ?? 0) + n);
      if (l.parent_id) children.set(l.parent_id, (children.get(l.parent_id) ?? 0) + 1);
    }
    return (id) => ({
      asset_count: total.get(id) ?? 0,
      direct_asset_count: own.get(id) ?? 0,
      child_count: children.get(id) ?? 0,
    });
  }

  // ----------------------------------------------------------------------------------- writes

  async create(
    auth: AuthContext,
    body: LocationCreate,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const errors: FieldError[] = [];
        const parent = body.parent_id
          ? await trx.location.findUnique({ where: { id: body.parent_id } })
          : null;
        if (body.parent_id) {
          if (!parent || parent.archived_at)
            errors.push(invalidRef('/parent_id', 'No such location.'));
          else if (parent.depth + 1 > MAX_LOCATION_DEPTH)
            errors.push(depthError(MAX_LOCATION_DEPTH));
        }
        const company = body.company_id
          ? await trx.company.findUnique({ where: { id: body.company_id } })
          : await trx.company.findFirst({ where: { is_default: true } });
        if (!company) errors.push(invalidRef('/company_id', 'No such company.'));
        if (errors.length > 0) throw problem.validation(errors);

        const row = await trx.location.create({
          data: {
            id: uuidv7(),
            tenant_id: auth.tenantId,
            company_id: company!.id,
            parent_id: body.parent_id ?? null,
            name: body.name,
            kind: body.kind ?? 'other',
            code: body.code ?? null,
            address: dbJson(body.address),
            latitude: body.latitude ?? null,
            longitude: body.longitude ?? null,
            notes: body.notes ?? null,
            created_by: auth.userId,
          },
        });
        const dto = locationDto(row, { asset_count: 0, direct_asset_count: 0, child_count: 0 });
        await this.record(trx, {
          entity: 'location',
          verb: 'created',
          id: row.id,
          version: row.version,
          before: null,
          after: auditView(locationDto(row)),
          refs: { parentId: row.parent_id },
        });
        return { data: dto, version: row.version };
      });
    } catch (err) {
      throw this.translate(err, body);
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: LocationUpdate,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const moving = body.parent_id !== undefined;
        // Tree-shape changes of the tenant run one after the other (cycle check + trigger rewrite).
        if (moving) await this.lockTree(trx, auth.tenantId);
        const row = await trx.location.findUnique({ where: { id } });
        if (!row || row.archived_at) throw problem.notFound('Location not found.');
        assertIfMatch(ifMatch, row.version);

        const changes: LocationBody = {};
        const set = (key: string, value: unknown) => {
          const before = (row as Record<string, unknown>)[key];
          // latitude / longitude come back as Decimal: compare numerically
          const same =
            key === 'latitude' || key === 'longitude'
              ? (before === null ? null : Number(String(before))) === value
              : JSON.stringify(value) === JSON.stringify(before);
          if (!same) changes[key] = value;
        };
        const errors: FieldError[] = [];
        let descendants = 0;
        if (moving && body.parent_id !== row.parent_id) {
          const parent = body.parent_id
            ? await trx.location.findUnique({ where: { id: body.parent_id } })
            : null;
          if (body.parent_id && (!parent || parent.archived_at)) {
            errors.push(invalidRef('/parent_id', 'No such location.'));
          } else if (parent && (parent.id === row.id || parent.ancestor_ids.includes(row.id))) {
            errors.push({
              pointer: '/parent_id',
              message: 'a location cannot be moved under itself or one of its own sub-locations',
              code: 'cycle',
            });
          } else {
            // The deepest descendant must still fit below the new parent.
            const below = await trx.location.aggregate({
              _max: { depth: true },
              _count: { _all: true },
              where: { ancestor_ids: { has: row.id } },
            });
            const height = (below._max.depth ?? row.depth) - row.depth;
            descendants = below._count._all - 1;
            const newDepth = (parent ? parent.depth + 1 : 0) + height;
            if (newDepth > MAX_LOCATION_DEPTH) errors.push(depthError(MAX_LOCATION_DEPTH));
            changes.parent_id = body.parent_id;
          }
        }
        if (body.company_id !== undefined && body.company_id !== row.company_id) {
          const company = await trx.company.findUnique({ where: { id: body.company_id } });
          if (!company) errors.push(invalidRef('/company_id', 'No such company.'));
          else changes.company_id = body.company_id;
        }
        if (errors.length > 0) throw problem.validation(errors);

        if (body.name !== undefined) set('name', body.name);
        if (body.kind !== undefined) set('kind', body.kind);
        if (body.code !== undefined) set('code', body.code);
        if (body.address !== undefined) set('address', body.address);
        if (body.latitude !== undefined) set('latitude', body.latitude);
        if (body.longitude !== undefined) set('longitude', body.longitude);
        if (body.notes !== undefined) set('notes', body.notes);
        if ('address' in changes) changes.address = dbJson(changes.address);
        const unchanged = Object.keys(changes).length === 0;
        if (unchanged) {
          const counts = await this.counts(trx);
          return { data: locationDto(row, counts(id)), version: row.version };
        }

        const result = await trx.location.updateMany({
          where: { id, version: row.version },
          data: { ...changes, updated_by: auth.userId },
        });
        if (result.count === 0) {
          return stalePrecondition(() => trx.location.findUnique({ where: { id } }), 'Location');
        }
        const updated = (await trx.location.findUnique({ where: { id } }))!;
        const moved = 'parent_id' in changes;
        await this.record(trx, {
          entity: 'location',
          verb: moved ? 'moved' : 'updated',
          id,
          version: updated.version,
          before: auditView(locationDto(row)),
          after: auditView(locationDto(updated)),
          ...(moved ? { meta: { moved_descendants: descendants } } : {}),
          refs: { parentId: updated.parent_id },
        });
        const counts = await this.counts(trx);
        return { data: locationDto(updated, counts(id)), version: updated.version };
      });
    } catch (err) {
      throw this.translate(err, body);
    }
  }

  async archive(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<void> {
    await this.tx(auth, async (trx) => {
      await this.lockTree(trx, auth.tenantId);
      const row = await trx.location.findUnique({ where: { id } });
      if (!row || row.archived_at) throw problem.notFound('Location not found.');
      assertIfMatch(ifMatch, row.version);

      // Refused while anything still points at the location (M2-LOC-01: "with counts").
      const [children, assets, people, openAssignments] = await Promise.all([
        trx.location.count({ where: { parent_id: id, archived_at: null } }),
        trx.asset.count({ where: { location_id: id, archived_at: null } }),
        trx.person.count({ where: { location_id: id, archived_at: null } }),
        trx.assignment.count({ where: { location_id: id, checked_in_at: null } }),
      ]);
      if (children + assets + people + openAssignments > 0) {
        throw inUse('Location', {
          children,
          assets,
          people,
          open_assignments: openAssignments,
        });
      }
      const result = await trx.location.updateMany({
        where: { id, version: row.version },
        data: { archived_at: new Date(), updated_by: auth.userId },
      });
      if (result.count === 0) {
        return stalePrecondition(() => trx.location.findUnique({ where: { id } }), 'Location');
      }
      const updated = (await trx.location.findUnique({ where: { id } }))!;
      await this.record(trx, {
        entity: 'location',
        verb: 'archived',
        id,
        version: updated.version,
        before: auditView(locationDto(row)),
        after: auditView(locationDto(updated)),
        refs: { parentId: updated.parent_id },
      });
    });
  }

  // ------------------------------------------------------------------------------------ helpers

  private async lockTree(trx: Tx, tenantId: string): Promise<void> {
    await trx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${`location-tree:${tenantId}`}, 0))`;
  }

  private translate(err: unknown, body: { name?: string | undefined }): unknown {
    if (isUniqueViolation(err)) {
      return duplicate('A location named', '/name', body.name ?? '(this name)');
    }
    return err;
  }
}

const depthError = (max: number) => ({
  pointer: '/parent_id',
  message: `locations can be nested at most ${max + 1} levels deep`,
  code: 'too-deep',
});
