import type { OutboxDelivery } from '../outbox/index.js';
import type { Tx } from '../tenancy/index.js';
import {
  type RecipientResolver,
  holdersOf,
  loginOfPerson,
  payloadUser,
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
 *   `loan.overdue`, `loan.due_soon` (M2-LOAN-03), `import.completed` (M2-IMP). Add their entry when
 *   the producer exists; `loan.overdue` should use `anyOf(loginOfPerson('personId'), holdersOf('loaner:manage'))`.
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

/** Is the table of another M2 story installed yet? (tolerant entries read it only when it is) */
async function installed(tx: Tx, table: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`
    select to_regclass(${table}::text) is not null as ok`;
  return Boolean(row?.ok);
}

const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

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

  // M2-ACC / consumables: the stock fell to or below its reorder level. Emitted by the consumables
  // story as `consumable.low_stock` (aggregate: the consumable). The payload keys are read tolerantly.
  {
    event: 'consumable.low_stock',
    type: 'consumable.low_stock',
    recipients: holdersOf('consumable:manage'),
    async describe(event, tx) {
      let name = 'A consumable';
      if (await installed(tx, 'app.consumable')) {
        const [row] = await tx.$queryRaw<Array<{ name: string }>>`
          select name from app.consumable where id = ${event.aggregateId}::uuid`;
        if (row) name = row.name;
      }
      const p = event.payload;
      const onHand = number(p.on_hand ?? p.onHand ?? p.quantity);
      const level = number(p.reorder_level ?? p.reorderLevel ?? p.threshold);
      return {
        vars: {
          name,
          detail:
            onHand !== null
              ? `${onHand} left${level !== null ? ` (reorder level ${level})` : ''}.`
              : '',
        },
        entity: { type: 'consumable', id: event.aggregateId },
        link: '/consumables',
      };
    },
  },

  // M2-TAG labels: a batch of labels finished rendering. Emitted as `label.batch.ready`
  // (aggregate: the batch); the requester is read from `requestedBy` / `createdBy` in the payload.
  {
    event: 'label.batch.ready',
    type: 'label.batch.ready',
    recipients: payloadUser('requestedBy', 'requested_by', 'createdBy', 'created_by'),
    describe(event) {
      return Promise.resolve({
        vars: {},
        entity: { type: 'label_batch', id: event.aggregateId },
      });
    },
  },
];
