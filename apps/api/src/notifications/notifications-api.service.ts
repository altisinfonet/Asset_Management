import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { type ListSpec, type Page, listPage, problem } from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import { RegistryBase } from '../registry/index.js';
import { TenancyService, type Tx } from '../tenancy/index.js';
import type {
  DeliveryListQuery,
  NotificationListQuery,
  PreferenceUpdate,
  RuleUpdate,
} from './schemas.js';
import {
  type EmailMode,
  NOTIFICATION_TYPE_KEYS,
  type NotificationType,
  isNotificationType,
  typeDef,
} from './types.js';

type NotificationRow = NonNullable<Awaited<ReturnType<Tx['notification']['findUnique']>>>;
type DeliveryRow = NonNullable<Awaited<ReturnType<Tx['notification_delivery']['findUnique']>>>;

const LIST_SPEC: ListSpec = {
  sortable: { created_at: { kind: 'date' } },
  defaultSort: '-created_at',
};

/** Schema `Notification`. */
export const notificationDto = (r: NotificationRow) => ({
  id: r.id,
  type: r.type,
  title: r.title,
  body: r.body,
  link: r.link,
  entity_type: r.entity_type,
  entity_id: r.entity_id,
  created_at: r.created_at.toISOString(),
  read_at: r.read_at ? r.read_at.toISOString() : null,
});

const deliveryDto = (r: DeliveryRow) => ({
  id: r.id,
  notification_id: r.notification_id,
  user_id: r.user_id,
  type: r.type,
  channel: r.channel,
  status: r.status,
  reason: r.reason,
  created_at: r.created_at.toISOString(),
});

/**
 * The notification endpoints (M2-NOT-01): the caller's inbox (list, unread count, mark read), their
 * delivery preferences per type, the organisation's rules per type and the delivery log. Creating
 * notifications is the NOTIFIER port (`notification.service.ts`), not an endpoint.
 */
@Injectable()
export class NotificationsApiService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  // ------------------------------------------------------------------------------- the inbox

  async list(
    auth: AuthContext,
    query: NotificationListQuery,
  ): Promise<Page<ReturnType<typeof notificationDto>>> {
    return this.tx(auth, async (trx) => {
      const filter = {
        user_id: auth.userId,
        in_app: true,
        ...(query.unread === true ? { read_at: null } : {}),
        ...(query.unread === false ? { read_at: { not: null } } : {}),
      };
      const page = await listPage({
        query: {
          limit: query.limit,
          include_total: false,
          ...(query.cursor ? { cursor: query.cursor } : {}),
        },
        spec: LIST_SPEC,
        filters: { unread: query.unread },
        fetch: ({ take, orderBy, where }) =>
          trx.notification.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<NotificationRow & Record<string, unknown>>>,
      });
      return { data: page.data.map(notificationDto), page: page.page };
    });
  }

  async unreadCount(auth: AuthContext): Promise<{ count: number }> {
    return this.tx(auth, async (trx) => ({
      count: await trx.notification.count({
        where: { user_id: auth.userId, in_app: true, read_at: null },
      }),
    }));
  }

  async markRead(auth: AuthContext, id: string): Promise<ReturnType<typeof notificationDto>> {
    return this.tx(auth, async (trx) => {
      await trx.notification.updateMany({
        where: { id, user_id: auth.userId, in_app: true, read_at: null },
        data: { read_at: new Date() },
      });
      const row = await trx.notification.findFirst({
        where: { id, user_id: auth.userId, in_app: true },
      });
      if (!row) throw problem.notFound('Notification not found.');
      return notificationDto(row);
    });
  }

  async markAllRead(auth: AuthContext): Promise<{ updated: number }> {
    return this.tx(auth, async (trx) => {
      const result = await trx.notification.updateMany({
        where: { user_id: auth.userId, in_app: true, read_at: null },
        data: { read_at: new Date() },
      });
      return { updated: result.count };
    });
  }

  // ------------------------------------------------------------------------- preferences

  async preferences(auth: AuthContext) {
    return this.tx(auth, async (trx) => {
      const rows = await trx.notification_preference.findMany({ where: { user_id: auth.userId } });
      const byType = new Map(rows.map((r) => [r.type, r]));
      return { data: NOTIFICATION_TYPE_KEYS.map((type) => preferenceDto(type, byType.get(type))) };
    });
  }

  async setPreference(auth: AuthContext, type: string, body: PreferenceUpdate) {
    if (!isNotificationType(type)) throw problem.notFound('No such notification type.');
    return this.tx(auth, async (trx) => {
      const existing = await trx.notification_preference.findFirst({
        where: { user_id: auth.userId, type },
      });
      const def = typeDef(type)!;
      const inApp = body.in_app ?? existing?.in_app ?? def.defaults.inApp;
      const email = (body.email ?? existing?.email ?? def.defaults.email) as EmailMode;
      const row = existing
        ? await trx.notification_preference.update({
            where: { id: existing.id },
            data: { in_app: inApp, email, updated_by: auth.userId },
          })
        : await trx.notification_preference.create({
            data: {
              id: uuidv7(),
              tenant_id: auth.tenantId,
              user_id: auth.userId,
              type,
              in_app: inApp,
              email,
              created_by: auth.userId,
            },
          });
      return preferenceDto(type, row);
    });
  }

  // --------------------------------------------------------------------------------- rules

  async rules(auth: AuthContext) {
    return this.tx(auth, async (trx) => {
      const rows = await trx.notification_rule.findMany();
      const byType = new Map(rows.map((r) => [r.type, r]));
      return { data: NOTIFICATION_TYPE_KEYS.map((type) => ruleDto(type, byType.get(type))) };
    });
  }

  async setRule(auth: AuthContext, type: string, body: RuleUpdate) {
    if (!isNotificationType(type)) throw problem.notFound('No such notification type.');
    const def = typeDef(type)!;
    return this.tx(auth, async (trx) => {
      if (body.recipient_roles && !def.roleConfigurable) {
        throw problem.validation([
          {
            pointer: '/recipient_roles',
            message: 'this notification is addressed to a specific user and cannot be re-addressed',
            code: 'invalid',
          },
        ]);
      }
      if (body.recipient_roles && body.recipient_roles.length > 0) {
        const roles = await trx.role.findMany({
          where: { key: { in: body.recipient_roles } },
          select: { key: true },
        });
        const known = new Set(roles.map((r) => r.key));
        const unknown = body.recipient_roles
          .map((key, i) => ({ key, i }))
          .filter(({ key }) => !known.has(key));
        if (unknown.length > 0) {
          throw problem.validation(
            unknown.map(({ key, i }) => ({
              pointer: `/recipient_roles/${i}`,
              message: `no role "${key}"`,
              code: 'not-found',
            })),
          );
        }
      }
      const existing = await trx.notification_rule.findFirst({ where: { type } });
      // `null` and an empty list both mean "the default recipients" (a type that should reach nobody is disabled).
      const data = {
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.recipient_roles !== undefined
          ? { recipient_roles: body.recipient_roles ?? [] }
          : {}),
      };
      const row = existing
        ? await trx.notification_rule.update({
            where: { id: existing.id },
            data: { ...data, updated_by: auth.userId },
          })
        : await trx.notification_rule.create({
            data: {
              id: uuidv7(),
              tenant_id: auth.tenantId,
              type,
              enabled: body.enabled ?? true,
              recipient_roles: body.recipient_roles ?? [],
              created_by: auth.userId,
            },
          });
      await this.record(trx, {
        entity: 'notification_rule',
        verb: 'updated',
        id: row.id,
        version: row.version,
        before: existing
          ? { enabled: existing.enabled, recipient_roles: existing.recipient_roles }
          : { enabled: true, recipient_roles: [] },
        after: { enabled: row.enabled, recipient_roles: row.recipient_roles },
        meta: { type },
      });
      return ruleDto(type, row);
    });
  }

  // ----------------------------------------------------------------------- delivery log

  async deliveries(
    auth: AuthContext,
    query: DeliveryListQuery,
  ): Promise<Page<ReturnType<typeof deliveryDto>>> {
    return this.tx(auth, async (trx) => {
      const filter = {
        AND: [
          query.user_id ? { user_id: query.user_id } : {},
          query.type ? { type: query.type } : {},
          query.channel ? { channel: query.channel } : {},
          query.status?.length ? { status: { in: query.status } } : {},
          query.from ? { created_at: { gte: new Date(query.from) } } : {},
          query.to ? { created_at: { lt: new Date(query.to) } } : {},
        ],
      };
      const page = await listPage({
        query: {
          limit: query.limit,
          include_total: false,
          ...(query.cursor ? { cursor: query.cursor } : {}),
        },
        spec: LIST_SPEC,
        filters: {
          user_id: query.user_id,
          type: query.type,
          channel: query.channel,
          status: query.status,
          from: query.from,
          to: query.to,
        },
        fetch: ({ take, orderBy, where }) =>
          trx.notification_delivery.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<DeliveryRow & Record<string, unknown>>>,
      });
      return { data: page.data.map(deliveryDto), page: page.page };
    });
  }
}

type PreferenceRow = NonNullable<Awaited<ReturnType<Tx['notification_preference']['findUnique']>>>;
type RuleRow = NonNullable<Awaited<ReturnType<Tx['notification_rule']['findUnique']>>>;

function preferenceDto(type: NotificationType, row: PreferenceRow | undefined) {
  const def = typeDef(type)!;
  return {
    type,
    label: def.label,
    description: def.description,
    in_app: row ? row.in_app : def.defaults.inApp,
    email: (row ? row.email : def.defaults.email) as EmailMode,
    is_default: !row,
  };
}

function ruleDto(type: NotificationType, row: RuleRow | undefined) {
  const def = typeDef(type)!;
  return {
    type,
    label: def.label,
    description: def.description,
    enabled: row ? row.enabled : true,
    recipients: def.recipients,
    role_configurable: def.roleConfigurable,
    recipient_roles: row && row.recipient_roles.length > 0 ? row.recipient_roles : null,
    updated_at: row ? row.updated_at.toISOString() : null,
  };
}
