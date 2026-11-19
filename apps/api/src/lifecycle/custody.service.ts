import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import {
  type FieldError,
  type IfMatch,
  type Page,
  assertIfMatch,
  problem,
} from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import {
  type AssetDto,
  type AssetRow,
  type HistoryEventDto,
  RegistryBase,
  assertAssetAction,
  assetDto,
  invalidRef,
  listHistory,
  loadAsset,
  lockAsset,
  stalePrecondition,
  writeAssetHistory,
} from '../registry/index.js';
import { TenancyService, type Tx } from '../tenancy/index.js';
import {
  type AssignmentRow,
  assignmentDto,
  listAssignments,
  loadAssignment,
  todayUtc,
} from './assignments.js';
import type {
  AssetAssignmentsQuery,
  CheckinBody,
  CheckoutBody,
  PersonAssignmentsQuery,
  PersonHistoryQuery,
  TransferBody,
} from './schemas.js';

type AssignmentDto = ReturnType<typeof assignmentDto>;

export interface CustodyResult {
  asset: AssetDto;
  assignment: AssignmentDto;
  version: number;
}
export interface TransferResult extends CustodyResult {
  transfer: ReturnType<typeof transferDto>;
}

interface TransferRow {
  id: string;
  asset_id: string;
  from_assignment_id: string | null;
  to_assignment_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  reason: string | null;
  note: string | null;
  transferred_at: Date;
  transferred_by: string | null;
}

const transferDto = (t: TransferRow) => ({
  id: t.id,
  asset_id: t.asset_id,
  from_assignment_id: t.from_assignment_id,
  to_assignment_id: t.to_assignment_id,
  from_location_id: t.from_location_id,
  to_location_id: t.to_location_id,
  reason: t.reason,
  note: t.note,
  transferred_at: t.transferred_at.toISOString(),
  transferred_by: t.transferred_by,
});

/** Who holds the asset: exactly one of the three ids (schema `AssignmentTarget`). */
interface Target {
  type: 'person' | 'location' | 'asset';
  id: string;
  name: string;
}

const dayBefore = (): string => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

/**
 * Custody (M2-LIFE-01..04, ED-13): check-out, check-in and transfer of ONE asset.
 *
 * Every operation runs in one tenant transaction (joined with the idempotency claim of the request)
 * that starts by LOCKING the asset row (`SELECT .. FOR UPDATE`): concurrent requests on the same asset
 * are serialised, and the loser sees the winner's committed custody and answers a clean 409. The
 * partial unique index `assignment_one_open_per_asset_uq` is the database-level backstop. `If-Match`
 * (optional) is checked against the locked row; the asset row is always touched, so its ETag changes
 * with every custody change. Audit row, outbox event and history entry are written in the same
 * transaction. The state rules live in `registry/asset-actions.ts`.
 */
@Injectable()
export class CustodyService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  // =========================================================================================
  // Check-out

  async checkout(
    auth: AuthContext,
    assetId: string,
    ifMatch: IfMatch,
    body: CheckoutBody,
  ): Promise<CustodyResult> {
    return this.tx(auth, async (trx) => {
      const current = await this.lock(trx, assetId, ifMatch);
      assertAssetAction('checkout', stateOf(current));
      const target = await this.resolveTarget(trx, body, current.id);
      this.checkDue(body.expected_return, '/expected_return');
      const deployed = await this.statusOfType(trx, 'deployed');

      const assignmentId = uuidv7();
      await trx.assignment.create({
        data: {
          id: assignmentId,
          tenant_id: auth.tenantId,
          asset_id: current.id,
          ...targetColumns(target),
          expected_return: dateOrNull(body.expected_return),
          checked_out_by: auth.userId,
          acceptance_state: body.acceptance_required ? 'pending' : 'not_required',
          note: body.note ?? null,
          attachment_ids: body.attachment_ids ?? [],
        },
      });
      await this.touchAsset(trx, auth, current, { status_id: deployed.id });
      const row = (await loadAsset(trx, current.id))!;
      const assignment = (await loadAssignment(trx, assignmentId))!;

      const detail = {
        assignment_id: assignmentId,
        target_type: target.type,
        target_id: target.id,
        target_name: target.name,
        expected_return: body.expected_return ?? null,
      };
      await this.record(trx, {
        entity: 'asset',
        verb: 'checked_out',
        id: current.id,
        version: row.version,
        before: { status_id: current.status_id, holder: null },
        after: { status_id: row.status_id, holder: `${target.type}:${target.id}` },
        meta: { ...detail, ...(body.note ? { note: body.note } : {}) },
        refs: { assignmentId, [`${target.type}Id`]: target.id },
      });
      await writeAssetHistory(trx, auth, {
        assetId: current.id,
        eventType: 'checked_out',
        assignmentId,
        summary: `Checked out to ${target.name}`,
        payload: {
          ...detail,
          status: { from: current.status_name, to: deployed.name },
          ...(body.note ? { note: body.note } : {}),
          ...(body.attachment_ids?.length ? { attachment_ids: body.attachment_ids } : {}),
        },
      });
      return { asset: assetDto(row), assignment: assignmentDto(assignment), version: row.version };
    });
  }

  // =========================================================================================
  // Check-in

  async checkin(
    auth: AuthContext,
    assetId: string,
    ifMatch: IfMatch,
    body: CheckinBody,
  ): Promise<CustodyResult> {
    return this.tx(auth, async (trx) => {
      const current = await this.lock(trx, assetId, ifMatch);
      assertAssetAction('checkin', stateOf(current));
      const open = current.assignment!;

      const errors: FieldError[] = [];
      if (body.checkin_location_id) {
        const location = await trx.location.findUnique({ where: { id: body.checkin_location_id } });
        if (!location || location.archived_at) {
          errors.push(invalidRef('/checkin_location_id', 'No such location.'));
        }
      }
      let status = await this.checkinStatus(trx, body.status_id, errors);
      if (errors.length > 0) throw problem.validation(errors);
      status ??= await this.statusOfType(trx, 'deployable', true);

      const closed = await this.closeAssignment(trx, auth, open.assignment_id, {
        locationId: body.checkin_location_id ?? null,
        note: body.note ?? null,
        attachmentIds: body.attachment_ids ?? [],
      });
      const newLocation =
        body.checkin_location_id && body.checkin_location_id !== current.location_id
          ? body.checkin_location_id
          : undefined;
      await this.touchAsset(trx, auth, current, {
        status_id: status.id,
        ...(newLocation ? { location_id: newLocation } : {}),
      });
      const row = (await loadAsset(trx, current.id))!;

      const detail = {
        assignment_id: closed.id,
        target_type: open.target_type,
        target_id: open.target_id,
        target_name: open.target_name,
      };
      await this.record(trx, {
        entity: 'asset',
        verb: 'checked_in',
        id: current.id,
        version: row.version,
        before: {
          status_id: current.status_id,
          location_id: current.location_id,
          holder: `${open.target_type}:${open.target_id}`,
        },
        after: { status_id: row.status_id, location_id: row.location_id, holder: null },
        meta: { ...detail, ...(body.note ? { note: body.note } : {}) },
        refs: { assignmentId: closed.id },
      });
      await writeAssetHistory(trx, auth, {
        assetId: current.id,
        eventType: 'checked_in',
        assignmentId: closed.id,
        summary: `Checked in from ${open.target_name ?? open.target_type}`,
        payload: {
          ...detail,
          status: { from: current.status_name, to: status.name },
          ...(newLocation ? { location: { from: current.location_id, to: newLocation } } : {}),
          ...(body.note ? { note: body.note } : {}),
          ...(body.attachment_ids?.length ? { attachment_ids: body.attachment_ids } : {}),
        },
      });
      return { asset: assetDto(row), assignment: assignmentDto(closed), version: row.version };
    });
  }

  // =========================================================================================
  // Transfer

  async transfer(
    auth: AuthContext,
    assetId: string,
    ifMatch: IfMatch,
    body: TransferBody,
  ): Promise<TransferResult> {
    return this.tx(auth, async (trx) => {
      const current = await this.lock(trx, assetId, ifMatch);
      assertAssetAction('transfer', stateOf(current));
      const open = current.assignment ?? null;
      const target = await this.resolveTarget(trx, body, current.id);
      this.checkDue(body.expected_return, '/expected_return');
      if (open && open.target_type === target.type && open.target_id === target.id) {
        throw problem.validation([
          {
            pointer: `/${target.type === 'asset' ? 'target_asset' : target.type}_id`,
            message: 'the asset is already with this holder',
            code: 'same-holder',
          },
        ]);
      }
      if (body.to_location_id) {
        const location = await trx.location.findUnique({ where: { id: body.to_location_id } });
        if (!location || location.archived_at) {
          throw problem.validation([invalidRef('/to_location_id', 'No such location.')]);
        }
      }
      // Out of stock the transfer is a check-out: the asset leaves with the deployed status.
      const deployed = open ? null : await this.statusOfType(trx, 'deployed');

      // Both halves in this one transaction: any failure below rolls the whole transfer back.
      let from: AssignmentRow | null = null;
      if (open) {
        from = await this.closeAssignment(trx, auth, open.assignment_id, {
          locationId: body.to_location_id ?? null,
          note: body.reason ?? body.note ?? null,
          attachmentIds: [],
        });
      }
      const toId = uuidv7();
      await trx.assignment.create({
        data: {
          id: toId,
          tenant_id: auth.tenantId,
          asset_id: current.id,
          ...targetColumns(target),
          expected_return: dateOrNull(body.expected_return),
          checked_out_by: auth.userId,
          note: body.note ?? null,
          attachment_ids: body.attachment_ids ?? [],
        },
      });
      const newLocation =
        body.to_location_id && body.to_location_id !== current.location_id
          ? body.to_location_id
          : undefined;
      await this.touchAsset(trx, auth, current, {
        ...(deployed ? { status_id: deployed.id } : {}),
        ...(newLocation ? { location_id: newLocation } : {}),
      });
      const transferId = uuidv7();
      await trx.transfer.create({
        data: {
          id: transferId,
          tenant_id: auth.tenantId,
          asset_id: current.id,
          from_assignment_id: from?.id ?? null,
          to_assignment_id: toId,
          from_location_id: current.location_id,
          to_location_id: newLocation ?? current.location_id,
          reason: body.reason ?? null,
          note: body.note ?? null,
          transferred_by: auth.userId,
        },
      });
      const row = (await loadAsset(trx, current.id))!;
      const assignment = (await loadAssignment(trx, toId))!;
      const transfer = (await trx.transfer.findUnique({ where: { id: transferId } }))!;

      const detail = {
        from: open ? { type: open.target_type, id: open.target_id, name: open.target_name } : null,
        to: { type: target.type, id: target.id, name: target.name },
        from_assignment_id: from?.id ?? null,
        to_assignment_id: toId,
      };
      await this.record(trx, {
        entity: 'asset',
        verb: 'transferred',
        id: current.id,
        version: row.version,
        before: {
          holder: open ? `${open.target_type}:${open.target_id}` : null,
          location_id: current.location_id,
        },
        after: { holder: `${target.type}:${target.id}`, location_id: row.location_id },
        meta: {
          ...detail,
          transfer_id: transferId,
          ...(body.reason ? { reason: body.reason } : {}),
          ...(body.note ? { note: body.note } : {}),
        },
        refs: { assignmentId: toId, transferId, [`${target.type}Id`]: target.id },
      });
      await writeAssetHistory(trx, auth, {
        assetId: current.id,
        eventType: 'transferred',
        assignmentId: toId,
        transferId,
        summary: `Transferred ${open ? `from ${open.target_name ?? open.target_type} ` : ''}to ${target.name}`,
        payload: {
          ...detail,
          ...(newLocation ? { location: { from: current.location_id, to: newLocation } } : {}),
          ...(body.reason ? { reason: body.reason } : {}),
          ...(body.note ? { note: body.note } : {}),
          ...(body.attachment_ids?.length ? { attachment_ids: body.attachment_ids } : {}),
        },
      });
      return {
        asset: assetDto(row),
        assignment: assignmentDto(assignment),
        transfer: transferDto(transfer),
        version: row.version,
      };
    });
  }

  // =========================================================================================
  // Reads

  async assetAssignments(
    auth: AuthContext,
    assetId: string,
    query: AssetAssignmentsQuery,
  ): Promise<Page<AssignmentDto>> {
    return this.tx(auth, async (trx) => {
      const exists = await trx.asset.findUnique({ where: { id: assetId }, select: { id: true } });
      if (!exists) throw problem.notFound('Asset not found.');
      return listAssignments(trx, { assetId }, query);
    });
  }

  async personAssignments(
    auth: AuthContext,
    personId: string,
    query: PersonAssignmentsQuery,
  ): Promise<Page<AssignmentDto>> {
    return this.tx(auth, async (trx) => {
      const exists = await trx.person.findUnique({ where: { id: personId }, select: { id: true } });
      if (!exists) throw problem.notFound('Person not found.');
      return listAssignments(trx, { personId, state: query.state }, query);
    });
  }

  async personHistory(
    auth: AuthContext,
    personId: string,
    query: PersonHistoryQuery,
  ): Promise<Page<HistoryEventDto>> {
    return this.tx(auth, async (trx) => {
      const exists = await trx.person.findUnique({ where: { id: personId }, select: { id: true } });
      if (!exists) throw problem.notFound('Person not found.');
      return listHistory(
        trx,
        { personId },
        { ...(query.cursor ? { cursor: query.cursor } : {}), limit: query.limit },
      );
    });
  }

  // =========================================================================================
  // Building blocks

  /** Locks the asset row, 404 when missing, 412 when `If-Match` is stale. */
  private async lock(trx: Tx, assetId: string, ifMatch: IfMatch): Promise<AssetRow> {
    const current = await lockAsset(trx, assetId);
    if (!current) throw problem.notFound('Asset not found.');
    assertIfMatch(ifMatch, current.version);
    return current;
  }

  /**
   * Updates the asset row with `data` (and always bumps its version: the `current_assignment` of
   * the representation changed even when no column of the asset did).
   */
  private async touchAsset(
    trx: Tx,
    auth: AuthContext,
    current: AssetRow,
    data: { status_id?: string; location_id?: string },
  ): Promise<void> {
    const result = await trx.asset.updateMany({
      where: { id: current.id, version: current.version },
      data: { ...data, updated_by: auth.userId },
    });
    if (result.count === 0) {
      return stalePrecondition(() => trx.asset.findUnique({ where: { id: current.id } }), 'Asset');
    }
  }

  /** Closes an open assignment in place (ED-11: quantity_returned and checked_in_at together). */
  private async closeAssignment(
    trx: Tx,
    auth: AuthContext,
    assignmentId: string,
    close: { locationId: string | null; note: string | null; attachmentIds: string[] },
  ): Promise<AssignmentRow> {
    const closed = await trx.$queryRaw<Array<{ id: string }>>`
      update app.assignment
         set checked_in_at = greatest(now(), checked_out_at), quantity_returned = quantity,
             checked_in_by = ${auth.userId}::uuid, checkin_location_id = ${close.locationId}::uuid,
             checkin_note = ${close.note}::text, checkin_attachment_ids = ${close.attachmentIds}::uuid[]
       where id = ${assignmentId}::uuid and checked_in_at is null
       returning id`;
    if (closed.length === 0) {
      // Cannot happen under the asset lock; kept as a clean answer instead of a half-written state.
      throw problem.conflict('The custody period was closed by another request. Reload and retry.');
    }
    return (await loadAssignment(trx, assignmentId))!;
  }

  /** The person / location / asset the request points at, validated (422 with a pointer). */
  private async resolveTarget(
    trx: Tx,
    body: {
      person_id?: string | undefined;
      location_id?: string | undefined;
      target_asset_id?: string | undefined;
    },
    assetId: string,
  ): Promise<Target> {
    if (body.person_id) {
      const person = await trx.person.findUnique({ where: { id: body.person_id } });
      if (!person || person.archived_at) {
        throw problem.validation([invalidRef('/person_id', 'No such person.')]);
      }
      if (person.status !== 'active') {
        throw problem.validation([
          {
            pointer: '/person_id',
            message: 'inactive people cannot receive assets',
            code: 'inactive',
          },
        ]);
      }
      return { type: 'person', id: person.id, name: person.display_name };
    }
    if (body.location_id) {
      const location = await trx.location.findUnique({ where: { id: body.location_id } });
      if (!location || location.archived_at) {
        throw problem.validation([invalidRef('/location_id', 'No such location.')]);
      }
      return { type: 'location', id: location.id, name: location.name };
    }
    const targetId = body.target_asset_id!;
    if (targetId === assetId) {
      throw problem.validation([
        {
          pointer: '/target_asset_id',
          message: 'an asset cannot be checked out to itself',
          code: 'invalid',
        },
      ]);
    }
    const target = await trx.asset.findUnique({
      where: { id: targetId },
      select: { id: true, asset_tag: true, name: true, archived_at: true },
    });
    if (!target || target.archived_at) {
      throw problem.validation([invalidRef('/target_asset_id', 'No such asset.')]);
    }
    // No cycles: following "is checked out to asset" upwards must never come back to this asset.
    let cursor: string | null = targetId;
    for (let depth = 0; cursor && depth < 50; depth++) {
      if (cursor === assetId) {
        throw problem.validation([
          {
            pointer: '/target_asset_id',
            message: 'would create a cycle (the target is itself checked out to this asset)',
            code: 'cycle',
          },
        ]);
      }
      const ups: Array<{ target_asset_id: string | null }> = await trx.$queryRaw`
        select target_asset_id from app.assignment
         where asset_id = ${cursor}::uuid and checked_in_at is null and target_asset_id is not null`;
      cursor = ups[0]?.target_asset_id ?? null;
    }
    return {
      type: 'asset',
      id: target.id,
      name: target.name ? `${target.asset_tag} ${target.name}` : target.asset_tag,
    };
  }

  private checkDue(expectedReturn: string | undefined, pointer: string): void {
    // A day of slack: the caller's "today" may be one day behind UTC.
    if (expectedReturn && expectedReturn < dayBefore()) {
      throw problem.validation([
        {
          pointer,
          message: `must not be in the past (today is ${todayUtc()} UTC)`,
          code: 'in-the-past',
        },
      ]);
    }
  }

  /** The tenant's first active status label of a state type (the default one when it has the type and `preferDefault`). */
  private async statusOfType(
    trx: Tx,
    stateType: 'deployed' | 'deployable',
    preferDefault = false,
  ): Promise<{ id: string; name: string }> {
    if (preferDefault) {
      const def = await trx.status_label.findFirst({
        where: { is_default: true, archived_at: null, state_type: stateType },
      });
      if (def) return def;
    }
    const label = await trx.status_label.findFirst({
      where: { state_type: stateType, archived_at: null },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    if (!label) {
      throw problem.conflict(
        `The tenant has no active status label of type "${stateType}". Create one in the status labels first.`,
      );
    }
    return label;
  }

  /** The status requested for a check-in: any active label except a `deployed` one (nobody holds the asset any more). */
  private async checkinStatus(
    trx: Tx,
    statusId: string | null | undefined,
    errors: FieldError[],
  ): Promise<{ id: string; name: string } | undefined> {
    if (!statusId) return undefined;
    const status = await trx.status_label.findUnique({ where: { id: statusId } });
    if (!status || status.archived_at) {
      errors.push(invalidRef('/status_id', 'No such status label.'));
      return undefined;
    }
    if (status.state_type === 'deployed') {
      errors.push({
        pointer: '/status_id',
        message: 'a checked-in asset cannot get a status of type "deployed"',
        code: 'invalid',
      });
      return undefined;
    }
    return status;
  }
}

const stateOf = (row: AssetRow) => ({
  archived: row.archived_at !== null,
  stateType: row.status_state_type,
  hasAssignment: row.assignment !== null && row.assignment !== undefined,
});

const dateOrNull = (v: string | undefined): Date | null => (v ? new Date(`${v}T00:00:00Z`) : null);

/** Column values of the assignment's single target. */
const targetColumns = (t: Target) =>
  t.type === 'person'
    ? { person_id: t.id }
    : t.type === 'location'
      ? { location_id: t.id }
      : { target_asset_id: t.id };
