import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { generateToken, hashToken } from '../identity/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import {
  assertIfMatch,
  type FieldError,
  type IfMatch,
  type ListQuery,
  type ListSpec,
  listPage,
  problem,
} from '../platform/index.js';
import { AUDIT_WRITER, type AuditWriter } from '../ports/index.js';
import {
  asBytes,
  isUniqueViolation,
  type Prisma,
  TenancyService,
  type Tx,
} from '../tenancy/index.js';
import { loadGrants, lowerEmail } from './access-data.js';
import type { AuthContext } from './auth-context.js';
import { AuthMailer } from './auth-mailer.service.js';
import { type SessionInfoDto, type UserDto, userDto } from './auth.dto.js';
import type { RoleAssignmentBody, UserCreateBody, UserUpdateBody } from './auth.schemas.js';
import { type GrantedRole, PolicyService, type PolicySubject } from './policy.service.js';
import { MfaService } from './mfa.service.js';
import { SessionService } from './session.service.js';

export const userListSpec: ListSpec = {
  sortable: {
    display_name: { kind: 'string' },
    email: { kind: 'string' },
    created_at: { kind: 'date' },
  },
  defaultSort: 'display_name',
};

type UserListFilters = { status?: string; role_id?: string; q?: string; archived?: string };

/**
 * User management (M1-AUTH-07). Every method runs in ONE tenant transaction with its audit entry, and
 * several enforce rules beyond the permission check:
 *  - privilege escalation: nobody can grant a role holding permissions they do not hold themselves,
 *    nor change a user who holds permissions they do not hold;
 *  - the last active administrator cannot be removed, demoted, disabled or archived (409);
 *  - role changes, disabling and archiving revoke the user's sessions;
 *  - revoking an invitation archives the never-activated account (ED-14).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly policy: PolicyService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly mailer: AuthMailer,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private tx<T>(auth: AuthContext, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.tenancy.withTenantTx({ tenantId: auth.tenantId, actorId: auth.principalId }, fn);
  }

  private subject(auth: AuthContext): PolicySubject {
    return { grants: auth.grants, keyScopes: auth.apiKeyScopes };
  }

  // -------------------------------------------------------------------------------------- reads

  async listRoles(auth: AuthContext) {
    const roles = await this.tx(auth, (trx) =>
      trx.role.findMany({ orderBy: [{ is_builtin: 'desc' }, { name: 'asc' }] }),
    );
    return {
      data: roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        is_builtin: r.is_builtin,
      })),
    };
  }

  async listCompanies(auth: AuthContext) {
    const rows = await this.tx(auth, (trx) =>
      trx.company.findMany({
        where: { archived_at: null },
        orderBy: [{ is_default: 'desc' }, { name: 'asc' }],
      }),
    );
    return {
      data: rows.map((c) => ({ id: c.id, name: c.name, code: c.code, is_default: c.is_default })),
    };
  }

  async list(auth: AuthContext, query: ListQuery & UserListFilters) {
    return this.tx(auth, async (trx) => {
      const filter: Prisma.user_accountWhereInput = {
        ...(query.archived === 'only'
          ? { archived_at: { not: null } }
          : query.archived === 'include'
            ? {}
            : { archived_at: null }),
        ...(query.status ? { status: query.status } : {}),
        ...(query.role_id ? { role_assignment: { some: { role_id: query.role_id } } } : {}),
        ...(query.q
          ? {
              OR: [
                { display_name: { contains: query.q, mode: 'insensitive' } },
                { email: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const page = await listPage({
        query,
        spec: userListSpec,
        filters: {
          status: query.status,
          role_id: query.role_id,
          q: query.q,
          archived: query.archived,
        },
        fetch: ({ take, orderBy, where }) =>
          trx.user_account.findMany({
            where: where ? { AND: [filter, where as Prisma.user_accountWhereInput] } : filter,
            orderBy: orderBy as Prisma.user_accountOrderByWithRelationInput[],
            take,
          }) as Promise<
            Array<
              Record<string, unknown> &
                Awaited<ReturnType<typeof trx.user_account.findFirstOrThrow>>
            >
          >,
        count: () => trx.user_account.count({ where: filter }),
      });
      const ids = page.data.map((u) => u.id);
      const grantsByUser = await this.grantsFor(trx, ids);
      return {
        data: page.data.map((u) => userDto(u, grantsByUser.get(u.id) ?? [])),
        page: page.page,
      };
    });
  }

  private async grantsFor(trx: Tx, userIds: string[]): Promise<Map<string, GrantedRole[]>> {
    const out = new Map<string, GrantedRole[]>();
    if (userIds.length === 0) return out;
    const rows = await trx.role_assignment.findMany({
      where: { user_id: { in: userIds } },
      include: { role: { select: { key: true, permissions: true } } },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });
    for (const r of rows) {
      const list = out.get(r.user_id) ?? [];
      list.push({
        assignmentId: r.id,
        roleId: r.role_id,
        roleKey: r.role.key,
        permissions: r.role.permissions,
        scopeType: r.scope_type as GrantedRole['scopeType'],
        scopeCompanyId: r.scope_company_id,
        scopeLocationId: r.scope_location_id,
      });
      out.set(r.user_id, list);
    }
    return out;
  }

  async get(auth: AuthContext, id: string): Promise<{ user: UserDto; version: number }> {
    return this.tx(auth, async (trx) => {
      const user = await trx.user_account.findUnique({ where: { id } });
      if (!user) throw problem.notFound('User not found.');
      return { user: userDto(user, await loadGrants(trx, id)), version: user.version };
    });
  }

  // ------------------------------------------------------------------------------------- create

  /** Checks the role set of a request and returns the matching role rows. */
  private async resolveRoles(
    trx: Tx,
    auth: AuthContext,
    assignments: RoleAssignmentBody[],
  ): Promise<Map<string, { id: string; name: string; permissions: string[] }>> {
    const errors: FieldError[] = [];
    const roleIds = [...new Set(assignments.map((a) => a.role_id))];
    const roles = await trx.role.findMany({ where: { id: { in: roleIds } } });
    const byId = new Map(roles.map((r) => [r.id, r]));
    const companies = new Set(
      (
        await trx.company.findMany({
          where: { id: { in: assignments.flatMap((a) => (a.company_id ? [a.company_id] : [])) } },
          select: { id: true },
        })
      ).map((c) => c.id),
    );
    assignments.forEach((a, i) => {
      const role = byId.get(a.role_id);
      if (!role) {
        errors.push({
          pointer: `/role_assignments/${i}/role_id`,
          message: 'Unknown role.',
          code: 'not-found',
        });
        return;
      }
      if (a.scope_type === 'company' && (!a.company_id || !companies.has(a.company_id))) {
        errors.push({
          pointer: `/role_assignments/${i}/company_id`,
          message: 'A company-scoped assignment needs an existing company_id.',
          code: 'invalid',
        });
      }
      if (a.scope_type === 'location') {
        errors.push({
          pointer: `/role_assignments/${i}/scope_type`,
          message: 'Location-scoped roles become available with locations (M2).',
          code: 'not-supported',
        });
      }
      if (a.scope_type === 'tenant' && (a.company_id || a.location_id)) {
        errors.push({
          pointer: `/role_assignments/${i}/scope_type`,
          message: 'A tenant-scoped assignment has no company_id or location_id.',
          code: 'invalid',
        });
      }
    });
    if (errors.length > 0) throw problem.validation(errors);
    for (const role of roles) {
      if (!this.policy.canGrantRole(this.subject(auth), role.permissions)) {
        throw problem.forbidden('You cannot grant a role with more privileges than your own.');
      }
    }
    return byId;
  }

  async create(auth: AuthContext, body: UserCreateBody) {
    if (body.send_invite && body.status !== undefined && body.status !== 'invited') {
      throw problem.validation([
        {
          pointer: '/status',
          message:
            'An invited user starts as "invited"; use send_invite=false to create an active or disabled account.',
          code: 'invalid',
        },
      ]);
    }
    const email = lowerEmail(body.email);
    const status = body.send_invite ? 'invited' : (body.status ?? 'invited');
    const userId = uuidv7();

    try {
      const result = await this.tx(auth, async (trx) => {
        const roles = await this.resolveRoles(trx, auth, body.role_assignments);
        const existing = await trx.user_account.count({
          where: { archived_at: null, email: { equals: email, mode: 'insensitive' } },
        });
        if (existing > 0) throw problem.conflict('A user with this email already exists.');
        // An archived account's identity row is removed on archive, so the address is free again.

        const user = await trx.user_account.create({
          data: {
            id: userId,
            tenant_id: auth.tenantId,
            email,
            display_name: body.display_name,
            status,
            locale: body.locale ?? null,
            timezone: body.timezone ?? null,
            created_by: auth.userId,
          },
        });
        await trx.role_assignment.createMany({
          data: body.role_assignments.map((a) => ({
            id: uuidv7(),
            tenant_id: auth.tenantId,
            user_id: userId,
            role_id: a.role_id,
            scope_type: a.scope_type,
            scope_company_id: a.scope_type === 'company' ? (a.company_id ?? null) : null,
            scope_location_id: null,
            created_by: auth.userId,
          })),
        });
        await trx.login_identity.create({
          data: {
            tenant_id: auth.tenantId,
            user_id: userId,
            email_lower: email,
            status: status === 'disabled' ? 'disabled' : 'active',
          },
        });
        await this.audit.write(trx, {
          action: 'user.created',
          entityType: 'user',
          entityId: userId,
          after: {
            email,
            display_name: body.display_name,
            status,
            role_ids: body.role_assignments.map((a) => a.role_id),
          },
        });
        const grants = await loadGrants(trx, userId);
        if (body.send_invite) {
          const primary = roles.get(body.role_assignments[0]!.role_id)!;
          const issued = await this.issueInvitation(
            trx,
            auth,
            userId,
            body.role_assignments[0]!.role_id,
          );
          await this.audit.write(trx, {
            action: 'user.invited',
            entityType: 'user',
            entityId: userId,
            meta: {
              invitation_id: issued.invitationId,
              expires_at: issued.expiresAt.toISOString(),
            },
          });
          const tenant = await trx.tenant.findUniqueOrThrow({
            where: { id: auth.tenantId },
            select: { name: true },
          });
          // Inside the tenant transaction (ADR 0004): the invitation mail exists iff the user does.
          await this.mailer.invitation({
            to: email,
            displayName: body.display_name,
            tenantName: tenant.name,
            roleName: primary.name,
            token: issued.token,
            expiresAt: issued.expiresAt,
            invitedBy: auth.user.displayName,
          });
        }
        return { user, grants };
      });
      return { user: userDto(result.user, result.grants), version: result.user.version };
    } catch (err) {
      if (isUniqueViolation(err)) throw problem.conflict('A user with this email already exists.');
      throw err;
    }
  }

  /** Creates an invitation row and its single-use token (hashed). Replaces any earlier invitation's token. */
  private async issueInvitation(trx: Tx, auth: AuthContext, userId: string, roleId: string) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + this.config.INVITATION_TTL_DAYS * 86_400_000);
    const user = await trx.user_account.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    const invitationId = uuidv7();
    await trx.invitation.create({
      data: {
        id: invitationId,
        tenant_id: auth.tenantId,
        user_id: userId,
        email: user.email,
        role_id: roleId,
        expires_at: expiresAt,
        created_by: auth.userId,
      },
    });
    await trx.invitation_token.create({
      data: {
        token_hash: asBytes(hashToken(token)),
        tenant_id: auth.tenantId,
        invitation_id: invitationId,
        expires_at: expiresAt,
      },
    });
    return { token, expiresAt, invitationId };
  }

  // --------------------------------------------------------------------------------- update/archive

  /** The caller may only touch users that hold no permission the caller lacks. */
  private assertManageable(auth: AuthContext, targetGrants: readonly GrantedRole[]): void {
    const targetPerms = [...new Set(targetGrants.flatMap((g) => g.permissions))];
    if (!this.policy.canManageUserWith(this.subject(auth), targetPerms)) {
      throw problem.forbidden('You cannot manage a user who has more privileges than you.');
    }
  }

  private isAdmin(grants: readonly GrantedRole[]): boolean {
    return grants.some((g) => g.scopeType === 'tenant' && g.permissions.includes('*'));
  }

  /** 409 unless an ACTIVE administrator other than `exceptUserId` remains. */
  private async assertAnotherAdmin(trx: Tx, exceptUserId: string): Promise<void> {
    const others = await trx.user_account.count({
      where: {
        id: { not: exceptUserId },
        status: 'active',
        archived_at: null,
        role_assignment: { some: { scope_type: 'tenant', role: { permissions: { has: '*' } } } },
      },
    });
    if (others === 0) {
      throw problem.conflict(
        'The last active administrator cannot be removed, demoted, disabled or archived.',
      );
    }
  }

  async update(auth: AuthContext, id: string, ifMatch: IfMatch, body: UserUpdateBody) {
    const email = body.email === undefined ? undefined : lowerEmail(body.email);
    try {
      const out = await this.tx(auth, async (trx) => {
        const user = await trx.user_account.findUnique({ where: { id } });
        if (!user || user.archived_at) throw problem.notFound('User not found.');
        assertIfMatch(ifMatch, user.version);
        const before = await loadGrants(trx, id);
        this.assertManageable(auth, before);

        let revokeSessions = false;
        let roleChanged = false;
        const data: Prisma.user_accountUpdateInput = { updated_by: auth.userId };
        if (body.display_name !== undefined) data.display_name = body.display_name;
        if (body.locale !== undefined) data.locale = body.locale;
        if (body.timezone !== undefined) data.timezone = body.timezone;

        if (email !== undefined && email !== lowerEmail(user.email)) {
          const taken = await trx.user_account.count({
            where: {
              id: { not: id },
              archived_at: null,
              email: { equals: email, mode: 'insensitive' },
            },
          });
          if (taken > 0) throw problem.conflict('A user with this email already exists.');
          data.email = email;
          await trx.login_identity.updateMany({
            where: { user_id: id },
            data: { email_lower: email },
          });
        }

        if (body.status !== undefined && body.status !== user.status) {
          if (user.id === auth.userId && body.status !== 'active') {
            throw problem.conflict('You cannot disable your own account.');
          }
          if (body.status === 'invited') {
            throw problem.validation([
              {
                pointer: '/status',
                message: 'A user cannot be moved back to "invited".',
                code: 'invalid',
              },
            ]);
          }
          if (body.status === 'disabled') {
            if (this.isAdmin(before) && user.status === 'active')
              await this.assertAnotherAdmin(trx, id);
            await trx.login_identity.updateMany({
              where: { user_id: id },
              data: { status: 'disabled' },
            });
            revokeSessions = true;
          } else {
            const credential = await trx.credential.count({ where: { user_id: id } });
            if (credential === 0) {
              throw problem.conflict(
                'This user never accepted the invitation. Resend it instead of activating the account.',
              );
            }
            await trx.login_identity.updateMany({
              where: { user_id: id },
              data: { status: 'active' },
            });
          }
          data.status = body.status;
        }

        if (body.role_assignments !== undefined) {
          const roles = await this.resolveRoles(trx, auth, body.role_assignments);
          const key = (a: { role_id: string; scope_type: string; company_id?: string | null }) =>
            `${a.role_id}|${a.scope_type}|${a.scope_type === 'company' ? (a.company_id ?? '') : ''}`;
          const wanted = new Map(body.role_assignments.map((a) => [key(a), a]));
          const current = new Map(
            before.map((g) => [
              key({ role_id: g.roleId, scope_type: g.scopeType, company_id: g.scopeCompanyId }),
              g,
            ]),
          );
          const removed = [...current.entries()].filter(([k]) => !wanted.has(k));
          const added = [...wanted.entries()].filter(([k]) => !current.has(k));
          if (removed.length > 0 || added.length > 0) {
            roleChanged = true;
            const willBeAdmin = body.role_assignments.some(
              (a) => a.scope_type === 'tenant' && roles.get(a.role_id)?.permissions.includes('*'),
            );
            if (this.isAdmin(before) && !willBeAdmin && user.status === 'active') {
              await this.assertAnotherAdmin(trx, id);
            }
            if (removed.length > 0) {
              await trx.role_assignment.deleteMany({
                where: { id: { in: removed.map(([, g]) => g.assignmentId) } },
              });
            }
            if (added.length > 0) {
              await trx.role_assignment.createMany({
                data: added.map(([, a]) => ({
                  id: uuidv7(),
                  tenant_id: auth.tenantId,
                  user_id: id,
                  role_id: a.role_id,
                  scope_type: a.scope_type,
                  scope_company_id: a.scope_type === 'company' ? (a.company_id ?? null) : null,
                  scope_location_id: null,
                  created_by: auth.userId,
                })),
              });
            }
            revokeSessions = true;
          }
        }

        const updated = await trx.user_account.update({ where: { id }, data });
        const after = await loadGrants(trx, id);
        let revoked = 0;
        if (revokeSessions) {
          // Editing yourself must not sign you out of the request you are making.
          revoked = await this.sessions.revokeAll(
            trx,
            auth.tenantId,
            id,
            id === auth.userId ? (auth.sessionId ?? undefined) : undefined,
          );
        }
        await this.audit.write(trx, {
          action: roleChanged ? 'user.role_changed' : 'user.updated',
          entityType: 'user',
          entityId: id,
          before: {
            email: user.email,
            display_name: user.display_name,
            status: user.status,
            role_ids: before.map((g) => g.roleId),
          },
          after: {
            email: updated.email,
            display_name: updated.display_name,
            status: updated.status,
            role_ids: after.map((g) => g.roleId),
          },
          meta: { sessions_revoked: revoked },
        });
        return { user: updated, grants: after };
      });
      return { user: userDto(out.user, out.grants), version: out.user.version };
    } catch (err) {
      if (isUniqueViolation(err)) throw problem.conflict('A user with this email already exists.');
      throw err;
    }
  }

  async archive(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<void> {
    await this.tx(auth, async (trx) => {
      const user = await trx.user_account.findUnique({ where: { id } });
      if (!user || user.archived_at) throw problem.notFound('User not found.');
      assertIfMatch(ifMatch, user.version);
      if (id === auth.userId) throw problem.conflict('You cannot archive your own account.');
      const grants = await loadGrants(trx, id);
      this.assertManageable(auth, grants);
      if (this.isAdmin(grants) && user.status === 'active') await this.assertAnotherAdmin(trx, id);

      await trx.user_account.update({
        where: { id },
        data: { status: 'disabled', archived_at: new Date(), updated_by: auth.userId },
      });
      // Free the address (unique per tenant) and stop any further sign-in.
      await trx.login_identity.deleteMany({ where: { user_id: id } });
      await trx.invitation.updateMany({
        where: { user_id: id, status: 'pending' },
        data: { status: 'revoked' },
      });
      await trx.invitation_token.deleteMany({
        where: { tenant_id: auth.tenantId, invitation: { user_id: id } },
      });
      await trx.password_reset_token.deleteMany({ where: { user_id: id } });
      const revoked = await this.sessions.revokeAll(trx, auth.tenantId, id);
      await this.audit.write(trx, {
        action: 'user.archived',
        entityType: 'user',
        entityId: id,
        before: { email: user.email, status: user.status },
        meta: { sessions_revoked: revoked },
      });
    });
  }

  // ----------------------------------------------------------------------------------- invitations

  private async loadInvitedUser(trx: Tx, id: string) {
    const user = await trx.user_account.findUnique({ where: { id } });
    if (!user || user.archived_at) throw problem.notFound('User not found.');
    if (user.status !== 'invited') {
      throw problem.conflict('This user has no pending invitation (already active or disabled).');
    }
    return user;
  }

  async resendInvitation(auth: AuthContext, id: string): Promise<void> {
    await this.tx(auth, async (trx) => {
      const user = await this.loadInvitedUser(trx, id);
      const previous = await trx.invitation.findFirst({
        where: { user_id: id, status: { in: ['pending', 'expired'] } },
        orderBy: { created_at: 'desc' },
        include: { role: { select: { name: true } } },
      });
      if (!previous) throw problem.conflict('This user has no pending or expired invitation.');
      // The old link dies; a fresh single-use token with a new expiry replaces it.
      await trx.invitation_token.deleteMany({ where: { invitation_id: previous.id } });
      await trx.invitation.update({ where: { id: previous.id }, data: { status: 'revoked' } });
      const issued = await this.issueInvitation(trx, auth, id, previous.role_id);
      const tenant = await trx.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { name: true },
      });
      await this.audit.write(trx, {
        action: 'invitation.resent',
        entityType: 'user',
        entityId: id,
        meta: { invitation_id: issued.invitationId, replaced: previous.id },
      });
      // Inside the tenant transaction (ADR 0004): the mail exists iff the new token does.
      await this.mailer.invitation({
        to: user.email,
        displayName: user.display_name,
        tenantName: tenant.name,
        roleName: previous.role.name,
        token: issued.token,
        expiresAt: issued.expiresAt,
        invitedBy: auth.user.displayName,
      });
    });
  }

  async revokeInvitation(auth: AuthContext, id: string): Promise<void> {
    await this.tx(auth, async (trx) => {
      const user = await this.loadInvitedUser(trx, id);
      const invitations = await trx.invitation.findMany({
        where: { user_id: id, status: { in: ['pending', 'expired'] } },
        select: { id: true },
      });
      if (invitations.length === 0)
        throw problem.conflict('This user has no pending or expired invitation.');
      const ids = invitations.map((i) => i.id);
      await trx.invitation.updateMany({ where: { id: { in: ids } }, data: { status: 'revoked' } });
      await trx.invitation_token.deleteMany({ where: { invitation_id: { in: ids } } });
      // The account was never activated: archive it (and free its address), like archiveUser.
      await trx.user_account.update({
        where: { id },
        data: { status: 'disabled', archived_at: new Date(), updated_by: auth.userId },
      });
      await trx.login_identity.deleteMany({ where: { user_id: id } });
      await this.audit.write(trx, {
        action: 'invitation.revoked',
        entityType: 'user',
        entityId: id,
        before: { email: user.email, status: 'invited' },
      });
    });
  }

  // -------------------------------------------------------------------------- admin: MFA and sessions

  private async loadManageable(trx: Tx, auth: AuthContext, id: string) {
    const user = await trx.user_account.findUnique({ where: { id } });
    if (!user) throw problem.notFound('User not found.');
    this.assertManageable(auth, await loadGrants(trx, id));
    return user;
  }

  async resetMfa(auth: AuthContext, id: string): Promise<void> {
    await this.tx(auth, async (trx) => {
      const user = await this.loadManageable(trx, auth, id);
      if (id === auth.userId) {
        throw problem.conflict('You cannot reset your own MFA this way. Use DELETE /v1/auth/mfa.');
      }
      await this.mfa.removeAll(trx, id);
      const revoked = await this.sessions.revokeAll(trx, auth.tenantId, id);
      await this.audit.write(trx, {
        action: 'auth.mfa.reset',
        entityType: 'user',
        entityId: id,
        meta: { by: auth.userId, email: user.email, sessions_revoked: revoked },
      });
    });
  }

  async listUserSessions(auth: AuthContext, id: string): Promise<{ data: SessionInfoDto[] }> {
    return this.tx(auth, async (trx) => {
      await this.loadManageable(trx, auth, id);
      const rows = await this.sessions.listActive(trx, auth.tenantId, id);
      return {
        data: rows.map((r) => ({
          id: r.id,
          created_at: r.createdAt.toISOString(),
          last_seen_at: r.lastSeenAt.toISOString(),
          ip: r.ip,
          user_agent: r.userAgent,
          current: false,
        })),
      };
    });
  }

  async revokeUserSession(auth: AuthContext, id: string, sessionId: string): Promise<void> {
    await this.tx(auth, async (trx) => {
      await this.loadManageable(trx, auth, id);
      if (!(await this.sessions.revokeOne(trx, auth.tenantId, id, sessionId))) {
        throw problem.notFound('Session not found.');
      }
      await this.audit.write(trx, {
        action: 'session.revoked',
        entityType: 'session',
        entityId: sessionId,
        meta: { user_id: id, by: auth.userId },
      });
    });
  }
}
