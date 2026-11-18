import type { AuthContext } from '../auth/index.js';
import {
  type IfMatch,
  type ListQuery,
  type ListSpec,
  type Page,
  assertIfMatch,
  listPage,
  problem,
} from '../platform/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import type { Tx } from '../tenancy/index.js';
import {
  RegistryBase,
  isForeignKeyViolation,
  isUniqueViolation,
  stalePrecondition,
} from './registry-base.js';
import type { ApiProblem } from '../platform/index.js';
import type { ArchivedFilter } from './schemas.js';

export interface CatalogRow {
  id: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

/** The slice of a Prisma model delegate the generic service needs. */
export interface Delegate<R> {
  findUnique(args: { where: { id: string } }): Promise<R | null>;
  findMany(args: { where?: object; orderBy?: object; take?: number }): Promise<R[]>;
  create(args: { data: Record<string, unknown> }): Promise<R>;
  updateMany(args: { where: object; data: Record<string, unknown> }): Promise<{ count: number }>;
  count(args?: { where?: object }): Promise<number>;
}

/** What a catalog resource (category, vendor, ...) plugs into the shared CRUD flow. */
export interface CatalogConfig<R extends CatalogRow, C, U> {
  /** Audit entity type, event prefix and the word in messages: `category`, `vendor`... */
  entity: string;
  label: string;
  delegate(trx: Tx): Delegate<R>;
  dto(row: R): Record<string, unknown>;
  listSpec: ListSpec;
  /** Prisma `where` for the list filters (archived handling is added by the service). */
  filter(query: Record<string, unknown>): object;
  /** Canonical filters bound into the cursor. */
  cursorFilters(query: Record<string, unknown>): unknown;
  /** Validates references and returns the column values to INSERT (id/tenant/audit columns are added). */
  prepareCreate(trx: Tx, auth: AuthContext, body: C): Promise<Record<string, unknown>>;
  /** Validates and returns the changed columns only (merge semantics). */
  prepareUpdate(trx: Tx, auth: AuthContext, row: R, body: U): Promise<Record<string, unknown>>;
  /** Throws 409 `conflict` with `usage` when something still references the row. */
  assertArchivable(trx: Tx, row: R): Promise<void>;
  /** Maps a unique violation to a domain 409. */
  onUnique(body: Partial<C & U>): ApiProblem;
}

/** Fields never shown in the audit diff. */
const AUDIT_SKIP = new Set(['created_at', 'updated_at']);
const auditView = (dto: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(dto).filter(([k]) => !AUDIT_SKIP.has(k)));

/**
 * The shared CRUD flow of the catalog resources (categories, manufacturers, models, status labels,
 * vendors, custom field definitions): list with the platform list helper, ETag on every response,
 * `If-Match` on updates and archives (the write itself is `UPDATE .. WHERE id AND version`), audit
 * row and outbox event in the same transaction, uniqueness and references turned into problems.
 */
export abstract class CatalogService<
  R extends CatalogRow,
  C extends object,
  U extends object,
> extends RegistryBase {
  protected abstract readonly cfg: CatalogConfig<R, C, U>;

  private archivedWhere(archived: ArchivedFilter): object {
    return archived === 'only'
      ? { archived_at: { not: null } }
      : archived === 'include'
        ? {}
        : { archived_at: null };
  }

  async list(
    auth: AuthContext,
    query: ListQuery & { archived: ArchivedFilter } & Record<string, unknown>,
  ): Promise<Page<Record<string, unknown>>> {
    return this.tx(auth, async (trx) => {
      const delegate = this.cfg.delegate(trx);
      const filter = { AND: [this.archivedWhere(query.archived), this.cfg.filter(query)] };
      const page = await listPage({
        query,
        spec: this.cfg.listSpec,
        filters: { archived: query.archived, ...(this.cfg.cursorFilters(query) as object) },
        fetch: ({ take, orderBy, where }) =>
          delegate.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as Promise<Array<R & Record<string, unknown>>>,
        count: () => delegate.count({ where: filter }),
      });
      return { data: page.data.map((r) => this.cfg.dto(r)), page: page.page };
    });
  }

  async get(
    auth: AuthContext,
    id: string,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const row = await this.cfg.delegate(trx).findUnique({ where: { id } });
      if (!row) throw problem.notFound(`${this.cfg.label} not found.`);
      return { data: this.cfg.dto(row), version: row.version };
    });
  }

  async create(
    auth: AuthContext,
    body: C,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const data = await this.cfg.prepareCreate(trx, auth, body);
        const row = await this.cfg.delegate(trx).create({
          data: { id: uuidv7(), tenant_id: auth.tenantId, created_by: auth.userId, ...data },
        });
        await this.record(trx, {
          entity: this.cfg.entity,
          verb: 'created',
          id: row.id,
          version: row.version,
          before: null,
          after: auditView(this.cfg.dto(row)),
        });
        return { data: this.cfg.dto(row), version: row.version };
      });
    } catch (err) {
      throw this.translate(err, body);
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: U,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const delegate = this.cfg.delegate(trx);
        const row = await delegate.findUnique({ where: { id } });
        if (!row) throw problem.notFound(`${this.cfg.label} not found.`);
        assertIfMatch(ifMatch, row.version);
        const changes = await this.cfg.prepareUpdate(trx, auth, row, body);
        if (Object.keys(changes).length === 0) {
          return { data: this.cfg.dto(row), version: row.version };
        }
        const result = await delegate.updateMany({
          where: { id, version: row.version },
          data: { ...changes, updated_by: auth.userId },
        });
        if (result.count === 0) {
          return stalePrecondition(() => delegate.findUnique({ where: { id } }), this.cfg.label);
        }
        const updated = (await delegate.findUnique({ where: { id } }))!;
        await this.record(trx, {
          entity: this.cfg.entity,
          verb: 'updated',
          id,
          version: updated.version,
          before: auditView(this.cfg.dto(row)),
          after: auditView(this.cfg.dto(updated)),
        });
        return { data: this.cfg.dto(updated), version: updated.version };
      });
    } catch (err) {
      throw this.translate(err, body);
    }
  }

  async archive(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<void> {
    await this.tx(auth, async (trx) => {
      const delegate = this.cfg.delegate(trx);
      const row = await delegate.findUnique({ where: { id } });
      // An archived row is already gone for the API client: 404, like a missing one.
      if (!row || row.archived_at) throw problem.notFound(`${this.cfg.label} not found.`);
      assertIfMatch(ifMatch, row.version);
      await this.cfg.assertArchivable(trx, row);
      const result = await delegate.updateMany({
        where: { id, version: row.version },
        data: { archived_at: new Date(), updated_by: auth.userId },
      });
      if (result.count === 0) {
        return stalePrecondition(() => delegate.findUnique({ where: { id } }), this.cfg.label);
      }
      const updated = (await delegate.findUnique({ where: { id } }))!;
      await this.record(trx, {
        entity: this.cfg.entity,
        verb: 'archived',
        id,
        version: updated.version,
        before: auditView(this.cfg.dto(row)),
        after: auditView(this.cfg.dto(updated)),
      });
    });
  }

  private translate(err: unknown, body: object): unknown {
    if (isUniqueViolation(err)) return this.cfg.onUnique(body as Partial<C & U>);
    if (isForeignKeyViolation(err)) {
      return problem.conflict(
        `A referenced record of this ${this.cfg.label.toLowerCase()} changed; retry.`,
      );
    }
    return err;
  }
}
