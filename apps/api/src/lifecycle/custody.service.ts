import { Inject, Injectable } from '@nestjs/common';
import { permits, type AuthContext } from '../auth/index.js';
import { AttachmentsService } from '../files/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import {
  ApiProblem,
  type FieldError,
  type IfMatch,
  type Page,
  type ProblemCode,
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
import {
  TenancyService,
  assetInScope,
  isLocationScoped,
  locationInScope,
  personInScope,
  type Tx,
} from '../tenancy/index.js';
import {
  ASSIGNMENT_COLUMNS,
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
  UndoBody,
} from './schemas.js';

type AssignmentDto = ReturnType<typeof assignmentDto>;

export interface CustodyResult {
  asset: AssetDto;
  assignment: AssignmentDto;
  version: number;
}
export interface UndoResult extends CustodyResult {
  undone: 'checkout' | 'checkin' | 'transfer';
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
    private readonly attachments: AttachmentsService,
  ) {
    super(tenancy, audit, outbox);
  }

  // =========================================================================================
  // Check-out

  /**
   * `loan` marks the check-out as a loan from a loaner pool (ED-20): the assignment carries the pool
   * (`loaner_pool_id`, which the database only accepts together with a due date), and the history
   * entry says "Loaned". The pool's own rules (eligibility, limits, due date) are the caller's.
   */
  async checkout(
    auth: AuthContext,
    assetId: string,
    ifMatch: IfMatch,
    body: CheckoutBody,
    loan?: { poolId: string },
  ): Promise<CustodyResult> {
    return this.tx(auth, async (trx) => {
      const current = await this.lock(trx, assetId, ifMatch);
      assertAssetAction('checkout', stateOf(current));
      const target = await this.resolveTarget(trx, body, current.id);
      this.checkDue(body.expected_return, '/expected_return');
      const deployed = await this.checkoutStatus(trx, body.status_label_id);

      const assignmentId = uuidv7();
      await trx.assignment.create({
        data: {
          id: assignmentId,
          tenant_id: auth.tenantId,
          asset_id: current.id,
          ...targetColumns(target),
          ...(loan ? { loaner_pool_id: loan.poolId } : {}),
          expected_return: dateOrNull(body.expected_return),
          checked_out_by: auth.userId,
          acceptance_state: body.acceptance_required ? 'pending' : 'not_required',
          note: body.note ?? null,
          attachment_ids: body.attachment_ids ?? [],
        },
      });
      await this.linkPhotos(trx, body.attachment_ids, current.id, assignmentId);
      await this.touchAsset(trx, auth, current, { status_id: deployed.id });
      const row = (await loadAsset(trx, current.id))!;
      const assignment = (await loadAssignment(trx, assignmentId))!;

      const detail = {
        assignment_id: assignmentId,
        target_type: target.type,
        target_id: target.id,
        target_name: target.name,
        expected_return: body.expected_return ?? null,
        ...(loan ? { loaner_pool_id: loan.poolId } : {}),
      };
      await this.record(trx, {
        entity: 'asset',
        verb: 'checked_out',
        id: current.id,
        version: row.version,
        before: { status_id: current.status_id, holder: null },
        after: { status_id: row.status_id, holder: `${target.type}:${target.id}` },
        meta: { ...detail, ...(body.note ? { note: body.note } : {}) },
        refs: {
          assignmentId,
          [`${target.type}Id`]: target.id,
          ...(loan ? { loanerPoolId: loan.poolId } : {}),
        },
      });
      await writeAssetHistory(trx, auth, {
        assetId: current.id,
        eventType: 'checked_out',
        assignmentId,
        summary: loan ? `Loaned to ${target.name}` : `Checked out to ${target.name}`,
        payload: {
          ...detail,
          status: {
            from: current.status_name,
            to: deployed.name,
            from_id: current.status_id,
            to_id: deployed.id,
          },
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
        const location = await this.scopedLocation(trx, body.checkin_location_id);
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
        condition: body.condition ?? null,
      });
      await this.linkPhotos(trx, body.attachment_ids, current.id, closed.id);
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
        meta: {
          ...detail,
          ...(body.condition ? { condition: body.condition } : {}),
          ...(body.note ? { note: body.note } : {}),
        },
        refs: { assignmentId: closed.id },
      });
      await writeAssetHistory(trx, auth, {
        assetId: current.id,
        eventType: 'checked_in',
        assignmentId: closed.id,
        summary: `Checked in from ${open.target_name ?? open.target_type}`,
        payload: {
          ...detail,
          status: {
            from: current.status_name,
            to: status.name,
            from_id: current.status_id,
            to_id: status.id,
          },
          ...(newLocation ? { location: { from: current.location_id, to: newLocation } } : {}),
          ...(body.condition ? { condition: body.condition } : {}),
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
        const location = await this.scopedLocation(trx, body.to_location_id);
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
          condition: null,
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
      await this.linkPhotos(trx, body.attachment_ids, current.id, toId);
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
          ...(deployed
            ? {
                status: {
                  from: current.status_name,
                  to: deployed.name,
                  from_id: current.status_id,
                  to_id: deployed.id,
                },
              }
            : {}),
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
  // Extending a loan (M2-LOAN-01: "extending a loan is a logged action")

  /**
   * Moves the due date of an open LOAN (an assignment with a pool) to a later day. The asset row is
   * locked and touched like in every custody change, so its ETag changes; the audit record
   * (`loan.extended`), the outbox event and an `updated` history entry carrying `loan_extended` are
   * written in the same transaction. `latest` is the last day the pool allows (its `max_loan_days`
   * from the day the loan started), or null for no limit; the caller computed it from the pool.
   */
  async extendLoan(
    auth: AuthContext,
    assignmentId: string,
    expectedReturn: string,
    opts: { note?: string | undefined; latest: string | null },
  ): Promise<{ assignment: AssignmentRow; previous: string | null }> {
    return this.tx(auth, async (trx) => {
      const found = await loadAssignment(trx, assignmentId);
      if (!found || !found.asset_id || !found.loaner_pool_id) {
        throw problem.notFound('Loan not found.');
      }
      const current = await this.lock(trx, found.asset_id, { kind: 'absent' });
      // read again under the asset lock: a return may have closed it a moment ago
      const open = (await loadAssignment(trx, assignmentId))!;
      if (open.checked_in_at) throw problem.conflict('The loan is already closed.');
      const previous = open.expected_return
        ? open.expected_return.toISOString().slice(0, 10)
        : null;

      const errors: FieldError[] = [];
      if (expectedReturn < dayBefore()) {
        errors.push({
          pointer: '/expected_return',
          message: `must not be in the past (today is ${todayUtc()} UTC)`,
          code: 'in-the-past',
        });
      } else if (previous !== null && expectedReturn <= previous) {
        errors.push({
          pointer: '/expected_return',
          message: `must be later than the current due date ${previous}`,
          code: 'not-an-extension',
        });
      } else if (opts.latest !== null && expectedReturn > opts.latest) {
        errors.push({
          pointer: '/expected_return',
          message: `the pool allows a loan to run until ${opts.latest} at most`,
          code: 'exceeds-max-loan',
        });
      }
      if (errors.length > 0) throw problem.validation(errors);

      await trx.$executeRaw`
        update app.assignment set expected_return = ${expectedReturn}::date
         where id = ${assignmentId}::uuid and checked_in_at is null`;
      await this.touchAsset(trx, auth, current, {});
      const assignment = (await loadAssignment(trx, assignmentId))!;

      const detail = { assignment_id: assignmentId, from: previous, to: expectedReturn };
      await this.record(trx, {
        entity: 'loan',
        verb: 'extended',
        id: assignmentId,
        version: assignment.version,
        before: { expected_return: previous },
        after: { expected_return: expectedReturn },
        meta: { asset_id: current.id, ...(opts.note ? { note: opts.note } : {}) },
        refs: { assetId: current.id, loanerPoolId: open.loaner_pool_id, personId: open.person_id },
      });
      await writeAssetHistory(trx, auth, {
        assetId: current.id,
        eventType: 'updated',
        assignmentId,
        summary: `Loan extended to ${expectedReturn}`,
        payload: { loan_extended: { ...detail, ...(opts.note ? { note: opts.note } : {}) } },
      });
      return { assignment, previous };
    });
  }

  // =========================================================================================
  // Undo (M2-UX-02, ED-23)

  /**
   * Reverses the LAST custody action of an asset (check-out, check-in or transfer) as an inverse
   * action: never a delete. The original history event, assignment and audit row stay; the undo is
   * a new `custody_undone` event, a new audit row and a new version of the asset.
   *
   * Guards, all inside the asset lock: `If-Match` (required) is the ETag the action answered with,
   * so any later change of the asset is a 412; the newest history event of the asset must be the
   * custody event of `assignment_id` (a second undo, or any other event, is `undo-asset-changed` /
   * `undo-not-possible`); the event is at most {@link UNDO_WINDOW_SECONDS} old (`undo-expired`);
   * the caller needs the permission of the action it reverses; and whatever the inverse needs
   * (the previous holder, the previous status) must still be valid (`undo-not-possible`).
   */
  async undo(
    auth: AuthContext,
    assetId: string,
    ifMatch: IfMatch,
    body: UndoBody,
  ): Promise<UndoResult> {
    if (ifMatch.kind !== 'versions') {
      throw problem.preconditionRequired(
        'If-Match with the ETag the custody action answered with is required to undo it.',
      );
    }
    return this.tx(auth, async (trx) => {
      const current = await this.lock(trx, assetId, ifMatch);
      const [last] = await trx.$queryRaw<
        Array<{
          id: string;
          at: Date;
          event_type: string;
          assignment_id: string | null;
          transfer_id: string | null;
          payload: Record<string, unknown>;
        }>
      >`select id, at, event_type, assignment_id, transfer_id, payload
          from app.asset_history where asset_id = ${assetId}::uuid
         order by at desc, id desc limit 1`;
      if (last?.event_type === 'custody_undone') {
        throw undoProblem('undo-not-possible', 'This action was already undone.');
      }
      const kind = last ? UNDO_KINDS[last.event_type] : undefined;
      if (!last || !kind || last.assignment_id !== body.assignment_id) {
        throw undoProblem(
          'undo-asset-changed',
          'The asset changed after this action, so it can no longer be undone.',
        );
      }
      if (Date.now() - last.at.getTime() > UNDO_WINDOW_SECONDS * 1000) {
        throw undoProblem('undo-expired', 'The time to undo this action has passed.');
      }
      if (!permits(auth.permissions, kind.permission)) throw problem.forbidden();
      const payload = last.payload;
      const statusOf = (key: 'from_id' | 'to_id') => {
        const status = payload.status as Record<string, unknown> | undefined;
        const id = status?.[key];
        return typeof id === 'string' ? id : null;
      };
      const locationFrom = (): { restore: boolean; id: string | null } => {
        const location = payload.location as { from?: string | null } | undefined;
        return location && 'from' in location
          ? { restore: true, id: location.from ?? null }
          : { restore: false, id: null };
      };
      const [original] = await trx.$queryRaw<Array<AssignmentRow>>`
        select ${ASSIGNMENT_COLUMNS} from app.assignment s where s.id = ${last.assignment_id}::uuid`;
      if (!original || original.loaner_pool_id) {
        throw undoProblem(
          'undo-not-possible',
          'Loaner custody cannot be undone here. Use the loaner screens.',
        );
      }

      // What the asset looked like before the action, and what the inverse does.
      let reopenedFrom: AssignmentRow | null = null; // the holder who gets the asset back (check-in, transfer)
      let closedId: string | null = null; // the open period the undo closes (check-out, transfer)
      let reversedTransferId: string | null = null;
      if (kind.undone === 'checkin') {
        if (current.assignment || original.checked_in_at === null) {
          throw undoProblem('undo-asset-changed', 'The asset is checked out again.');
        }
        reopenedFrom = original;
      } else {
        if (current.assignment?.assignment_id !== original.id || original.checked_in_at !== null) {
          throw undoProblem('undo-asset-changed', 'The asset is no longer held as it was.');
        }
        closedId = original.id;
        if (kind.undone === 'transfer') {
          const fromId = payload.from_assignment_id;
          if (typeof fromId === 'string') {
            const [previous] = await trx.$queryRaw<Array<AssignmentRow>>`
              select ${ASSIGNMENT_COLUMNS} from app.assignment s where s.id = ${fromId}::uuid`;
            if (!previous || previous.loaner_pool_id) {
              throw undoProblem('undo-not-possible', 'The previous holder cannot be restored.');
            }
            reopenedFrom = previous;
          }
        }
      }

      // The status the asset had before: a check-out / transfer-from-stock / check-in restores it.
      let restoreStatus: { id: string; name: string } | null = null;
      if (kind.undone !== 'transfer' || !reopenedFrom) {
        const wanted = statusOf('from_id');
        const label = wanted ? await trx.status_label.findUnique({ where: { id: wanted } }) : null;
        if (!label) {
          throw undoProblem(
            'undo-not-possible',
            'The previous status of the asset is not known any more.',
          );
        }
        restoreStatus = { id: label.id, name: label.name };
      }

      // The previous holder must still be able to hold the asset.
      let holder: Target | null = null;
      if (reopenedFrom) {
        try {
          holder = await this.resolveTarget(
            trx,
            {
              ...(reopenedFrom.person_id ? { person_id: reopenedFrom.person_id } : {}),
              ...(reopenedFrom.location_id ? { location_id: reopenedFrom.location_id } : {}),
              ...(reopenedFrom.target_asset_id
                ? { target_asset_id: reopenedFrom.target_asset_id }
                : {}),
            },
            current.id,
          );
        } catch (err) {
          if (err instanceof ApiProblem && err.code === 'validation') {
            throw undoProblem(
              'undo-not-possible',
              'The previous holder can no longer receive the asset, so the action cannot be undone.',
            );
          }
          throw err;
        }
      }

      // ---- the inverse, in the order of the original action's tables ----
      const note = `Undo of ${kind.label}`;
      let closed: AssignmentRow | null = null;
      if (closedId) {
        closed = await this.closeAssignment(trx, auth, closedId, {
          locationId: null,
          note,
          attachmentIds: [],
          condition: null,
        });
      }
      let reopened: AssignmentRow | null = null;
      if (reopenedFrom && holder) {
        const id = uuidv7();
        await trx.assignment.create({
          data: {
            id,
            tenant_id: auth.tenantId,
            asset_id: current.id,
            ...targetColumns(holder),
            expected_return: reopenedFrom.expected_return,
            checked_out_by: auth.userId,
            acceptance_state: reopenedFrom.acceptance_state,
            note: reopenedFrom.note ?? note,
          },
        });
        reopened = (await loadAssignment(trx, id))!;
      }
      const location = locationFrom();
      // M2-LOC-03 (ED-26): an undo never takes the asset out of the caller's location scope
      if (location.restore && isLocationScoped() && !(await locationInScope(trx, location.id))) {
        throw undoProblem(
          'undo-not-possible',
          'The asset would go back to a place outside your scope, so the action cannot be undone here.',
        );
      }
      await this.touchAsset(trx, auth, current, {
        ...(restoreStatus && restoreStatus.id !== current.status_id
          ? { status_id: restoreStatus.id }
          : {}),
        ...(location.restore && location.id !== current.location_id
          ? { location_id: location.id }
          : {}),
      });
      if (kind.undone === 'transfer' && closed && reopened) {
        reversedTransferId = uuidv7();
        await trx.transfer.create({
          data: {
            id: reversedTransferId,
            tenant_id: auth.tenantId,
            asset_id: current.id,
            from_assignment_id: closed.id,
            to_assignment_id: reopened.id,
            from_location_id: current.location_id,
            to_location_id: location.restore ? location.id : current.location_id,
            reason: note,
            transferred_by: auth.userId,
          },
        });
      }
      const restoredAssignment = (reopened ?? closed)!;
      const row = (await loadAsset(trx, current.id))!;

      const who = holder ?? {
        type: original.person_id ? 'person' : original.location_id ? 'location' : 'asset',
        id: original.person_id ?? original.location_id ?? original.target_asset_id!,
        name: current.assignment?.target_name ?? '',
      };
      const detail = {
        undone: kind.undone,
        undone_event_type: last.event_type,
        undone_assignment_id: original.id,
        assignment_id: restoredAssignment.id,
        target_type: who.type,
        target_id: who.id,
        target_name: who.name,
      };
      await this.record(trx, {
        entity: 'asset',
        verb: 'custody_undone',
        id: current.id,
        version: row.version,
        before: {
          status_id: current.status_id,
          location_id: current.location_id,
          holder: current.assignment
            ? `${current.assignment.target_type}:${current.assignment.target_id}`
            : null,
        },
        after: {
          status_id: row.status_id,
          location_id: row.location_id,
          holder: row.assignment
            ? `${row.assignment.target_type}:${row.assignment.target_id}`
            : null,
        },
        meta: detail,
        refs: {
          assignmentId: restoredAssignment.id,
          ...(reversedTransferId ? { transferId: reversedTransferId } : {}),
        },
      });
      await writeAssetHistory(trx, auth, {
        assetId: current.id,
        eventType: 'custody_undone',
        assignmentId: restoredAssignment.id,
        transferId: reversedTransferId,
        summary: `Undid ${kind.label}${who.name ? ` (${who.name})` : ''}`,
        payload: {
          ...detail,
          status: {
            from: current.status_name,
            to: row.status_name,
            from_id: current.status_id,
            to_id: row.status_id,
          },
          ...(row.location_id !== current.location_id
            ? { location: { from: current.location_id, to: row.location_id } }
            : {}),
        },
      });
      return {
        asset: assetDto(row),
        assignment: assignmentDto(restoredAssignment),
        undone: kind.undone,
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
      if (!exists || !(await assetInScope(trx, assetId))) {
        throw problem.notFound('Asset not found.');
      }
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
      if (!exists || !(await personInScope(trx, personId))) {
        throw problem.notFound('Person not found.');
      }
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
      if (!exists || !(await personInScope(trx, personId))) {
        throw problem.notFound('Person not found.');
      }
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
    data: { status_id?: string; location_id?: string | null },
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
    close: {
      locationId: string | null;
      note: string | null;
      attachmentIds: string[];
      condition: string | null;
    },
  ): Promise<AssignmentRow> {
    const closed = await trx.$queryRaw<Array<{ id: string }>>`
      update app.assignment
         set checked_in_at = greatest(now(), checked_out_at), quantity_returned = quantity,
             checked_in_by = ${auth.userId}::uuid, checkin_location_id = ${close.locationId}::uuid,
             checkin_note = ${close.note}::text, checkin_attachment_ids = ${close.attachmentIds}::uuid[],
             checkin_condition = ${close.condition}::text
       where id = ${assignmentId}::uuid and checked_in_at is null
       returning id`;
    if (closed.length === 0) {
      // Cannot happen under the asset lock; kept as a clean answer instead of a half-written state.
      throw problem.conflict('The custody period was closed by another request. Reload and retry.');
    }
    return (await loadAssignment(trx, assignmentId))!;
  }

  /** A location a custody action may name: outside the location scope it does not exist (ED-26). */
  private async scopedLocation(trx: Tx, id: string) {
    return (await locationInScope(trx, id)) ? trx.location.findUnique({ where: { id } }) : null;
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
      // M2-LOC-03 (ED-26): a person outside the scope does not exist for a scoped principal
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
            message: 'inactive people cannot receive assets',
            code: 'inactive',
          },
        ]);
      }
      return { type: 'person', id: person.id, name: person.display_name };
    }
    if (body.location_id) {
      const location = await this.scopedLocation(trx, body.location_id);
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
    const target = (await assetInScope(trx, targetId))
      ? await trx.asset.findUnique({
          where: { id: targetId },
          select: { id: true, asset_tag: true, name: true, archived_at: true },
        })
      : null;
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

  /**
   * Photos and signatures sent with a custody action: each must be a live attachment of this tenant
   * that is not rejected and that belongs to the asset (uploaded against it before the action). They
   * are re-pointed at the assignment, so they list under it (`entity_type=assignment`). A bad id is a
   * 422 with the pointer of the offending array item.
   */
  private linkPhotos(
    trx: Tx,
    ids: readonly string[] | undefined,
    assetId: string,
    assignmentId: string,
  ): Promise<void> {
    return this.attachments.linkToOwner(
      trx,
      ids ?? [],
      { type: 'assignment', id: assignmentId },
      { allowFrom: [{ type: 'asset', id: assetId }], pointer: '/attachment_ids' },
    );
  }

  /** The status of a check-out: the requested `deployed` label, or the tenant's first one. */
  private async checkoutStatus(
    trx: Tx,
    statusLabelId: string | undefined,
  ): Promise<{ id: string; name: string }> {
    if (!statusLabelId) return this.statusOfType(trx, 'deployed');
    const label = await trx.status_label.findUnique({ where: { id: statusLabelId } });
    if (!label || label.archived_at) {
      throw problem.validation([invalidRef('/status_label_id', 'No such status label.')]);
    }
    if (label.state_type !== 'deployed') {
      throw problem.validation([
        {
          pointer: '/status_label_id',
          message: 'a checked-out asset needs a status label of type "deployed"',
          code: 'invalid',
        },
      ]);
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

/** How long after a custody action it can still be undone (the web offers it for 10 seconds). */
export const UNDO_WINDOW_SECONDS = 300;

interface UndoKind {
  undone: 'checkout' | 'checkin' | 'transfer';
  /** The permission of the action that is reversed. */
  permission: string;
  label: string;
}
const UNDO_KINDS: Partial<Record<string, UndoKind>> = {
  checked_out: { undone: 'checkout', permission: 'asset:checkout', label: 'check-out' },
  checked_in: { undone: 'checkin', permission: 'asset:checkin', label: 'check-in' },
  transferred: { undone: 'transfer', permission: 'asset:transfer', label: 'transfer' },
};

const undoProblem = (
  code: Extract<ProblemCode, 'undo-expired' | 'undo-asset-changed' | 'undo-not-possible'>,
  detail: string,
) => new ApiProblem({ code, detail });

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
