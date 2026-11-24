import type { OutboxDelivery } from '../outbox/index.js';
import type { Tx } from '../tenancy/index.js';
import {
  type RecipientResolver,
  anyOf,
  holdersOf,
  loginOfPerson,
  payloadUser,
  poolManagers,
} from './recipients.js';
import type { NotificationType } from './types.js';

/**
 * THE SUBSCRIBER MAPPING (M2-NOT-01): which outbox events become which notification, for whom, with
 * what text. This table is the only thing a module (or the integrator of parallel branches) edits to
 * get a notification out of a domain event:
 *
 *   1. register the TYPE in `types.ts` (label, default delivery, who gets it) and its texts in
 *      `templates.ts` (`notification.<type>.title` / `.body`);
 *   2. add ONE entry below: the outbox `event` type, the `type`, the `recipients` resolver and a
 *      `describe` function that turns the event into template variables, a link and the subject.
 *
 * Entries run in the outbox relay's tenant transaction: whatever they read is read under RLS, and the
 * notification rows and the email commit atomically with the event being marked delivered. The relay
 * redelivers a failed event, so an entry must be idempotent: the `dedupe` key (default: the event id)
 * is unique per recipient, which makes a second delivery a no-op.
 *
 * Events that other M2 stories emit and that are NOT mapped yet (types and texts already exist):
 *   `import.completed` (M2-IMP). Add its entry when the producer exists. (`loan.overdue` and
 *   `loan.due_soon` are mapped below since M2-LOAN-03.)
 *
 * PAYLOADS ARE IDS ONLY (ids/ids-only.ts): a `describe` function never expects a name in the event; it
 * loads the record by `event.aggregateId` (or an id in the payload) under the tenant context.
 */
export interface Described {
  /** Template variables of `templates.ts` (strings and numbers; ids and free text are fine here). */
  vars: Record<string, string | number>;
  /** The subject, so the bell can link to it. */
  entity?: { type: string; id: string };
  /** Path inside the web app. */
  link?: string;
}

export interface Subscription {
  /** Outbox event type (`attachment.infected`) or a prefix pattern (`repair.*`). */
  event: string;
  type: NotificationType;
  recipients: RecipientResolver;
  /** Return null to send nothing for this event (the subject vanished, nothing to say). */
  describe: (event: OutboxDelivery, tx: Tx) => Promise<Described | null>;
  /** What makes two events "the same" for a recipient. Default: the event id. */
  dedupe?: (event: OutboxDelivery) => string;
}

// ---------------------------------------------------------------------------------- helpers

const assetLabel = (a: { asset_tag: string; name: string | null }): string =>
  a.name ? `${a.asset_tag} ${a.name}` : a.asset_tag;

/** The subject id of an event: the payload key, else the aggregate. */
const idFrom = (event: OutboxDelivery, key: string): string => {
  const value = event.payload[key];
  return typeof value === 'string' ? value : event.aggregateId;
};

/** The open loan an alert event is about; null when it was returned (or vanished) since the alert. */
async function loanOf(tx: Tx, assignmentId: string) {
  const loan = await tx.assignment.findUnique({
    where: { id: assignmentId },
    select: { asset_id: true, person_id: true, expected_return: true, checked_in_at: true },
  });
  if (!loan || loan.checked_in_at || !loan.asset_id) return null;
  const [asset, person] = await Promise.all([
    tx.asset.findUnique({
      where: { id: loan.asset_id },
      select: { id: true, asset_tag: true, name: true },
    }),
    loan.person_id
      ? tx.person.findUnique({ where: { id: loan.person_id }, select: { display_name: true } })
      : null,
  ]);
  if (!asset) return null;
  return {
    asset,
    borrower: person?.display_name ?? 'unknown',
    dueDate: loan.expected_return ? loan.expected_return.toISOString().slice(0, 10) : '',
  };
}

/** Where a stock item opens in the web app. */
const stockLink = (kind: 'accessory' | 'consumable', id: string): string =>
  `/stock/view?kind=${kind}&id=${encodeURIComponent(id)}`;

/** The web path that shows a record of an attachment owner type, when there is one. */
function ownerLink(type: string, id: string): string | undefined {
  switch (type) {
    case 'asset':
      return `/assets/view?id=${encodeURIComponent(id)}`;
    case 'person':
      return `/people/view?id=${encodeURIComponent(id)}`;
    default:
      return undefined;
  }
}

// -------------------------------------------------------------------------------- the table

export const NOTIFICATION_SUBSCRIPTIONS: readonly Subscription[] = [
  // The virus scan found something in a file: tell whoever uploaded it (M2-SEC-02).
  {
    event: 'attachment.infected',
    type: 'attachment.infected',
    recipients: payloadUser('uploaded_by'),
    async describe(event, tx) {
      const file = await tx.attachment.findFirst({
        where: { id: event.aggregateId },
        select: { filename: true, scan_detail: true, entity_type: true, entity_id: true },
      });
      return {
        vars: {
          filename: file?.filename ?? 'a file',
          signature: file?.scan_detail ?? 'a virus',
        },
        entity: { type: 'attachment', id: event.aggregateId },
        ...(file && ownerLink(file.entity_type, file.entity_id)
          ? { link: ownerLink(file.entity_type, file.entity_id)! }
          : {}),
      };
    },
  },

  // An asset was checked out to a person who has a login (M2-LIFE-02).
  {
    event: 'asset.checked_out',
    type: 'asset.checked_out',
    recipients: loginOfPerson('personId'),
    async describe(event, tx) {
      const asset = await tx.asset.findUnique({
        where: { id: event.aggregateId },
        select: { id: true, asset_tag: true, name: true },
      });
      if (!asset) return null;
      const assignmentId = event.payload.assignmentId;
      const assignment =
        typeof assignmentId === 'string'
          ? await tx.assignment.findUnique({
              where: { id: assignmentId },
              select: { expected_return: true },
            })
          : null;
      const due = assignment?.expected_return
        ? `Expected back by ${assignment.expected_return.toISOString().slice(0, 10)}.`
        : '';
      return {
        vars: { asset: assetLabel(asset), due },
        entity: { type: 'asset', id: asset.id },
        link: `/assets/view?id=${encodeURIComponent(asset.id)}`,
      };
    },
    dedupe: (event) => `asset.checked_out:${String(event.payload.assignmentId ?? event.id)}`,
  },

  // A CSV export finished (M2-REG-02, src/exports).
  {
    event: 'export.completed',
    type: 'export.completed',
    recipients: payloadUser('requestedBy'),
    async describe(event, tx) {
      const job = await tx.export_job.findUnique({
        where: { id: event.aggregateId },
        select: { filename: true, row_count: true },
      });
      if (!job) return null;
      return {
        vars: { filename: job.filename ?? 'The file', rows: job.row_count ?? 0 },
        entity: { type: 'export', id: event.aggregateId },
      };
    },
  },

  // Consumables (ADR 0008): the stock fell to or below the minimum. The outbox event carries ids only
  // ({ consumableId, movementId? }); the name and the counts are read here, under RLS. Recipients are the
  // stock managers (holders of consumable:manage) unless an administrator re-addressed the type.
  {
    event: 'consumable.low_stock',
    type: 'consumable.low_stock',
    recipients: holdersOf('consumable:manage'),
    async describe(event, tx) {
      const id = idFrom(event, 'consumableId');
      const item = await tx.consumable.findUnique({
        where: { id },
        select: { id: true, name: true, qty_on_hand: true, min_qty: true },
      });
      if (!item) return null;
      return {
        vars: {
          name: item.name,
          detail: `${item.qty_on_hand} left (minimum ${item.min_qty}).`,
        },
        entity: { type: 'consumable', id: item.id },
        link: stockLink('consumable', item.id),
      };
    },
    // one notification per crossing: the movement that caused it (or the item when there is none)
    dedupe: (event) => `consumable.low_stock:${String(event.payload.movementId ?? event.id)}`,
  },

  // Accessories (ADR 0008): the units on the shelf (total minus units out) fell to or below the minimum.
  // Payload: { accessoryId, assignmentId? }.
  {
    event: 'accessory.low_stock',
    type: 'accessory.low_stock',
    recipients: holdersOf('accessory:manage'),
    async describe(event, tx) {
      const id = idFrom(event, 'accessoryId');
      const [row] = await tx.$queryRaw<
        Array<{ id: string; name: string; min_qty: number; available: number }>
      >`
        select a.id, a.name, a.min_qty,
               (a.qty_total - coalesce((
                  select sum(s.quantity - s.quantity_returned)
                    from app.assignment s
                   where s.tenant_id = a.tenant_id and s.accessory_id = a.id and s.checked_in_at is null
                ), 0))::int as available
          from app.accessory a
         where a.id = ${id}::uuid`;
      if (!row) return null;
      return {
        vars: {
          name: row.name,
          detail: `${row.available} available (minimum ${row.min_qty}).`,
        },
        entity: { type: 'accessory', id: row.id },
        link: stockLink('accessory', row.id),
      };
    },
    dedupe: (event) => `accessory.low_stock:${String(event.payload.assignmentId ?? event.id)}`,
  },

  // Loaner loans (M2-LOAN-03, ED-21): the daily `loan.alerts` job raised an overdue alert. Payload
  // { assignmentId, assetId, personId, poolId, daysOverdue, alertDate }; the job's ledger makes it once
  // per loan and day, and the dedupe key says so again for a redelivered event. The borrower (when they
  // have a login) and the pool's owner or managers are told; the copy escalates with the days.
  {
    event: 'loan.overdue',
    type: 'loan.overdue',
    recipients: anyOf(loginOfPerson('personId'), poolManagers('poolId')),
    async describe(event, tx) {
      const loan = await loanOf(tx, idFrom(event, 'assignmentId'));
      if (!loan) return null;
      const days = typeof event.payload.daysOverdue === 'number' ? event.payload.daysOverdue : 1;
      return {
        vars: {
          asset: assetLabel(loan.asset),
          due_date: loan.dueDate,
          days_overdue: days,
          borrower: loan.borrower,
          escalation:
            days >= 14
              ? 'It is more than two weeks overdue: please return it now.'
              : days >= 7
                ? 'It is more than a week overdue: please return it as soon as you can.'
                : '',
        },
        entity: { type: 'asset', id: loan.asset.id },
        link: `/assets/view?id=${encodeURIComponent(loan.asset.id)}`,
      };
    },
    dedupe: (event) =>
      `loan.overdue:${String(event.payload.assignmentId ?? event.id)}:${String(event.payload.alertDate ?? '')}`,
  },

  // Loaner loans: the due date is within the tenant's reminder lead time. Payload
  // { assignmentId, assetId, personId, poolId, dueOn, alertDate }; only the borrower is told.
  {
    event: 'loan.due_soon',
    type: 'loan.due_soon',
    recipients: loginOfPerson('personId'),
    async describe(event, tx) {
      const loan = await loanOf(tx, idFrom(event, 'assignmentId'));
      if (!loan) return null;
      return {
        vars: { asset: assetLabel(loan.asset), due_date: loan.dueDate },
        entity: { type: 'asset', id: loan.asset.id },
        link: `/assets/view?id=${encodeURIComponent(loan.asset.id)}`,
      };
    },
    dedupe: (event) =>
      `loan.due_soon:${String(event.payload.assignmentId ?? event.id)}:${String(event.payload.dueOn ?? '')}`,
  },

  // Labels (ADR 0007): a batch finished rendering. Payload { batch_id, requested_by, version }; the
  // requester is the only recipient, the link opens the print dialog on the batch.
  {
    event: 'label.batch.ready',
    type: 'label.batch.ready',
    recipients: payloadUser('requested_by'),
    async describe(event, tx) {
      const id = idFrom(event, 'batch_id');
      const batch = await tx.label_batch.findUnique({
        where: { id },
        select: { id: true, label_count: true },
      });
      if (!batch) return null;
      return {
        vars: { count: batch.label_count },
        entity: { type: 'label_batch', id: batch.id },
        link: `/assets?label_batch=${encodeURIComponent(batch.id)}`,
      };
    },
  },

  // Labels: the render failed for good (the batch is `failed`). Payload { batch_id, requested_by, code }.
  {
    event: 'label.batch.failed',
    type: 'label.batch.failed',
    recipients: payloadUser('requested_by'),
    describe(event) {
      const id = idFrom(event, 'batch_id');
      const code = typeof event.payload.code === 'string' ? event.payload.code : 'render-failed';
      return Promise.resolve({
        vars: { reason: code },
        entity: { type: 'label_batch', id },
        link: `/assets?label_batch=${encodeURIComponent(id)}`,
      });
    },
  },
];
