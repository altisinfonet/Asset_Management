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
  nextTsIdCursor,
  problem,
  readTsIdCursor,
  tsText,
} from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import { RegistryBase, invalidRef, stalePrecondition } from '../registry/index.js';
import { Prisma, TenancyService, type Tx } from '../tenancy/index.js';
import { insufficientStock, isStockViolation } from './accessories.service.js';
import {
  type ConsumableDto,
  type MovementDto,
  type MovementRow,
  auditView,
  consumableDto,
  lowStockIds,
  movementDto,
} from './dto.js';
import { reevaluateConsumable } from './low-stock.js';
import { checkStockRefs, resolveCompany } from './refs.js';
import type {
  ConsumableCreate,
  ConsumableListQuery,
  ConsumableUpdate,
  PersonStockMovementListQuery,
  StockMovementCreate,
  StockMovementListQuery,
} from './schemas.js';

type ConsumableRow = NonNullable<Awaited<ReturnType<Tx['consumable']['findUnique']>>>;

const SPEC: ListSpec = {
  sortable: {
    name: { kind: 'string' },
    qty_on_hand: { kind: 'number' },
    created_at: { kind: 'date' },
  },
  defaultSort: 'name',
};

/**
 * Consumables (M2-ACC-02, M2-ACC-03, ADR 0008): stock that is used up. `qty_on_hand` is the running
 * balance of the append-only ledger `stock_movement`; only the ledger trigger changes it (a direct
 * UPDATE is refused by the database), and the CHECK `qty_on_hand >= 0` is the last line of defence
 * against an overdraw. Every movement locks the consumable row first (`SELECT .. FOR UPDATE`), so
 * concurrent movements are serialised, the 409 `insufficient-stock` answer is exact, and the
 * low-stock crossing is seen exactly once. Audit row, outbox events and the latch are written in the
 * same transaction as the movement.
 */
@Injectable()
export class ConsumablesService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  // ------------------------------------------------------------------------------------ reads

  async list(
    auth: AuthContext,
    query: ConsumableListQuery,
  ): Promise<Page<Record<string, unknown>>> {
    return this.tx(auth, async (trx) => {
      const archived =
        query.archived === 'only'
          ? { archived_at: { not: null } }
          : query.archived === 'include'
            ? {}
            : { archived_at: null };
      const low = query.low_stock === undefined ? undefined : await lowStockIds(trx, 'consumable');
      const filter = {
        AND: [
          archived,
          query.q ? { search_text: { contains: query.q.toLowerCase() } } : {},
          query.category_id ? { category_id: query.category_id } : {},
          query.location_id ? { location_id: query.location_id } : {},
          low === undefined
            ? {}
            : query.low_stock
              ? { id: { in: low } }
              : { NOT: { id: { in: low } } },
        ],
      };
      const page = await listPage({
        query,
        spec: SPEC,
        filters: {
          archived: query.archived,
          q: query.q,
          category_id: query.category_id,
          location_id: query.location_id,
          low_stock: query.low_stock,
        },
        fetch: ({ take, orderBy, where }) =>
          trx.consumable.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<ConsumableRow & Record<string, unknown>>>,
        count: () => trx.consumable.count({ where: filter }),
      });
      return { data: page.data.map((r) => consumableDto(r)), page: page.page };
    });
  }

  async get(
    auth: AuthContext,
    id: string,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const row = await trx.consumable.findUnique({ where: { id } });
      if (!row) throw problem.notFound('Consumable not found.');
      return { data: consumableDto(row), version: row.version };
    });
  }

  /** The consume log of one consumable (newest first), optionally narrowed to a reason / person. */
  async movements(
    auth: AuthContext,
    id: string,
    query: StockMovementListQuery,
  ): Promise<Page<MovementDto>> {
    return this.tx(auth, async (trx) => {
      const exists = await trx.consumable.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw problem.notFound('Consumable not found.');
      const where = [Prisma.sql`m.consumable_id = ${id}::uuid`];
      if (query.person_id) where.push(Prisma.sql`m.person_id = ${query.person_id}::uuid`);
      return this.movementPage(
        trx,
        where,
        { consumableId: id, reason: query.reason ?? null, personId: query.person_id ?? null },
        query,
      );
    });
  }

  /** Everything issued to / returned by one person, across consumables. */
  async personMovements(
    auth: AuthContext,
    personId: string,
    query: PersonStockMovementListQuery,
  ): Promise<Page<MovementDto>> {
    return this.tx(auth, async (trx) => {
      const exists = await trx.person.findUnique({ where: { id: personId }, select: { id: true } });
      if (!exists) throw problem.notFound('Person not found.');
      return this.movementPage(
        trx,
        [Prisma.sql`m.person_id = ${personId}::uuid`],
        { personId, reason: query.reason ?? null },
        query,
      );
    });
  }

  private async movementPage(
    trx: Tx,
    conditions: Prisma.Sql[],
    filters: Record<string, unknown>,
    query: { cursor?: string | undefined; limit: number; reason?: string[] | undefined },
  ): Promise<Page<MovementDto>> {
    const cur = readTsIdCursor(query.cursor, filters);
    const where = [...conditions];
    if (query.reason?.length) where.push(Prisma.sql`m.reason = any(${query.reason}::text[])`);
    if (cur.after) {
      where.push(Prisma.sql`(m.at, m.id) < (${cur.after.ts}::timestamptz, ${cur.after.id}::uuid)`);
    }
    type Row = MovementRow & { k0: string; k1: string };
    const rows = await trx.$queryRaw<Row[]>`
      select m.id, m.consumable_id, m.qty_delta, m.reason, m.person_id, m.note, m.balance_after,
             m.by_user_id, m.at, c.name as consumable_name, p.display_name as person_name,
             ${Prisma.raw(tsText('m.at'))} as k0, m.id::text as k1
        from app.stock_movement m
        join app.consumable c on c.tenant_id = m.tenant_id and c.id = m.consumable_id
        left join app.person p on p.tenant_id = m.tenant_id and p.id = m.person_id
       where ${Prisma.join(where, ' and ')}
       order by m.at desc, m.id desc
       limit ${query.limit + 1}`;
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      data: page.map((r) => movementDto(r)),
      page: {
        next_cursor: hasMore && last ? nextTsIdCursor(cur.binding, last) : null,
        has_more: hasMore,
      },
    };
  }

  // ----------------------------------------------------------------------------------- writes

  async create(
    auth: AuthContext,
    body: ConsumableCreate,
  ): Promise<{ data: ConsumableDto; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const errors: FieldError[] = [];
        await checkStockRefs(trx, 'consumable', body, errors);
        const companyId = await resolveCompany(trx, body.company_id);
        if (!companyId) errors.push(invalidRef('/company_id', 'No company.'));
        if (errors.length > 0) throw problem.validation(errors);

        const row = await trx.consumable.create({
          data: {
            id: uuidv7(),
            tenant_id: auth.tenantId,
            company_id: companyId!,
            category_id: body.category_id,
            manufacturer_id: body.manufacturer_id ?? null,
            vendor_id: body.vendor_id ?? null,
            location_id: body.location_id ?? null,
            name: body.name,
            model_number: body.model_number ?? null,
            unit: body.unit ?? 'each',
            min_qty: body.min_qty ?? 0,
            unit_cost_minor: body.unit_cost ? BigInt(body.unit_cost.amount_minor) : null,
            currency: body.unit_cost?.currency ?? null,
            notes: body.notes ?? null,
            created_by: auth.userId,
          },
        });
        await this.record(trx, {
          entity: 'consumable',
          verb: 'created',
          id: row.id,
          version: row.version,
          before: null,
          after: auditView(consumableDto(row)),
          ...(body.initial_qty ? { meta: { initial_qty: body.initial_qty } } : {}),
        });
        let movementId: string | undefined;
        if (body.initial_qty && body.initial_qty > 0) {
          movementId = await this.insertMovement(trx, auth, row.id, {
            qty_delta: body.initial_qty,
            reason: 'receive',
            note: 'Opening stock',
          });
        }
        await reevaluateConsumable(trx, this.outbox, row.id, movementId ? { movementId } : {});
        const fresh = (await trx.consumable.findUnique({ where: { id: row.id } }))!;
        return { data: consumableDto(fresh), version: fresh.version };
      });
    } catch (err) {
      throw this.translate(err);
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: ConsumableUpdate,
  ): Promise<{ data: ConsumableDto; version: number }> {
    return this.tx(auth, async (trx) => {
      await this.lockConsumable(trx, id);
      const row = await trx.consumable.findUnique({ where: { id } });
      if (!row || row.archived_at) throw problem.notFound('Consumable not found.');
      assertIfMatch(ifMatch, row.version);

      const errors: FieldError[] = [];
      await checkStockRefs(
        trx,
        'consumable',
        {
          ...(body.category_id !== undefined && body.category_id !== row.category_id
            ? { category_id: body.category_id }
            : {}),
          ...(body.manufacturer_id !== undefined && body.manufacturer_id !== row.manufacturer_id
            ? { manufacturer_id: body.manufacturer_id }
            : {}),
          ...(body.vendor_id !== undefined && body.vendor_id !== row.vendor_id
            ? { vendor_id: body.vendor_id }
            : {}),
          ...(body.location_id !== undefined && body.location_id !== row.location_id
            ? { location_id: body.location_id }
            : {}),
          ...(body.company_id !== undefined && body.company_id !== row.company_id
            ? { company_id: body.company_id }
            : {}),
        },
        errors,
      );
      if (errors.length > 0) throw problem.validation(errors);

      const changes: Record<string, unknown> = {};
      for (const key of [
        'category_id',
        'name',
        'manufacturer_id',
        'vendor_id',
        'location_id',
        'company_id',
        'model_number',
        'unit',
        'min_qty',
        'notes',
      ] as const) {
        const value = body[key];
        if (value !== undefined && value !== row[key]) changes[key] = value;
      }
      if (body.unit_cost !== undefined) {
        const minor = body.unit_cost ? BigInt(body.unit_cost.amount_minor) : null;
        const currency = body.unit_cost?.currency ?? null;
        if (minor !== row.unit_cost_minor || currency !== row.currency) {
          changes.unit_cost_minor = minor;
          changes.currency = currency;
        }
      }
      if (Object.keys(changes).length === 0) {
        return { data: consumableDto(row), version: row.version };
      }
      const result = await trx.consumable.updateMany({
        where: { id, version: row.version },
        data: { ...changes, updated_by: auth.userId },
      });
      if (result.count === 0) {
        return stalePrecondition(() => trx.consumable.findUnique({ where: { id } }), 'Consumable');
      }
      const updated = (await trx.consumable.findUnique({ where: { id } }))!;
      await this.record(trx, {
        entity: 'consumable',
        verb: 'updated',
        id,
        version: updated.version,
        before: auditView(consumableDto(row)),
        after: auditView(consumableDto(updated)),
      });
      // a new minimum can put the item below it (or lift it above): same latch as a movement
      await reevaluateConsumable(trx, this.outbox, id);
      const fresh = (await trx.consumable.findUnique({ where: { id } }))!;
      return { data: consumableDto(fresh), version: fresh.version };
    });
  }

  async archive(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<void> {
    await this.tx(auth, async (trx) => {
      await this.lockConsumable(trx, id);
      const row = await trx.consumable.findUnique({ where: { id } });
      if (!row || row.archived_at) throw problem.notFound('Consumable not found.');
      assertIfMatch(ifMatch, row.version);
      const result = await trx.consumable.updateMany({
        where: { id, version: row.version },
        data: { archived_at: new Date(), updated_by: auth.userId },
      });
      if (result.count === 0) {
        return stalePrecondition(() => trx.consumable.findUnique({ where: { id } }), 'Consumable');
      }
      const updated = (await trx.consumable.findUnique({ where: { id } }))!;
      await this.record(trx, {
        entity: 'consumable',
        verb: 'archived',
        id,
        version: updated.version,
        before: auditView(consumableDto(row)),
        after: auditView(consumableDto(updated)),
      });
    });
  }

  // =========================================================================================
  // The ledger

  /** `POST /v1/consumables/{id}/movements`: receive, issue (consume), return, adjust or correct. */
  async createMovement(
    auth: AuthContext,
    id: string,
    body: StockMovementCreate,
  ): Promise<MovementDto> {
    try {
      return await this.tx(auth, async (trx) => {
        const locked = await this.lockConsumable(trx, id);
        if (locked.archived_at) {
          throw problem.conflict('The consumable is archived: it takes no more stock movements.');
        }
        if (body.person_id) {
          const person = await trx.person.findUnique({ where: { id: body.person_id } });
          if (!person || person.archived_at) {
            throw problem.validation([invalidRef('/person_id', 'No such person.')]);
          }
        }
        const after = locked.qty_on_hand + body.qty_delta;
        if (after < 0) {
          throw insufficientStock(
            `Only ${locked.qty_on_hand} ${locked.unit} on hand; the movement needs ${-body.qty_delta}.`,
            { on_hand: locked.qty_on_hand, requested: -body.qty_delta },
          );
        }
        const movementId = await this.insertMovement(trx, auth, id, body);
        const [row] = await trx.$queryRaw<MovementRow[]>`
          select id, consumable_id, qty_delta, reason, person_id, note, balance_after, by_user_id, at
            from app.stock_movement where id = ${movementId}::uuid`;
        const change = await reevaluateConsumable(trx, this.outbox, id, { movementId });
        const fresh = (await trx.consumable.findUnique({ where: { id } }))!;
        await this.record(trx, {
          entity: 'consumable',
          verb: 'stock_moved',
          id,
          version: fresh.version,
          before: { qty_on_hand: locked.qty_on_hand },
          after: { qty_on_hand: after },
          meta: {
            movement_id: movementId,
            reason: body.reason,
            qty_delta: body.qty_delta,
            ...(body.person_id ? { person_id: body.person_id } : {}),
            ...(body.note ? { note: body.note } : {}),
            ...(change === 'raised' ? { low_stock: true } : {}),
          },
          refs: { movementId, personId: body.person_id ?? null },
        });
        return movementDto(row!);
      });
    } catch (err) {
      throw this.translate(err);
    }
  }

  // ------------------------------------------------------------------------------------ helpers

  /** Appends one ledger row; the database trigger applies the delta and stamps `balance_after`. */
  private async insertMovement(
    trx: Tx,
    auth: AuthContext,
    consumableId: string,
    m: Pick<StockMovementCreate, 'qty_delta' | 'reason'> & {
      person_id?: string | null | undefined;
      note?: string | undefined;
    },
  ): Promise<string> {
    const movementId = uuidv7();
    await trx.stock_movement.create({
      data: {
        id: movementId,
        tenant_id: auth.tenantId,
        consumable_id: consumableId,
        qty_delta: m.qty_delta,
        reason: m.reason,
        person_id: m.person_id ?? null,
        note: m.note ?? null,
        by_user_id: auth.userId,
      },
    });
    return movementId;
  }

  /** Locks the consumable row (404 when missing): the serialisation point of every movement. */
  private async lockConsumable(
    trx: Tx,
    id: string,
  ): Promise<{ id: string; qty_on_hand: number; unit: string; archived_at: Date | null }> {
    const [row] = await trx.$queryRaw<
      Array<{ id: string; qty_on_hand: number; unit: string; archived_at: Date | null }>
    >`select id, qty_on_hand, unit, archived_at from app.consumable where id = ${id}::uuid for update`;
    if (!row) throw problem.notFound('Consumable not found.');
    return row;
  }

  private translate(err: unknown): unknown {
    if (isStockViolation(err)) {
      return insufficientStock('The movement would make the stock negative.', {});
    }
    return err;
  }
}
