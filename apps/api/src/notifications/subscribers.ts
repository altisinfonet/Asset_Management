import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type OutboxDelivery, OutboxSubscribers } from '../outbox/index.js';
import { NOTIFIER, type Notifier } from '../ports/index.js';
import type { Tx } from '../tenancy/index.js';
import { usersWithRoles } from './recipients.js';
import { NOTIFICATION_SUBSCRIPTIONS, type Subscription } from './subscriptions.js';
import { typeDef } from './types.js';

/**
 * Registers every entry of `NOTIFICATION_SUBSCRIPTIONS` with the outbox relay (which runs in the worker
 * role) and turns a delivered event into a NOTIFIER call. The relay runs the handler inside its tenant
 * transaction, so reading the subject, resolving the recipients and creating the notifications are one
 * atomic step together with marking the event delivered; a failure rolls everything back and the relay
 * retries with backoff (then dead-letters).
 */
@Injectable()
export class NotificationSubscribers implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxSubscribers,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {}

  onModuleInit(): void {
    this.register(NOTIFICATION_SUBSCRIPTIONS);
  }

  /** Subscribes `list` to the relay; returns the unsubscribe functions (tests use them). */
  register(list: readonly Subscription[]): Array<() => void> {
    return list.map((sub) =>
      this.outbox.subscribe(sub.event, (event, { tx }) => this.handle(sub, event, tx)),
    );
  }

  /** One event, one subscription. Exported for the unit and e2e tests. */
  async handle(sub: Subscription, event: OutboxDelivery, tx: Tx): Promise<void> {
    const def = typeDef(sub.type);
    if (!def) throw new Error(`subscription for ${sub.event}: unknown type ${sub.type}`);
    const rule = await tx.notification_rule.findFirst({ where: { type: sub.type } });
    if (rule && !rule.enabled) return;

    // An administrator may re-address a type that is meant for "users who hold a permission".
    const roles =
      def.roleConfigurable && rule && rule.recipient_roles.length > 0 ? rule.recipient_roles : null;
    const recipients = roles ? await usersWithRoles(tx, roles) : await sub.recipients(event, tx);
    if (recipients.length === 0) return;

    const described = await sub.describe(event, tx);
    if (!described) return;
    await this.notifier.notify(tx, {
      type: sub.type,
      recipients,
      vars: described.vars,
      ...(described.entity ? { entity: described.entity } : {}),
      ...(described.link ? { link: described.link } : {}),
      dedupeKey: sub.dedupe ? sub.dedupe(event) : event.id,
    });
  }
}
