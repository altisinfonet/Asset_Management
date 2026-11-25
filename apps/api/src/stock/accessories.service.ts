import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { assignmentDto, listAssignments, loadAssignment, todayUtc } from '../lifecycle/index.js';
import {
  ApiProblem,
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
import { RegistryBase, inUse, invalidRef, stalePrecondition } from '../registry/index.js';
import {
  Prisma,
  TenancyService,
  assetInScope,
  locationInScope,
  locationScopeSql,
  locationScopeWhere,
  personInScope,
  sqlStateOf,
  type Tx,
} from '../tenancy/index.js';
import {
  type AccessoryDto,
  accessoryDto,
  auditView,
  lowStockIds,
  outstandingByAccessory,
} from './dto.js';
import { reevaluateAccessory } from './low-stock.js';
import { checkStockRefs, resolveCompany } from './refs.js';
import type {
  AccessoryAssignmentsQuery,
  AccessoryCheckinBody,
  AccessoryCheckoutBody,
  AccessoryCreate,
  AccessoryListQuery,
  AccessoryUpdate,
} from './schemas.js';

type AccessoryRow = NonNullable<Awaited<ReturnType<Tx['accessory']['findUnique']>>>;
type AssignmentDto = ReturnType<typeof assignmentDto>;

const SPEC: ListSpec = {
  sortable: {
    name: { kind: 'string' },
    qty_total: { kind: 'number' },
    created_at: { kind: 'date' },
  },
  defaultSort: 'name',
};

/** Who holds the units: exactly one of the three ids (schema `AssignmentTarget`). */
interface Target {
  type: 'person' | 'location' | 'asset';
  id: string;
  name: string;
}

const dayBefore = (): string => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const dateOrNull = (v: string | null | undefined): Date | null =>
  v ? new Date(`${v}T00:00:00Z`) : null;

/** 409 `insufficient-stock` (the contract code of "not enough units / stock"). */
export const insufficientStock = (
  detail: string,
  extensions: Record<string, unknown>,
): ApiProblem => new ApiProblem({ code: 'insufficient-stock', detail, extensions });

/** The database-level refusal of the stock triggers (assignment check, total guard, ledger CHECK). */
export const isStockViolation = (err: unknown): boolean =>
  sqlStateOf(err) === '23514' &&
  /insufficient accessory stock|consumable_qty_on_hand_check|qty_on_hand/i.test(
    err instanceof Error ? err.message : String(err),
  );

/**
 * Accessories (M2-ACC-01, ED-11, ADR 0008): quantity-tracked items. A check-out is an assignment
 * with a `quantity` (one row per hand-over); returns, possibly partial, raise `quantity_returned` on
 * the same row; availability is derived (`qty_total` minus the units still out), never stored.
 *
 * Every operation that changes what is out (check-out, check-in, total, archive) starts by
 * locking the accessory row (`SELECT .. FOR UPDATE`): concurrent requests on one accessory are
 * serialised, so the stock is never exceeded and the low-stock crossing is seen exactly once. The
 * database repeats the guarantee (trigger `assignment_accessory_stock`, `accessory_guard_total`).
 * Audit row, outbox event and the low-stock latch are written in the same transaction.
 */
@Injectable()
export class AccessoriesService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  // ------------------------------------------------------------------------------------ reads

  async list(auth: AuthContext, query: AccessoryListQuery): Promise<Page<Record<string, unknown>>> {
    return this.tx(auth, async (trx) => {
      const archived =
        query.archived === 'only'
          ? { archived_at: { not: null } }
          : query.archived === 'include'
            ? {}
            : { archived_at: null };
      const low = query.low_stock === undefined ? undefined : await lowStockIds(trx, 'accessory');
      // M2-LOC-03 (ED-26): stock kept inside the caller's location scope only
      const inScope = await locationScopeWhere(trx, 'location_id');
      const filter = {
        AND: [
          inScope,
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
          trx.accessory.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<AccessoryRow & Record<string, unknown>>>,
        count: () => trx.accessory.count({ where: filter }),
      });
      const out = await outstandingByAccessory(
        trx,
        page.data.map((r) => r.id),
      );
      return { data: page.data.map((r) => accessoryDto(r, out.get(r.id) ?? 0)), page: page.page };
    });
  }

  async get(
    auth: AuthContext,
    id: string,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const row = await trx.accessory.findUnique({ where: { id } });
      if (!row || !(await locationInScope(trx, row.location_id))) {
        throw problem.notFound('Accessory not found.');
      }
      const out = await outstandingByAccessory(trx, [id]);
      return { data: accessoryDto(row, out.get(id) ?? 0), version: row.version };
    });
  }

  /** The assignments of one accessory, newest first: who holds how many units. */
  async assignments(
    auth: AuthContext,
    id: string,
    query: AccessoryAssignmentsQuery,
  ): Promise<Page<AssignmentDto>> {
    return this.tx(auth, async (trx) => {
      const exists = await trx.accessory.findUnique({
        where: { id },
        select: { id: true, location_id: true },
      });
      if (!exists || !(await locationInScope(trx, exists.location_id))) {
        throw problem.notFound('Accessory not found.');
      }
      return listAssignments(trx, { accessoryId: id, state: query.state }, query);
    });
  }

  // ----------------------------------------------------------------------------------- writes

  async create(
    auth: AuthContext,
    body: AccessoryCreate,
  ): Promise<{ data: AccessoryDto; version: number }> {
    return this.tx(auth, async (trx) => {
      const errors: FieldError[] = [];
      await checkStockRefs(trx, 'accessory', body, errors, true);
      const companyId = await resolveCompany(trx, body.company_id);
      if (!companyId) errors.push(invalidRef('/company_id', 'No company.'));
      if (errors.length > 0) throw problem.validation(errors);

      const row = await trx.accessory.create({
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
          qty_total: body.qty_total,
          min_qty: body.min_qty ?? 0,
          purchase_date: dateOrNull(body.purchase_date),
          purchase_cost_minor: body.purchase_cost ? BigInt(body.purchase_cost.amount_minor) : null,
          currency: body.purchase_cost?.currency ?? null,
          notes: body.notes ?? null,
          created_by: auth.userId,
        },
      });
      await this.record(trx, {
        entity: 'accessory',
        verb: 'created',
        id: row.id,
        version: row.version,
        before: null,
        after: auditView(accessoryDto(row, 0)),
      });
      await reevaluateAccessory(trx, this.outbox, row.id);
      // the low-stock latch may have touched the row: answer with its current version
      const fresh = (await trx.accessory.findUnique({ where: { id: row.id } }))!;
      return { data: accessoryDto(fresh, 0), version: fresh.version };
    });
  }

  async update(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: AccessoryUpdate,
  ): Promise<{ data: AccessoryDto; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        await this.lockAccessory(trx, id);
        const row = await trx.accessory.findUnique({ where: { id } });
        if (!row || row.archived_at) throw problem.notFound('Accessory not found.');
        assertIfMatch(ifMatch, row.version);

        const errors: FieldError[] = [];
        await checkStockRefs(
          trx,
          'accessory',
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
          'qty_total',
          'min_qty',
          'notes',
        ] as const) {
          const value = body[key];
          if (value !== undefined && value !== row[key]) changes[key] = value;
        }
        if (
          body.purchase_date !== undefined &&
          body.purchase_date !== (row.purchase_date?.toISOString().slice(0, 10) ?? null)
        ) {
          changes.purchase_date = dateOrNull(body.purchase_date);
        }
        if (body.purchase_cost !== undefined) {
          const minor = body.purchase_cost ? BigInt(body.purchase_cost.amount_minor) : null;
          const currency = body.purchase_cost?.currency ?? null;
          if (minor !== row.purchase_cost_minor || currency !== row.currency) {
            changes.purchase_cost_minor = minor;
            changes.currency = currency;
          }
        }

        const out = (await outstandingByAccessory(trx, [id])).get(id) ?? 0;
        if (typeof changes.qty_total === 'number' && changes.qty_total < out) {
          throw insufficientStock(
            `${out} unit(s) are checked out: the total cannot be lowered to ${changes.qty_total}.`,
            { checked_out: out, requested_total: changes.qty_total },
          );
        }
        if (Object.keys(changes).length === 0) {
          return { data: accessoryDto(row, out), version: row.version };
        }
        const result = await trx.accessory.updateMany({
          where: { id, version: row.version },
          data: { ...changes, updated_by: auth.userId },
        });
        if (result.count === 0) {
          return stalePrecondition(() => trx.accessory.findUnique({ where: { id } }), 'Accessory');
        }
        const updated = (await trx.accessory.findUnique({ where: { id } }))!;
        await this.record(trx, {
          entity: 'accessory',
          verb: 'updated',
          id,
          version: updated.version,
          before: auditView(accessoryDto(row, out)),
          after: auditView(accessoryDto(updated, out)),
        });
        await reevaluateAccessory(trx, this.outbox, id);
        const fresh = (await trx.accessory.findUnique({ where: { id } }))!;
        return { data: accessoryDto(fresh, out), version: fresh.version };
      });
    } catch (err) {
      throw this.translate(err);
    }
  }

  async archive(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<void> {
    await this.tx(auth, async (trx) => {
      await this.lockAccessory(trx, id);
      const row = await trx.accessory.findUnique({ where: { id } });
      if (!row || row.archived_at) throw problem.notFound('Accessory not found.');
      assertIfMatch(ifMatch, row.version);
      const open = await trx.assignment.count({ where: { accessory_id: id, checked_in_at: null } });
      if (open > 0) throw inUse('Accessory', { open_assignments: open });
      const result = await trx.accessory.updateMany({
        where: { id, version: row.version },
        data: { archived_at: new Date(), updated_by: auth.userId },
      });
      if (result.count === 0) {
        return stalePrecondition(() => trx.accessory.findUnique({ where: { id } }), 'Accessory');
      }
      const updated = (await trx.accessory.findUnique({ where: { id } }))!;
      await this.record(trx, {
        entity: 'accessory',
        verb: 'archived',
        id,
        version: updated.version,
        before: auditView(accessoryDto(row, 0)),
        after: auditView(accessoryDto(updated, 0)),
      });
    });
  }

  // =========================================================================================
  // Check-out and check-in

  /** `POST /v1/accessories/{id}/checkout`: hands `quantity` units to a person, location or asset. */
  async checkout(
    auth: AuthContext,
    id: string,
    body: AccessoryCheckoutBody,
  ): Promise<{ assignment: AssignmentDto; accessoryId: string }> {
    try {
      return await this.tx(auth, async (trx) => {
        const acc = await this.lockAccessory(trx, id);
        if (acc.archived_at) {
          throw problem.conflict('The accessory is archived: units cannot be checked out.');
        }
        const target = await this.resolveTarget(trx, body);
        if (body.expected_return && body.expected_return < dayBefore()) {
          throw problem.validation([
            {
              pointer: '/expected_return',
              message: `must not be in the past (today is ${todayUtc()} UTC)`,
              code: 'in-the-past',
            },
          ]);
        }
        const out = (await outstandingByAccessory(trx, [id])).get(id) ?? 0;
        const available = acc.qty_total - out;
        if (body.quantity > available) {
          throw insufficientStock(
            `Only ${available} of ${acc.qty_total} unit(s) are available; ${body.quantity} requested.`,
            { available, requested: body.quantity },
          );
        }

        const assignmentId = uuidv7();
        await trx.assignment.create({
          data: {
            id: assignmentId,
            tenant_id: auth.tenantId,
            accessory_id: id,
            ...targetColumns(target),
            quantity: body.quantity,
            expected_return: dateOrNull(body.expected_return),
            checked_out_by: auth.userId,
            note: body.note ?? null,
          },
        });
        const assignment = (await loadAssignment(trx, assignmentId))!;

        await this.record(trx, {
          entity: 'accessory',
          verb: 'checked_out',
          id,
          version: acc.version,
          before: { qty_checked_out: out },
          after: { qty_checked_out: out + body.quantity },
          meta: {
            assignment_id: assignmentId,
            quantity: body.quantity,
            target_type: target.type,
            target_id: target.id,
            target_name: target.name,
            expected_return: body.expected_return ?? null,
            ...(body.note ? { note: body.note } : {}),
          },
          refs: { assignmentId, [`${target.type}Id`]: target.id },
        });
        await reevaluateAccessory(trx, this.outbox, id, { assignmentId });
        return {
          accessoryId: id,
          assignment: assignmentDto(assignment, {
            accessory_name: acc.name,
            target_name: target.name,
          }),
        };
      });
    } catch (err) {
      throw this.translate(err);
    }
  }

  /** `POST /v1/accessories/{id}/checkin`: returns `quantity` units (default: all that are still out). */
  async checkin(
    auth: AuthContext,
    id: string,
    body: AccessoryCheckinBody,
  ): Promise<{ assignment: AssignmentDto }> {
    return this.tx(auth, async (trx) => {
      const acc = await this.lockAccessory(trx, id);
      const open = await loadAssignment(trx, body.assignment_id);
      if (!open || open.accessory_id !== id) {
        throw problem.validation([
          invalidRef('/assignment_id', 'No such assignment of this accessory.'),
        ]);
      }
      if (open.checked_in_at) {
        throw problem.conflict('This custody period is already fully returned.');
      }
      const outstanding = open.quantity - open.quantity_returned;
      const returning = body.quantity ?? outstanding;
      if (returning > outstanding) {
        throw problem.validation([
          {
            pointer: '/quantity',
            message: `only ${outstanding} unit(s) are still out on this assignment`,
            code: 'too-many',
          },
        ]);
      }
      const updated = await trx.$queryRaw<Array<{ id: string }>>`
        update app.assignment
           set quantity_returned = quantity_returned + ${returning}::int,
               checked_in_at = case when quantity_returned + ${returning}::int = quantity
                                    then greatest(now(), checked_out_at) else null end,
               checked_in_by = case when quantity_returned + ${returning}::int = quantity
                                    then ${auth.userId}::uuid else checked_in_by end,
               checkin_note = coalesce(${body.note ?? null}::text, checkin_note)
         where id = ${open.id}::uuid and checked_in_at is null
        returning id`;
      if (updated.length === 0) {
        throw problem.conflict(
          'The custody period was closed by another request. Reload and retry.',
        );
      }
      const assignment = (await loadAssignment(trx, open.id))!;
      const closed = assignment.checked_in_at !== null;
      const out = await this.outstanding(trx, id);

      await this.record(trx, {
        entity: 'accessory',
        verb: 'checked_in',
        id,
        version: acc.version,
        before: { qty_checked_out: out + returning },
        after: { qty_checked_out: out },
        meta: {
          assignment_id: open.id,
          quantity: returning,
          quantity_returned: assignment.quantity_returned,
          closed,
          ...(body.note ? { note: body.note } : {}),
        },
        refs: { assignmentId: open.id },
      });
      await reevaluateAccessory(trx, this.outbox, id, { assignmentId: open.id });
      return { assignment: assignmentDto(assignment, { accessory_name: acc.name }) };
    });
  }

  // ------------------------------------------------------------------------------------ helpers

  /** Locks the accessory row (404 when missing): the serialisation point of every stock change. */
  private async lockAccessory(
    trx: Tx,
    id: string,
  ): Promise<{
    id: string;
    name: string;
    qty_total: number;
    min_qty: number;
    archived_at: Date | null;
    version: number;
  }> {
    const [row] = await trx.$queryRaw<
      Array<{
        id: string;
        name: string;
        qty_total: number;
        min_qty: number;
        archived_at: Date | null;
        version: number;
      }>
    >`select id, name, qty_total, min_qty, archived_at, version
        from app.accessory where id = ${id}::uuid
         and ${locationScopeSql(Prisma.sql`location_id`)} for update`;
    if (!row) throw problem.notFound('Accessory not found.');
    return row;
  }

  private async outstanding(trx: Tx, id: string): Promise<number> {
    return (await outstandingByAccessory(trx, [id])).get(id) ?? 0;
  }

  /** The person / location / asset the request points at, validated (422 with a pointer). */
  private async resolveTarget(
    trx: Tx,
    body: {
      person_id?: string | undefined;
      location_id?: string | undefined;
      target_asset_id?: string | undefined;
    },
  ): Promise<Target> {
    if (body.person_id) {
      // M2-LOC-03 (ED-26): a person outside the caller's scope does not exist for them
      const person = (await personInScope(trx, body.person_id))
        ? await trx.person.findUnique({ where: { id: body.person_id } })
        : null;
      if (!person || person.archived_at) {
        throw problem.validation([invalidRef('/person_id', 'No such person.')]);
      }
      if (person.status !== 'active') {
        throw problem.validation([
          {
            pointer: '/person_id',
            message: 'inactive people cannot receive accessories',
            code: 'inactive',
          },
        ]);
      }
      return { type: 'person', id: person.id, name: person.display_name };
    }
    if (body.location_id) {
      const location = (await locationInScope(trx, body.location_id))
        ? await trx.location.findUnique({ where: { id: body.location_id } })
        : null;
      if (!location || location.archived_at) {
        throw problem.validation([invalidRef('/location_id', 'No such location.')]);
      }
      return { type: 'location', id: location.id, name: location.name };
    }
    const target = (await assetInScope(trx, body.target_asset_id!))
      ? await trx.asset.findUnique({
          where: { id: body.target_asset_id! },
          select: { id: true, asset_tag: true, name: true, archived_at: true },
        })
      : null;
    if (!target || target.archived_at) {
      throw problem.validation([invalidRef('/target_asset_id', 'No such asset.')]);
    }
    return {
      type: 'asset',
      id: target.id,
      name: target.name ? `${target.asset_tag} ${target.name}` : target.asset_tag,
    };
  }

  private translate(err: unknown): unknown {
    if (isStockViolation(err)) {
      return insufficientStock('Not enough units are available for this change.', {});
    }
    return err;
  }
}

/** Column values of the assignment's single target. */
const targetColumns = (t: Target) =>
  t.type === 'person'
    ? { person_id: t.id }
    : t.type === 'location'
      ? { location_id: t.id }
      : { target_asset_id: t.id };
