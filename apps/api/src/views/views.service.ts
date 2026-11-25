import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import {
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
import { RegistryBase, duplicate, stalePrecondition } from '../registry/index.js';
import {
  TenancyService,
  isUniqueViolation,
  locationScopeWhere,
  type Tx,
} from '../tenancy/index.js';
import {
  MAX_VIEWS_PER_USER,
  type ViewCreate,
  type ViewListQuery,
  type ViewShare,
  type ViewUpdate,
} from './schemas.js';

type ViewRow = NonNullable<Awaited<ReturnType<Tx['saved_view']['findUnique']>>>;

const SPEC: ListSpec = {
  sortable: { name_key: { kind: 'string' } },
  defaultSort: 'name_key',
};

/** A reference in a view's filters that no longer resolves (the client applies the rest and warns). */
export interface ViewWarning {
  field: string;
  id: string;
  reason: 'not-found' | 'archived';
}

/**
 * Filter keys that carry ids, and the table each id points at. The view itself is opaque to the server;
 * only these references are checked, so a view that mentions a deleted status or location degrades
 * gracefully (M2-REG-01) instead of silently listing nothing.
 */
const REFERENCES: Record<
  string,
  'status_label' | 'category' | 'location' | 'asset_model' | 'vendor' | 'manufacturer' | 'person'
> = {
  status_id: 'status_label',
  category_id: 'category',
  location_id: 'location',
  model_id: 'asset_model',
  vendor_id: 'vendor',
  manufacturer_id: 'manufacturer',
  person_id: 'person',
  assigned_person_id: 'person',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Schema `SavedView`. */
function viewDto(r: ViewRow, me: string, owners: Map<string, string>, warnings: ViewWarning[]) {
  return {
    id: r.id,
    resource: r.resource,
    name: r.name,
    filters: r.filters as Record<string, unknown>,
    columns: r.columns,
    sort: r.sort,
    is_shared: r.is_shared,
    is_owner: r.user_id === me,
    owner: { id: r.user_id, display_name: owners.get(r.user_id) ?? '' },
    warnings,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

const auditView = (r: ViewRow): Record<string, unknown> => ({
  resource: r.resource,
  name: r.name,
  filters: r.filters,
  columns: r.columns,
  sort: r.sort,
  is_shared: r.is_shared,
});

/**
 * Saved views (M2-REG-01): server-side, per user, optionally shared with the whole tenant (the
 * `view:share` permission, on its own endpoint). A view is visible to its owner and, when shared, to
 * everybody in the tenant; only the owner changes or deletes it. Names are unique per user and list, and
 * among the shared views of a list (stored lower-case key + btree, ADR 0005).
 */
@Injectable()
export class ViewsService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  async list(auth: AuthContext, query: ViewListQuery): Promise<Page<Record<string, unknown>>> {
    return this.tx(auth, async (trx) => {
      const scope =
        query.scope === 'mine'
          ? { user_id: auth.userId }
          : query.scope === 'shared'
            ? { is_shared: true }
            : { OR: [{ user_id: auth.userId }, { is_shared: true }] };
      const filter = { AND: [{ resource: query.resource }, scope] };
      const page = await listPage({
        query: {
          limit: query.limit,
          include_total: false,
          ...(query.cursor ? { cursor: query.cursor } : {}),
        },
        spec: SPEC,
        filters: { resource: query.resource, scope: query.scope },
        fetch: ({ take, orderBy, where }) =>
          trx.saved_view.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<ViewRow & Record<string, unknown>>>,
      });
      const owners = await this.owners(trx, page.data);
      const warnings = await this.warningsFor(trx, page.data);
      return {
        data: page.data.map((r) => viewDto(r, auth.userId, owners, warnings.get(r.id) ?? [])),
        page: page.page,
      };
    });
  }

  async get(
    auth: AuthContext,
    id: string,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const row = await this.visible(trx, auth, id);
      return { data: await this.present(trx, auth, row), version: row.version };
    });
  }

  async create(
    auth: AuthContext,
    body: ViewCreate,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const mine = await trx.saved_view.count({
          where: { user_id: auth.userId, resource: body.resource },
        });
        if (mine >= MAX_VIEWS_PER_USER) {
          throw problem.conflict(
            `You already have ${MAX_VIEWS_PER_USER} saved views for this list. Delete one first.`,
          );
        }
        const row = await trx.saved_view.create({
          data: {
            id: uuidv7(),
            tenant_id: auth.tenantId,
            user_id: auth.userId,
            resource: body.resource,
            name: body.name,
            filters: body.filters as object,
            columns: body.columns,
            sort: body.sort,
            created_by: auth.userId,
          },
        });
        await this.record(trx, {
          entity: 'saved_view',
          verb: 'created',
          id: row.id,
          version: row.version,
          before: null,
          after: auditView(row),
        });
        return { data: await this.present(trx, auth, row), version: row.version };
      });
    } catch (err) {
      throw this.translate(err, body.name);
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: ViewUpdate,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const row = await this.owned(trx, auth, id);
        assertIfMatch(ifMatch, row.version);
        const changes: Record<string, unknown> = {};
        if (body.name !== undefined && body.name !== row.name) changes.name = body.name;
        if (body.filters !== undefined) changes.filters = body.filters as object;
        if (body.columns !== undefined) changes.columns = body.columns;
        if (body.sort !== undefined && body.sort !== row.sort) changes.sort = body.sort;
        if (Object.keys(changes).length === 0) {
          return { data: await this.present(trx, auth, row), version: row.version };
        }
        const result = await trx.saved_view.updateMany({
          where: { id, version: row.version },
          data: { ...changes, updated_by: auth.userId },
        });
        if (result.count === 0) {
          return stalePrecondition(() => trx.saved_view.findUnique({ where: { id } }), 'View');
        }
        const updated = (await trx.saved_view.findUnique({ where: { id } }))!;
        await this.record(trx, {
          entity: 'saved_view',
          verb: 'updated',
          id,
          version: updated.version,
          before: auditView(row),
          after: auditView(updated),
        });
        return { data: await this.present(trx, auth, updated), version: updated.version };
      });
    } catch (err) {
      throw this.translate(err, body.name);
    }
  }

  async delete(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<void> {
    await this.tx(auth, async (trx) => {
      const row = await this.owned(trx, auth, id);
      assertIfMatch(ifMatch, row.version);
      const result = await trx.saved_view.deleteMany({ where: { id, version: row.version } });
      if (result.count === 0) {
        return stalePrecondition(() => trx.saved_view.findUnique({ where: { id } }), 'View');
      }
      await this.record(trx, {
        entity: 'saved_view',
        verb: 'deleted',
        id,
        version: row.version,
        before: auditView(row),
        after: null,
      });
    });
  }

  async share(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: ViewShare,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const row = await this.owned(trx, auth, id);
        assertIfMatch(ifMatch, row.version);
        if (row.is_shared === body.shared) {
          return { data: await this.present(trx, auth, row), version: row.version };
        }
        const result = await trx.saved_view.updateMany({
          where: { id, version: row.version },
          data: { is_shared: body.shared, updated_by: auth.userId },
        });
        if (result.count === 0) {
          return stalePrecondition(() => trx.saved_view.findUnique({ where: { id } }), 'View');
        }
        const updated = (await trx.saved_view.findUnique({ where: { id } }))!;
        await this.record(trx, {
          entity: 'saved_view',
          verb: body.shared ? 'shared' : 'unshared',
          id,
          version: updated.version,
          before: auditView(row),
          after: auditView(updated),
        });
        return { data: await this.present(trx, auth, updated), version: updated.version };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw problem.conflict(
          'A shared view with this name already exists. Rename the view first.',
        );
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------------------------ helpers

  /** One of the caller's views or a shared one; anything else does not exist for them. */
  private async visible(trx: Tx, auth: AuthContext, id: string): Promise<ViewRow> {
    const row = await trx.saved_view.findFirst({
      where: { id, OR: [{ user_id: auth.userId }, { is_shared: true }] },
    });
    if (!row) throw problem.notFound('View not found.');
    return row;
  }

  private async owned(trx: Tx, auth: AuthContext, id: string): Promise<ViewRow> {
    const row = await trx.saved_view.findFirst({ where: { id, user_id: auth.userId } });
    if (!row) throw problem.notFound('View not found.');
    return row;
  }

  private async present(trx: Tx, auth: AuthContext, row: ViewRow) {
    const owners = await this.owners(trx, [row]);
    const warnings = await this.warningsFor(trx, [row]);
    return viewDto(row, auth.userId, owners, warnings.get(row.id) ?? []);
  }

  private async owners(trx: Tx, rows: readonly ViewRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.user_id))];
    if (ids.length === 0) return new Map();
    const users = await trx.user_account.findMany({
      where: { id: { in: ids } },
      select: { id: true, display_name: true },
    });
    return new Map(users.map((u) => [u.id, u.display_name]));
  }

  /** Which id references in the filters of these views no longer resolve (one query per referenced table). */
  private async warningsFor(
    trx: Tx,
    rows: readonly ViewRow[],
  ): Promise<Map<string, ViewWarning[]>> {
    const wanted = new Map<string, Set<string>>();
    const refs = rows.map((r) => ({ id: r.id, refs: referencesOf(r.filters) }));
    for (const { refs: list } of refs) {
      for (const { table, id } of list) {
        if (!wanted.has(table)) wanted.set(table, new Set());
        wanted.get(table)!.add(id);
      }
    }
    const state = new Map<string, 'ok' | 'archived'>();
    const check = async (
      table: string,
      find: (ids: string[]) => Promise<Array<{ id: string; archived_at: Date | null }>>,
    ) => {
      const ids = [...(wanted.get(table) ?? [])];
      if (ids.length === 0) return;
      for (const r of await find(ids))
        state.set(`${table}:${r.id}`, r.archived_at ? 'archived' : 'ok');
    };
    const sel = { id: true, archived_at: true } as const;
    await check('status_label', (ids) =>
      trx.status_label.findMany({ where: { id: { in: ids } }, select: sel }),
    );
    await check('category', (ids) =>
      trx.category.findMany({ where: { id: { in: ids } }, select: sel }),
    );
    // M2-LOC-03 (ED-26): a location or person outside the caller's scope is reported exactly like
    // an unknown id (no existence oracle)
    await check('location', async (ids) =>
      trx.location.findMany({
        where: { AND: [{ id: { in: ids } }, await locationScopeWhere(trx, 'id')] },
        select: sel,
      }),
    );
    await check('asset_model', (ids) =>
      trx.asset_model.findMany({ where: { id: { in: ids } }, select: sel }),
    );
    await check('vendor', (ids) =>
      trx.vendor.findMany({ where: { id: { in: ids } }, select: sel }),
    );
    await check('manufacturer', (ids) =>
      trx.manufacturer.findMany({ where: { id: { in: ids } }, select: sel }),
    );
    await check('person', async (ids) =>
      trx.person.findMany({
        where: { id: { in: ids }, ...(await locationScopeWhere(trx, 'location_id')) },
        select: sel,
      }),
    );

    const out = new Map<string, ViewWarning[]>();
    for (const { id, refs: list } of refs) {
      const warnings: ViewWarning[] = [];
      for (const ref of list) {
        const s = state.get(`${ref.table}:${ref.id}`);
        if (s === 'ok') continue;
        warnings.push({
          field: ref.field,
          id: ref.id,
          reason: s === 'archived' ? 'archived' : 'not-found',
        });
      }
      out.set(id, warnings);
    }
    return out;
  }

  private translate(err: unknown, name: string | undefined): unknown {
    if (isUniqueViolation(err)) {
      return duplicate('A saved view named', '/name', name ?? 'this name');
    }
    return err;
  }
}

/** The id references of a filters object (`status_id: "<uuid>"` or an array of them). */
function referencesOf(filters: unknown): Array<{ field: string; table: string; id: string }> {
  const out: Array<{ field: string; table: string; id: string }> = [];
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return out;
  for (const [field, value] of Object.entries(filters as Record<string, unknown>)) {
    const table = REFERENCES[field];
    if (!table) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v === 'string' && UUID.test(v)) out.push({ field, table, id: v.toLowerCase() });
    }
  }
  return out;
}
