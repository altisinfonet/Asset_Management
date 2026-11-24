// Public facade of the outbox module (M1-PLAT-05). Publishing goes through the OUTBOX_PUBLISHER port
// (src/ports); subscribers register with OutboxSubscribers; the relay runs in the worker role.
export { PgOutboxPublisher, flushOutboxRows } from './outbox-publisher.js';
export {
  DEFAULT_RELAY_OPTIONS,
  OutboxRelay,
  OutboxSubscribers,
  type OutboxDelivery,
  type OutboxPattern,
  type OutboxSubscriber,
  type RelayOptions,
  type RelayPass,
} from './relay.js';
