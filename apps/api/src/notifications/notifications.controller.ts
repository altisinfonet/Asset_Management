import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { CurrentAuth, RequirePermission, SelfService, type AuthContext } from '../auth/index.js';
import { ZodValidationPipe } from '../platform/index.js';
import { NotificationsApiService } from './notifications-api.service.js';
import {
  deliveryListSchema,
  notificationListSchema,
  preferenceUpdateSchema,
  ruleUpdateSchema,
  typeParam,
  uuidParam,
  type DeliveryListQuery,
  type NotificationListQuery,
  type PreferenceUpdate,
  type RuleUpdate,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');
const typePipe = () => new ZodValidationPipe(typeParam, 'params');

/**
 * The caller's own notifications and preferences (tag Notifications, self-service: a signed-in browser
 * session, no permission). The static routes (`unread-count`, `read-all`) are declared before the
 * `:id` ones.
 */
@Controller()
export class NotificationsController {
  constructor(private readonly api: NotificationsApiService) {}

  @Get('notifications')
  @SelfService()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(notificationListSchema, 'query')) query: NotificationListQuery,
  ) {
    return this.api.list(auth, query);
  }

  @Get('notifications/unread-count')
  @SelfService()
  unreadCount(@CurrentAuth() auth: AuthContext) {
    return this.api.unreadCount(auth);
  }

  @Post('notifications/read-all')
  @SelfService()
  @HttpCode(200)
  readAll(@CurrentAuth() auth: AuthContext) {
    return this.api.markAllRead(auth);
  }

  @Post('notifications/:id/read')
  @SelfService()
  @HttpCode(200)
  read(@CurrentAuth() auth: AuthContext, @Param('id', idParam()) id: string) {
    return this.api.markRead(auth, id);
  }

  @Get('notification-preferences')
  @SelfService()
  preferences(@CurrentAuth() auth: AuthContext) {
    return this.api.preferences(auth);
  }

  @Put('notification-preferences/:type')
  @SelfService()
  setPreference(
    @CurrentAuth() auth: AuthContext,
    @Param('type', typePipe()) type: string,
    @Body(new ZodValidationPipe(preferenceUpdateSchema)) body: PreferenceUpdate,
  ) {
    return this.api.setPreference(auth, type, body);
  }
}

/** Administration of notifications: the rules of the organisation and the delivery log. */
@Controller()
export class NotificationAdminController {
  constructor(private readonly api: NotificationsApiService) {}

  @Get('notification-rules')
  @RequirePermission('notification:manage')
  rules(@CurrentAuth() auth: AuthContext) {
    return this.api.rules(auth);
  }

  @Put('notification-rules/:type')
  @RequirePermission('notification:manage')
  setRule(
    @CurrentAuth() auth: AuthContext,
    @Param('type', typePipe()) type: string,
    @Body(new ZodValidationPipe(ruleUpdateSchema)) body: RuleUpdate,
  ) {
    return this.api.setRule(auth, type, body);
  }

  @Get('notification-deliveries')
  @RequirePermission('notification:manage')
  deliveries(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(deliveryListSchema, 'query')) query: DeliveryListQuery,
  ) {
    return this.api.deliveries(auth, query);
  }
}
