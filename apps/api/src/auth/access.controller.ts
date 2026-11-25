import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  type IfMatch,
  type ListQuery,
  listQuerySchema,
  RequiredIfMatch,
  setEtag,
  ZodValidationPipe,
} from '../platform/index.js';
import { RequirePermission } from './access.js';
import { ApiKeysService } from './api-keys.service.js';
import { type AuthContext, CurrentAuth } from './auth-context.js';
import {
  apiKeyCreateSchema,
  roleAssignmentSchema,
  userCreateSchema,
  userListQuerySchema,
  userUpdateSchema,
  uuidParam,
  type RoleAssignmentBody,
  type UserCreateBody,
  type UserUpdateBody,
} from './auth.schemas.js';
import { UsersService } from './users.service.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');
const listSchema = listQuerySchema.extend(userListQuerySchema.shape);
const keyListSchema = listQuerySchema;

/** `/v1/users`, `/v1/roles`, `/v1/companies`, `/v1/api-keys` (tag Access). */
@Controller()
export class AccessController {
  constructor(
    private readonly users: UsersService,
    private readonly keys: ApiKeysService,
  ) {}

  // -------------------------------------------------------------------------------------- roles

  @Get('roles')
  @RequirePermission('role:read')
  listRoles(@CurrentAuth() auth: AuthContext) {
    return this.users.listRoles(auth);
  }

  @Get('companies')
  @RequirePermission('company:read')
  listCompanies(@CurrentAuth() auth: AuthContext) {
    return this.users.listCompanies(auth);
  }

  // -------------------------------------------------------------------------------------- users

  @Get('users')
  @RequirePermission('user:read')
  listUsers(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(listSchema, 'query'))
    query: ListQuery & { status?: string; role_id?: string; q?: string; archived?: string },
  ) {
    return this.users.list(auth, query);
  }

  @Post('users')
  @RequirePermission('user:manage')
  @HttpCode(201)
  async createUser(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(userCreateSchema)) body: UserCreateBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { user, version } = await this.users.create(auth, body);
    setEtag(reply, version);
    void reply.header('location', `/v1/users/${user.id}`);
    return user;
  }

  @Get('users/:id')
  @RequirePermission('user:read')
  async getUser(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { user, version } = await this.users.get(auth, id);
    setEtag(reply, version);
    return user;
  }

  @Patch('users/:id')
  @RequirePermission('user:manage')
  async updateUser(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(userUpdateSchema)) body: UserUpdateBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { user, version } = await this.users.update(auth, id, ifMatch, body);
    setEtag(reply, version);
    return user;
  }

  @Delete('users/:id')
  @RequirePermission('user:manage')
  @HttpCode(204)
  async archiveUser(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
  ): Promise<void> {
    await this.users.archive(auth, id, ifMatch);
  }

  @Post('users/:id/role-assignments')
  @RequirePermission('user:manage')
  @HttpCode(201)
  async addRoleAssignment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(roleAssignmentSchema)) body: RoleAssignmentBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { user, version } = await this.users.addRoleAssignment(auth, id, ifMatch, body);
    setEtag(reply, version);
    return user;
  }

  @Delete('users/:id/role-assignments/:assignment_id')
  @RequirePermission('user:manage')
  async removeRoleAssignment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Param('assignment_id', idParam()) assignmentId: string,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { user, version } = await this.users.removeRoleAssignment(
      auth,
      id,
      assignmentId,
      ifMatch,
    );
    setEtag(reply, version);
    return user;
  }

  @Post('users/:id/invitation/resend')
  @RequirePermission('user:manage')
  @HttpCode(204)
  async resendInvitation(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
  ): Promise<void> {
    await this.users.resendInvitation(auth, id);
  }

  @Delete('users/:id/invitation')
  @RequirePermission('user:manage')
  @HttpCode(204)
  async revokeInvitation(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
  ): Promise<void> {
    await this.users.revokeInvitation(auth, id);
  }

  @Delete('users/:id/mfa')
  @RequirePermission('user:manage')
  @HttpCode(204)
  async resetMfa(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
  ): Promise<void> {
    await this.users.resetMfa(auth, id);
  }

  @Get('users/:id/sessions')
  @RequirePermission('user:manage')
  listUserSessions(@CurrentAuth() auth: AuthContext, @Param('id', idParam()) id: string) {
    return this.users.listUserSessions(auth, id);
  }

  @Delete('users/:id/sessions/:session_id')
  @RequirePermission('user:manage')
  @HttpCode(204)
  async revokeUserSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Param('session_id', idParam()) sessionId: string,
  ): Promise<void> {
    await this.users.revokeUserSession(auth, id, sessionId);
  }

  // ----------------------------------------------------------------------------------- API keys

  @Get('api-keys')
  @RequirePermission('apikey:manage')
  listApiKeys(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(keyListSchema, 'query')) query: ListQuery,
  ) {
    return this.keys.list(auth, query);
  }

  @Post('api-keys')
  @RequirePermission('apikey:manage')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async createApiKey(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(apiKeyCreateSchema))
    body: { name: string; scopes: string[]; expires_at?: string | null },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const created = await this.keys.create(auth, body);
    void reply.header('location', `/v1/api-keys/${created.id}`);
    return created;
  }

  @Delete('api-keys/:id')
  @RequirePermission('apikey:manage')
  @HttpCode(204)
  async revokeApiKey(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
  ): Promise<void> {
    await this.keys.revoke(auth, id);
  }
}
