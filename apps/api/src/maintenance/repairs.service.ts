import { Inject, Injectable } from '@nestjs/common';
import { type AuthContext, permits } from '../auth/index.js';
import { AttachmentsService } from '../files/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { CustodyService } from '../lifecycle/index.js';
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
  type AssetRow,
  RegistryBase,
  assertAssetAction,
  invalidRef,
  isForeignKeyViolation,
  loadAsset,
  lockAsset,
  stalePrecondition,
  writeAssetHistory,
} from '../registry/index.js';
import { TenancyService, isUniqueViolation, type Tx } from '../tenancy/index.js';
import type {
  RepairComplete,
  RepairCreate,
  RepairListQuery,
  RepairUpdate,
} from './schemas.js';

type RepairRow = NonNullable<Awaited<ReturnType<Tx['maintenance_record']['findUnique']>>>;

const SPEC: ListSpec = {
  sortable: { reported_at: { kind: 'date' }, created_at: { kind: 'date' } },
  defaultSort: '-reported_at',
};

/** Records that still hold work: they keep the asset's status and block archiving the asset. */
const OPEN = ['open', 'in_progress'] as const;
const isOpen = (status: string): boolean => (OPEN as readonly string[]).includes(status);

/** Names resolved for display next to the ids of a repair. */
interface Names {
  asset_tag: string | null;
  asset_name: string | null;
  vendor_name: string | null;
}

/** Schema `Repair`. */
export function repairDto(r: RepairRow, names: Names = nameless) {
  return {
    id: r.id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    archived_at: r.archived_at ? r.archived_at.toISOString() : null,
    asset_id: r.asset_id,
    kind: r.kind,
    title: r.title,
    description: r.description,
    reported_at: r.reported_at.toISOString(),
    started_at: r.started_at ? r.started_at.toISOString() : null,
    vendor_id: r.vendor_id,
    performed_by_person_id: r.performed_by_person_id,
    ticket_ref: r.ticket_ref,
    cost:
      r.cost_minor === null || r.currency === null
        ? null
        : { amount_minor: Number(r.cost_minor), currency: r.currency },
    restore_status_id: r.restore_status_id,
    status: r.status,
    completed_at: r.completed_at ? r.completed_at.toISOString() : null,
    resolution_notes: r.resolution_notes,
    set_status_id: r.set_status_id,
    ...names,
  };
}
const nameless: Names = { asset_tag: null, asset_name: null, vendor_name: null };

/** What the audit trail keeps of a repair (no derived names). */
const auditView = (dto: ReturnType<typeof repairDto>): Record<string, unknown> => {
  const {
    created_at: _c,
    updated_at: _u,
    asset_tag: _t,
    asset_name: _n,
    vendor_name: _v,
    ...rest
  } = dto;
  return rest;
};

/** Status label states a repair may move an asset to, or restore it to. */
const MOVABLE_STATES = ['deployable', 'pending', 'undeployable'] as const;

/**
 * Repairs and maintenance (M2-MNT-01). Every write runs in ONE tenant transaction that starts by
 * LOCKING the asset row (the same `SELECT .. FOR UPDATE` custody uses), so a repair opening and a
 * check-out of the same asset are serialised and the loser sees the winner's state.
 *
 * Opening a record may move the asset to an in-repair status (`set_status_id`, an `undeployable`
 * label as a rule), which is what blocks its check-out; what the asset was before is remembered in
 * `restore_status_id` and put back when the record is completed or cancelled, but only while the asset
 * still has the status the repair gave it (a status somebody chose meanwhile is not overridden). A
 * checked-out asset is repaired after a check-in, or with `force_checkin` (the custody period is closed
 * in the same transaction through `CustodyService.checkin`, which needs `asset:checkin` on top of
 * `repair:manage`). History (`repair_opened`, `repair_completed`), audit rows and outbox events
 * (`repair.opened`, `repair.completed`, `repair.updated`, `repair.cancelled`, `repair.archived`) are
 * written in the same transaction.
 */
@Injectable()
export class RepairsService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
    private readonly custody: CustodyService,
    private readonly attachments: AttachmentsService,
  ) {
    super(tenancy, audit, outbox);
  }

  // ------------------------------------------------------------------------------------ reads

  async list(auth: AuthContext, query: RepairListQuery): Promise<Page<Record<string, unknown>>> {
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
          query.asset_id ? { asset_id: query.asset_id } : {},
          query.status?.length ? { status: { in: query.status } } : {},
          query.kind?.length ? { kind: { in: query.kind } } : {},
          query.vendor_id ? { vendor_id: query.vendor_id } : {},
          query.reported_from ? { reported_at: { gte: new Date(query.reported_from) } } : {},
          query.reported_to ? { reported_at: { lt: new Date(query.reported_to) } } : {},
        ],
      };
      const page = await listPage({
        query,
        spec: SPEC,
        filters: {
          archived: query.archived,
          asset_id: query.asset_id,
          status: query.status,
          kind: query.kind,
          vendor_id: query.vendor_id,
          reported_from: query.reported_from,
          reported_to: query.reported_to,
        },
        fetch: ({ take, orderBy, where }) =>
          trx.maintenance_record.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<RepairRow & Record<string, unknown>>>,
        count: () => trx.maintenance_record.count({ where: filter }),
      });
      const names = await this.namesFor(trx, page.data);
      return { data: page.data.map((r) => repairDto(r, names(r))), page: page.page };
    });
  }

  async get(
    auth: AuthContext,
    id: string,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const row = await trx.maintenance_record.findUnique({ where: { id } });
      if (!row) throw problem.notFound('Repair not found.');
      const names = await this.namesFor(trx, [row]);
      return { data: repairDto(row, names(row)), version: row.version };
    });
  }

  /** Counts and total cost per currency of one asset's records (cancelled and archived excluded). */
  async summary(auth: AuthContext, assetId: string) {
    return this.tx(auth, async (trx) => {
      const asset = await trx.asset.findUnique({ where: { id: assetId }, select: { id: true } });
      if (!asset) throw problem.notFound('Asset not found.');
      const [counts] = await trx.$queryRaw<Array<{ open: bigint; total: bigint }>>`
        select count(*) filter (where status in ('open', 'in_progress')) as open, count(*) as total
          from app.maintenance_record
         where asset_id = ${assetId}::uuid and status <> 'cancelled' and archived_at is null`;
      const costs = await trx.$queryRaw<Array<{ currency: string; amount: bigint }>>`
        select currency, sum(cost_minor)::bigint as amount from app.maintenance_record
         where asset_id = ${assetId}::uuid and status <> 'cancelled' and archived_at is null
           and cost_minor is not null
         group by currency order by currency`;
      return {
        asset_id: assetId,
        open_count: Number(counts?.open ?? 0n),
        total_count: Number(counts?.total ?? 0n),
        total_cost: costs.map((c) => ({ amount_minor: Number(c.amount), currency: c.currency })),
      };
    });
  }

  // ----------------------------------------------------------------------------------- writes

  async create(
    auth: AuthContext,
    body: RepairCreate,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      let asset = await lockAsset(trx, body.asset_id);
      if (!asset) throw problem.validation([invalidRef('/asset_id', 'No such asset.')]);

      const errors: FieldError[] = [];
      await this.checkRefs(trx, body, errors);
      const setStatus = body.set_status_id
        ? await this.movableStatus(trx, body.set_status_id, '/set_status_id', errors)
        : undefined;
      if (body.restore_status_id && !body.set_status_id) {
        errors.push({
          pointer: '/restore_status_id',
          message: 'only makes sense together with set_status_id',
          code: 'invalid',
        });
      }
      const restoreRequested = body.restore_status_id
        ? await this.movableStatus(trx, body.restore_status_id, '/restore_status_id', errors)
        : undefined;
      if (body.force_checkin) {
        if (!body.force_note) {
          errors.push({
            pointer: '/force_note',
            message: 'a forced check-in needs a note saying why',
            code: 'required',
          });
        }
        if (!body.set_status_id) {
          errors.push({
            pointer: '/set_status_id',
            message:
              'a forced check-in needs the in-repair status the asset moves to, so it cannot be handed out meanwhile',
            code: 'required',
          });
        }
      }
      if (errors.length > 0) throw problem.validation(errors);

      // The asset's state decides whether a repair can open; a checked-out asset only with force.
      const state = stateOf(asset);
      const prior = asset;
      let forced: { assignmentId: string } | undefined;
      if (state.hasAssignment && body.force_checkin) {
        if (!permits(auth.permissions, 'asset:checkin')) {
          throw problem.forbidden(
            'Forcing a repair on a checked-out asset closes its custody period: it needs the asset:checkin permission as well.',
          );
        }
        assertAssetAction('open_repair', { ...state, hasAssignment: false });
        const checkedIn = await this.custody.checkin(
          auth,
          asset.id,
          { kind: 'any' },
          { status_id: setStatus!.id, note: body.force_note! },
        );
        forced = { assignmentId: checkedIn.assignment.id };
        asset = (await loadAsset(trx, asset.id))!;
      } else {
        assertAssetAction('open_repair', state);
      }

      // Only one open record at a time moves the asset's status: the restore target stays unambiguous.
      const moves =
        setStatus !== undefined && (forced !== undefined || setStatus.id !== prior.status_id);
      if (moves) {
        const other = await trx.maintenance_record.findFirst({
          where: {
            asset_id: asset.id,
            set_status_id: { not: null },
            status: { in: [...OPEN] },
            archived_at: null,
          },
          select: { id: true, title: true },
        });
        if (other) {
          throw problem.conflict(
            `Another open repair ("${other.title}") already moved this asset's status. Complete or cancel it first, or open this one without set_status_id.`,
          );
        }
      }

      const restoreId = moves
        ? (restoreRequested?.id ?? (await this.defaultRestore(trx, prior, forced !== undefined)))
        : null;
      const now = new Date();
      const status = body.status ?? 'open';
      const id = uuidv7();
      const row = await trx.maintenance_record.create({
        data: {
          id,
          tenant_id: auth.tenantId,
          asset_id: asset.id,
          kind: body.kind ?? 'repair',
          status,
          title: body.title,
          description: body.description ?? null,
          reported_at: body.reported_at ? new Date(body.reported_at) : now,
          started_at: body.started_at
            ? new Date(body.started_at)
            : status === 'in_progress'
              ? now
              : null,
          vendor_id: body.vendor_id ?? null,
          performed_by_person_id: body.performed_by_person_id ?? null,
          ticket_ref: body.ticket_ref ?? null,
          cost_minor: body.cost ? BigInt(body.cost.amount_minor) : null,
          currency: body.cost ? body.cost.currency : null,
          set_status_id: moves ? setStatus!.id : null,
          restore_status_id: restoreId,
          created_by: auth.userId,
        },
      });
      await this.attachments.linkToOwner(
        trx,
        body.attachment_ids ?? [],
        { type: 'maintenance_record', id },
        { allowFrom: [{ type: 'asset', id: asset.id }], pointer: '/attachment_ids' },
      );

      // Moving the asset to the in-repair status is what blocks its check-out.
      const statusChange = moves ? await this.moveAsset(trx, auth, prior, asset, setStatus!.id) : null;
      const dto = repairDto(row, await this.namesOf(trx, row));
      await this.record(trx, {
        entity: 'repair',
        verb: 'opened',
        id,
        version: row.version,
        before: null,
        after: auditView(dto),
        meta: {
          asset_id: asset.id,
          ...(statusChange ? { asset_status: statusChange } : {}),
          ...(forced ? { forced_checkin: true, assignment_id: forced.assignmentId } : {}),
        },
        refs: { assetId: asset.id },
      });
      await writeAssetHistory(trx, auth, {
        assetId: asset.id,
        eventType: 'repair_opened',
        summary: `Repair opened: ${row.title}`,
        payload: {
          repair_id: id,
          kind: row.kind,
          title: row.title,
          ...(statusChange ? { status: statusChange } : {}),
          ...(forced ? { forced_checkin: true, note: body.force_note } : {}),
          ...(body.attachment_ids?.length ? { attachment_ids: body.attachment_ids } : {}),
        },
      });
      return { data: dto, version: row.version };
    });
  }

  async update(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: RepairUpdate,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const found = await trx.maintenance_record.findUnique({ where: { id } });
      if (!found || found.archived_at) throw problem.notFound('Repair not found.');
      // The asset first (lock order is always asset, then record), then the record under that lock.
      const asset = (await lockAsset(trx, found.asset_id))!;
      const row = (await trx.maintenance_record.findUnique({ where: { id } }))!;
      assertIfMatch(ifMatch, row.version);

      const closing = body.status === 'cancelled';
      if (body.status !== undefined && body.status !== row.status && !isOpen(row.status)) {
        throw problem.conflict(`The repair is ${row.status}; its status can no longer change.`);
      }
      const errors: FieldError[] = [];
      await this.checkRefs(trx, body, errors);
      let restoreStatus: { id: string; name: string } | undefined;
      if (body.restore_status_id) {
        restoreStatus = await this.movableStatus(
          trx,
          body.restore_status_id,
          '/restore_status_id',
          errors,
        );
      }
      if (body.restore_status_id !== undefined && (!row.set_status_id || !isOpen(row.status))) {
        errors.push({
          pointer: '/restore_status_id',
          message: 'only an open repair that moved the asset has a status to restore',
          code: 'invalid',
        });
      }
      if (errors.length > 0) throw problem.validation(errors);

      const changes: Record<string, unknown> = {};
      const set = <K extends keyof RepairUpdate>(key: K, column: string = key) => {
        const value = body[key];
        if (value !== undefined) changes[column] = value;
      };
      set('kind');
      set('title');
      set('description');
      set('ticket_ref');
      set('vendor_id');
      set('performed_by_person_id');
      if (body.reported_at !== undefined) changes.reported_at = new Date(body.reported_at);
      if (body.started_at !== undefined) {
        changes.started_at = body.started_at ? new Date(body.started_at) : null;
      }
      if (body.cost !== undefined) {
        changes.cost_minor = body.cost ? BigInt(body.cost.amount_minor) : null;
        changes.currency = body.cost ? body.cost.currency : null;
      }
      if (restoreStatus) changes.restore_status_id = restoreStatus.id;
      if (body.restore_status_id === null) changes.restore_status_id = null;
      if (body.status === 'in_progress' && row.status === 'open') {
        changes.status = 'in_progress';
        if (!row.started_at && body.started_at === undefined) changes.started_at = new Date();
      } else if (body.status === 'open' && row.status === 'in_progress') {
        changes.status = 'open';
      } else if (closing) {
        changes.status = 'cancelled';
      }

      let statusChange: Record<string, unknown> | null = null;
      if (closing) {
        statusChange = await this.restoreAsset(trx, auth, asset, row, undefined);
      }
      if (Object.keys(changes).length === 0) {
        return { data: repairDto(row, await this.namesOf(trx, row)), version: row.version };
      }
      let updated: RepairRow;
      try {
        updated = await this.write(trx, auth, row, changes);
      } catch (err) {
        throw this.translate(err);
      }
      const dto = repairDto(updated, await this.namesOf(trx, updated));
      await this.record(trx, {
        entity: 'repair',
        verb: closing ? 'cancelled' : 'updated',
        id,
        version: updated.version,
        before: auditView(repairDto(row)),
        after: auditView(dto),
        ...(statusChange ? { meta: { asset_status: statusChange } } : {}),
        refs: { assetId: row.asset_id },
      });
      if (closing) {
        await writeAssetHistory(trx, auth, {
          assetId: row.asset_id,
          eventType: 'repair_completed',
          summary: `Repair cancelled: ${row.title}`,
          payload: {
            repair_id: id,
            outcome: 'cancelled',
            title: row.title,
            ...(statusChange ? { status: statusChange } : {}),
          },
        });
      }
      return { data: dto, version: updated.version };
    });
  }

  async complete(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: RepairComplete,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const found = await trx.maintenance_record.findUnique({ where: { id } });
      if (!found || found.archived_at) throw problem.notFound('Repair not found.');
      const asset = (await lockAsset(trx, found.asset_id))!;
      const row = (await trx.maintenance_record.findUnique({ where: { id } }))!;
      assertIfMatch(ifMatch, row.version);
      if (!isOpen(row.status)) {
        throw problem.conflict(`The repair is already ${row.status}.`);
      }
      const errors: FieldError[] = [];
      const completedAt = body.completed_at ? new Date(body.completed_at) : new Date();
      if (row.started_at && completedAt < row.started_at) {
        errors.push({
          pointer: '/completed_at',
          message: 'must not be before the repair started',
          code: 'invalid',
        });
      }
      let explicitRestore: { id: string; name: string } | undefined;
      if (body.restore_status_id) {
        explicitRestore = await this.movableStatus(
          trx,
          body.restore_status_id,
          '/restore_status_id',
          errors,
        );
      }
      if (errors.length > 0) throw problem.validation(errors);

      const statusChange = await this.restoreAsset(trx, auth, asset, row, explicitRestore);
      const changes: Record<string, unknown> = {
        status: 'completed',
        completed_at: completedAt,
        ...(body.resolution_notes !== undefined ? { resolution_notes: body.resolution_notes } : {}),
      };
      if (body.cost !== undefined) {
        changes.cost_minor = body.cost ? BigInt(body.cost.amount_minor) : null;
        changes.currency = body.cost ? body.cost.currency : null;
      }
      let updated: RepairRow;
      try {
        updated = await this.write(trx, auth, row, changes);
      } catch (err) {
        throw this.translate(err);
      }
      await this.attachments.linkToOwner(
        trx,
        body.attachment_ids ?? [],
        { type: 'maintenance_record', id },
        {
          allowFrom: [
            { type: 'asset', id: row.asset_id },
            { type: 'maintenance_record', id },
          ],
          pointer: '/attachment_ids',
        },
      );
      const dto = repairDto(updated, await this.namesOf(trx, updated));
      await this.record(trx, {
        entity: 'repair',
        verb: 'completed',
        id,
        version: updated.version,
        before: auditView(repairDto(row)),
        after: auditView(dto),
        ...(statusChange ? { meta: { asset_status: statusChange } } : {}),
        refs: { assetId: row.asset_id },
      });
      await writeAssetHistory(trx, auth, {
        assetId: row.asset_id,
        eventType: 'repair_completed',
        summary: `Repair completed: ${row.title}`,
        payload: {
          repair_id: id,
          outcome: 'completed',
          title: row.title,
          ...(dto.cost ? { cost: dto.cost } : {}),
          ...(statusChange ? { status: statusChange } : {}),
          ...(body.attachment_ids?.length ? { attachment_ids: body.attachment_ids } : {}),
        },
      });
      return { data: dto, version: updated.version };
    });
  }

  async archive(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<void> {
    await this.tx(auth, async (trx) => {
      const row = await trx.maintenance_record.findUnique({ where: { id } });
      if (!row || row.archived_at) throw problem.notFound('Repair not found.');
      assertIfMatch(ifMatch, row.version);
      if (isOpen(row.status)) {
        throw problem.conflict('The repair is still open. Complete or cancel it first.');
      }
      const updated = await this.write(trx, auth, row, { archived_at: new Date() });
      await this.record(trx, {
        entity: 'repair',
        verb: 'archived',
        id,
        version: updated.version,
        before: auditView(repairDto(row)),
        after: auditView(repairDto(updated)),
        refs: { assetId: row.asset_id },
      });
    });
  }

  // ------------------------------------------------------------------------------- building blocks

  /** Optimistic write of one record: a concurrent change answers 412, a vanished row 404. */
  private async write(
    trx: Tx,
    auth: AuthContext,
    row: RepairRow,
    changes: Record<string, unknown>,
  ): Promise<RepairRow> {
    const result = await trx.maintenance_record.updateMany({
      where: { id: row.id, version: row.version },
      data: { ...changes, updated_by: auth.userId },
    });
    if (result.count === 0) {
      return stalePrecondition(
        () => trx.maintenance_record.findUnique({ where: { id: row.id } }),
        'Repair',
      );
    }
    return (await trx.maintenance_record.findUnique({ where: { id: row.id } }))!;
  }

  /**
   * Moves the asset to `statusId` (optimistic on the version the lock read) and describes the change
   * from the status it had in `before`. Nothing is written when `current` already has the status (a
   * forced check-in put it there).
   */
  private async moveAsset(
    trx: Tx,
    auth: AuthContext,
    before: AssetRow,
    current: AssetRow,
    statusId: string,
  ): Promise<{ from: string; to: string; from_name: string; to_name: string }> {
    if (current.status_id !== statusId) {
      const result = await trx.asset.updateMany({
        where: { id: current.id, version: current.version },
        data: { status_id: statusId, updated_by: auth.userId },
      });
      if (result.count === 0) {
        return stalePrecondition(
          () => trx.asset.findUnique({ where: { id: current.id } }),
          'Asset',
        );
      }
    }
    const label = await trx.status_label.findUnique({ where: { id: statusId } });
    return {
      from: before.status_id,
      to: statusId,
      from_name: before.status_name,
      to_name: label?.name ?? '',
    };
  }

  /**
   * Puts the asset's status back when a repair that moved it closes: the explicit status of the request,
   * else the one remembered when the repair opened. Applied only while the asset still has the status
   * the repair gave it, or when the caller named the status explicitly; never to a checked-out asset.
   */
  private async restoreAsset(
    trx: Tx,
    auth: AuthContext,
    asset: AssetRow,
    row: RepairRow,
    explicit: { id: string; name: string } | undefined,
  ): Promise<{ from: string; to: string; from_name: string; to_name: string } | null> {
    const target = explicit?.id ?? row.restore_status_id;
    if (!target || target === asset.status_id) return null;
    if (asset.archived_at || (asset.assignment !== null && asset.assignment !== undefined)) {
      return null;
    }
    if (!explicit && row.set_status_id !== asset.status_id) return null;
    const label = await trx.status_label.findUnique({ where: { id: target } });
    if (!label || label.archived_at) return null;
    return this.moveAsset(trx, auth, asset, asset, target);
  }

  /** The status a repair returns the asset to when none was named: what it had, or the default deployable one. */
  private async defaultRestore(trx: Tx, asset: AssetRow, wasCheckedOut: boolean): Promise<string> {
    if (!wasCheckedOut && asset.status_state_type !== 'deployed') return asset.status_id;
    const label =
      (await trx.status_label.findFirst({
        where: { state_type: 'deployable', is_default: true, archived_at: null },
      })) ??
      (await trx.status_label.findFirst({
        where: { state_type: 'deployable', archived_at: null },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }));
    if (!label) {
      throw problem.conflict(
        'The tenant has no active status label of type "deployable" to return the asset to after the repair. Create one in the status labels first.',
      );
    }
    return label.id;
  }

  private async movableStatus(
    trx: Tx,
    id: string,
    pointer: string,
    errors: FieldError[],
  ): Promise<{ id: string; name: string }> {
    const label = await trx.status_label.findUnique({ where: { id } });
    if (!label || label.archived_at) {
      errors.push(invalidRef(pointer, 'No such status label.'));
      return { id, name: '' };
    }
    if (!(MOVABLE_STATES as readonly string[]).includes(label.state_type)) {
      errors.push({
        pointer,
        message: `a repair cannot use a status of type "${label.state_type}" (use deployable, pending or undeployable)`,
        code: 'invalid',
      });
    }
    return label;
  }

  private async checkRefs(
    trx: Tx,
    body: Pick<RepairCreate, 'vendor_id' | 'performed_by_person_id'>,
    errors: FieldError[],
  ): Promise<void> {
    if (body.vendor_id) {
      const vendor = await trx.vendor.findUnique({ where: { id: body.vendor_id } });
      if (!vendor || vendor.archived_at) errors.push(invalidRef('/vendor_id', 'No such vendor.'));
    }
    if (body.performed_by_person_id) {
      const person = await trx.person.findUnique({ where: { id: body.performed_by_person_id } });
      if (!person || person.archived_at) {
        errors.push(invalidRef('/performed_by_person_id', 'No such person.'));
      }
    }
  }

  /** Display names of the assets and vendors of a set of records (two small queries). */
  private async namesFor(
    trx: Tx,
    rows: readonly RepairRow[],
  ): Promise<(r: RepairRow) => Names> {
    const assetIds = [...new Set(rows.map((r) => r.asset_id))];
    const vendorIds = [...new Set(rows.map((r) => r.vendor_id).filter((v): v is string => !!v))];
    const assets = assetIds.length
      ? await trx.asset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, asset_tag: true, name: true },
        })
      : [];
    const vendors = vendorIds.length
      ? await trx.vendor.findMany({
          where: { id: { in: vendorIds } },
          select: { id: true, name: true },
        })
      : [];
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const vendorById = new Map(vendors.map((v) => [v.id, v]));
    return (r) => ({
      asset_tag: assetById.get(r.asset_id)?.asset_tag ?? null,
      asset_name: assetById.get(r.asset_id)?.name ?? null,
      vendor_name: r.vendor_id ? (vendorById.get(r.vendor_id)?.name ?? null) : null,
    });
  }

  private async namesOf(trx: Tx, row: RepairRow): Promise<Names> {
    return (await this.namesFor(trx, [row]))(row);
  }

  private translate(err: unknown): unknown {
    if (isUniqueViolation(err)) {
      return problem.conflict(
        "Another open repair already moved this asset's status. Complete or cancel it first.",
      );
    }
    if (isForeignKeyViolation(err)) {
      return problem.validation([
        { pointer: '/', message: 'A referenced record no longer exists.', code: 'not-found' },
      ]);
    }
    return err;
  }
}

const stateOf = (row: AssetRow) => ({
  archived: row.archived_at !== null,
  stateType: row.status_state_type,
  hasAssignment: row.assignment !== null && row.assignment !== undefined,
});
