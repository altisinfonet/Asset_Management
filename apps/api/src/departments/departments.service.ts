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
  type DepartmentCounts,
  RegistryBase,
  departmentDto,
  duplicate,
  inUse,
  invalidRef,
  stalePrecondition,
  takenBy,
  type TxScope,
} from '../registry/index.js';
import {
  Prisma,
  TenancyService,
  isUniqueViolation,
  locationScopeSql,
  type Tx,
} from '../tenancy/index.js';
import type { DepartmentCreate, DepartmentListQuery, DepartmentUpdate } from './schemas.js';

type DepartmentRow = NonNullable<Awaited<ReturnType<Tx['department']['findUnique']>>>;

const SPEC: ListSpec = {
  sortable: {
    name: { kind: 'string' },
    code: { kind: 'string' },
    created_at: { kind: 'date' },
  },
  defaultSort: 'name',
};

const auditView = (dto: Record<string, unknown>) => {
  const { created_at: _c, updated_at: _u, person_count: _p, asset_count: _a, ...rest } = dto;
  return rest;
};

/**
 * Departments (ED-17): the managed list people and assets point at, so a department is chosen, never
 * typed. Names (and codes) are unique among the live departments of a tenant, case-insensitively, through
 * stored key columns. A department that people or assets still use cannot be archived (`409` with
 * `usage`) unless they are reassigned to another department in the same call (`reassign_to`), which is
 * how two departments are merged.
 */
@Injectable()
export class DepartmentsService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  // ------------------------------------------------------------------------------------ reads

  async list(auth: TxScope, query: DepartmentListQuery): Promise<Page<Record<string, unknown>>> {
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
          // `name_key` / `code_key` are the stored lower-case keys
          needle
            ? { OR: [{ name_key: { contains: needle } }, { code_key: { contains: needle } }] }
            : {},
        ],
      };
      const page = await listPage({
        query,
        spec: SPEC,
        filters: { archived: query.archived, q: query.q },
        fetch: ({ take, orderBy, where }) =>
          trx.department.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<DepartmentRow & Record<string, unknown>>>,
        count: () => trx.department.count({ where: filter }),
      });
      const ids = page.data.map((d) => d.id);
      const [counts, managers] = await Promise.all([
        this.counts(trx, ids),
        this.managerNames(
          trx,
          page.data.map((d) => d.manager_person_id),
        ),
      ]);
      return {
        data: page.data.map((r) =>
          departmentDto(r, {
            counts: counts.get(r.id) ?? { person_count: 0, asset_count: 0 },
            managerName: r.manager_person_id ? (managers.get(r.manager_person_id) ?? null) : null,
          }),
        ),
        page: page.page,
      };
    });
  }

  async get(
    auth: AuthContext,
    id: string,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const row = await trx.department.findUnique({ where: { id } });
      if (!row) throw problem.notFound('Department not found.');
      return { data: await this.view(trx, row), version: row.version };
    });
  }

  /**
   * Live people and assets of each department, from two grouped queries over the given ids; for a
   * location-scoped caller only those inside the scope are counted (M2-LOC-03, ED-26).
   */
  private async counts(trx: Tx, ids: string[]): Promise<Map<string, DepartmentCounts>> {
    const out = new Map<string, DepartmentCounts>();
    if (ids.length === 0) return out;
    const [people, assets] = await Promise.all([
      trx.$queryRaw<Array<{ department_id: string; n: bigint }>>`
        select department_id, count(*) as n from app.person
         where department_id = any(${ids}::uuid[]) and archived_at is null
           and ${locationScopeSql(Prisma.sql`location_id`)}
         group by department_id`,
      trx.$queryRaw<Array<{ department_id: string; n: bigint }>>`
        select department_id, count(*) as n from app.asset
         where department_id = any(${ids}::uuid[]) and archived_at is null
           and ${locationScopeSql(Prisma.sql`location_id`)}
         group by department_id`,
    ]);
    for (const id of ids) out.set(id, { person_count: 0, asset_count: 0 });
    for (const r of people) out.get(r.department_id)!.person_count = Number(r.n);
    for (const r of assets) out.get(r.department_id)!.asset_count = Number(r.n);
    return out;
  }

  private async managerNames(
    trx: Tx,
    personIds: Array<string | null>,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(personIds.filter((v): v is string => v !== null))];
    if (ids.length === 0) return new Map();
    const rows = await trx.person.findMany({
      where: { id: { in: ids } },
      select: { id: true, display_name: true },
    });
    return new Map(rows.map((p) => [p.id, p.display_name]));
  }

  private async view(trx: Tx, row: DepartmentRow): Promise<Record<string, unknown>> {
    const [counts, managers] = await Promise.all([
      this.counts(trx, [row.id]),
      this.managerNames(trx, [row.manager_person_id]),
    ]);
    return departmentDto(row, {
      counts: counts.get(row.id),
      managerName: row.manager_person_id ? (managers.get(row.manager_person_id) ?? null) : null,
    });
  }

  // ----------------------------------------------------------------------------------- writes

  async create(
    auth: AuthContext,
    body: DepartmentCreate,
    meta?: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const errors: FieldError[] = [];
        await this.checkManager(trx, body.manager_person_id, errors);
        if (errors.length > 0) throw problem.validation(errors);
        await this.assertUnique(trx, body.name, body.code, undefined);

        const row = await trx.department.create({
          data: {
            id: uuidv7(),
            tenant_id: auth.tenantId,
            name: body.name,
            code: body.code ?? null,
            description: body.description ?? null,
            manager_person_id: body.manager_person_id ?? null,
            created_by: auth.userId,
          },
        });
        const dto = await this.view(trx, row);
        await this.record(trx, {
          entity: 'department',
          verb: 'created',
          ...(meta ? { meta } : {}),
          id: row.id,
          version: row.version,
          before: null,
          after: auditView(dto),
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
    body: DepartmentUpdate,
    meta?: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const row = await trx.department.findUnique({ where: { id } });
        if (!row || row.archived_at) throw problem.notFound('Department not found.');
        assertIfMatch(ifMatch, row.version);

        const errors: FieldError[] = [];
        if (
          body.manager_person_id !== undefined &&
          body.manager_person_id !== row.manager_person_id
        ) {
          await this.checkManager(trx, body.manager_person_id, errors);
        }
        if (errors.length > 0) throw problem.validation(errors);

        const changes: Record<string, unknown> = {};
        for (const key of ['name', 'code', 'description', 'manager_person_id'] as const) {
          const value = body[key];
          if (value !== undefined && value !== row[key]) changes[key] = value;
        }
        if (Object.keys(changes).length === 0) {
          return { data: await this.view(trx, row), version: row.version };
        }
        await this.assertUnique(
          trx,
          'name' in changes ? (changes.name as string) : undefined,
          'code' in changes ? (changes.code as string | null) : undefined,
          id,
        );
        const result = await trx.department.updateMany({
          where: { id, version: row.version },
          data: { ...changes, updated_by: auth.userId },
        });
        if (result.count === 0) {
          return stalePrecondition(
            () => trx.department.findUnique({ where: { id } }),
            'Department',
          );
        }
        const updated = (await trx.department.findUnique({ where: { id } }))!;
        const dto = await this.view(trx, updated);
        await this.record(trx, {
          entity: 'department',
          verb: 'updated',
          ...(meta ? { meta } : {}),
          id,
          version: updated.version,
          before: auditView(await this.view(trx, row)),
          after: auditView(dto),
        });
        return { data: dto, version: updated.version };
      });
    } catch (err) {
      throw this.translate(err, body);
    }
  }

  /**
   * Archives the department. People and assets that still use it make this a `409` with `usage`;
   * `reassignTo` moves them all (live and archived) to that department first, in the same transaction:
   * the way to merge two departments or to retire one that is in use.
   */
  async archive(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    reassignTo?: string,
  ): Promise<void> {
    await this.tx(auth, async (trx) => {
      const row = await trx.department.findUnique({ where: { id } });
      if (!row || row.archived_at) throw problem.notFound('Department not found.');
      assertIfMatch(ifMatch, row.version);

      const [people, assets] = await Promise.all([
        trx.person.count({ where: { department_id: id, archived_at: null } }),
        trx.asset.count({ where: { department_id: id, archived_at: null } }),
      ]);
      let meta: Record<string, unknown> | undefined;
      if (reassignTo !== undefined) {
        if (reassignTo === id) {
          throw problem.validation([
            {
              pointer: 'query:reassign_to',
              message: 'must be a different department',
              code: 'invalid',
            },
          ]);
        }
        const target = await trx.department.findUnique({ where: { id: reassignTo } });
        if (!target || target.archived_at) {
          throw problem.validation([invalidRef('query:reassign_to', 'No such department.')]);
        }
        // every reference moves, archived people and assets included: nothing may keep pointing at a
        // department that is gone
        const movedPeople = await trx.person.updateMany({
          where: { department_id: id },
          data: { department_id: reassignTo, updated_by: auth.userId },
        });
        const movedAssets = await trx.asset.updateMany({
          where: { department_id: id },
          data: { department_id: reassignTo, updated_by: auth.userId },
        });
        meta = {
          reassigned_to: reassignTo,
          people: movedPeople.count,
          assets: movedAssets.count,
        };
      } else if (people + assets > 0) {
        throw inUse('Department', { people, assets });
      }

      const result = await trx.department.updateMany({
        where: { id, version: row.version },
        data: { archived_at: new Date(), updated_by: auth.userId },
      });
      if (result.count === 0) {
        return stalePrecondition(() => trx.department.findUnique({ where: { id } }), 'Department');
      }
      const updated = (await trx.department.findUnique({ where: { id } }))!;
      await this.record(trx, {
        entity: 'department',
        verb: 'archived',
        id,
        version: updated.version,
        before: auditView(departmentDto(row)),
        after: auditView(departmentDto(updated)),
        ...(meta ? { meta } : {}),
      });
    });
  }

  // ------------------------------------------------------------------------------------ helpers

  /** The manager must be a live person of the tenant. */
  private async checkManager(
    trx: Tx,
    personId: string | null | undefined,
    errors: FieldError[],
  ): Promise<void> {
    if (!personId) return;
    const person = await trx.person.findUnique({
      where: { id: personId },
      select: { archived_at: true },
    });
    if (!person || person.archived_at) {
      errors.push(invalidRef('/manager_person_id', 'No such person.'));
    }
  }

  /** Name and code are unique among live departments (`409`, pointer on the field). */
  private async assertUnique(
    trx: Tx,
    name: string | undefined,
    code: string | null | undefined,
    selfId: string | undefined,
  ): Promise<void> {
    const other = selfId ? { NOT: { id: selfId } } : {};
    if (name) {
      const taken = await trx.department.findFirst({
        where: { name_key: name.trim().toLowerCase(), archived_at: null, ...other },
        select: { id: true },
      });
      if (taken) throw duplicate('A department named', '/name', name);
    }
    if (code) {
      const taken = await trx.department.findFirst({
        where: { code_key: code.trim().toLowerCase(), archived_at: null, ...other },
        select: { id: true, name: true },
      });
      if (taken)
        throw takenBy(
          `Department code ${code.slice(0, 100)} is already used by the department ${taken.name}.`,
          '/code',
        );
    }
  }

  private translate(err: unknown, body: { name?: string | undefined }): unknown {
    if (isUniqueViolation(err)) {
      return duplicate('A department named', '/name', body.name ?? '(this name)');
    }
    return err;
  }
}
