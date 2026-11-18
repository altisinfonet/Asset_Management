import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodValidationPipe } from '../platform/index.js';
import { AccountSecurityService } from './account-security.service.js';
import {
  AllowLimitedSession,
  Authenticated,
  NoIdempotencyKey,
  Public,
  SelfService,
} from './access.js';
import { type AuthContext, Client, type ClientInfo, CurrentAuth } from './auth-context.js';
import {
  acceptInvitationSchema,
  forgotPasswordSchema,
  invitationTokenParam,
  loginSchema,
  mfaConfirmSchema,
  mfaVerifySchema,
  reauthSchema,
  resetPasswordSchema,
  uuidParam,
  type LoginBody,
  type MfaVerifyBody,
  type ReauthBody,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';

const NoStore = () => Header('Cache-Control', 'no-store');

function withCookie(reply: FastifyReply, cookie: string | undefined): void {
  if (cookie) void reply.header('set-cookie', cookie);
}

/** `/v1/auth/*` (tag Auth). Handlers are thin: validation here, rules in AuthService / AccountSecurityService. */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly account: AccountSecurityService,
  ) {}

  // ----------------------------------------------------------------------------- unauthenticated

  @Post('login')
  @Public()
  @HttpCode(200)
  @NoStore()
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginBody,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.login(body, client);
    withCookie(reply, result.cookie);
    return result.body;
  }

  @Post('mfa/verify')
  @Public()
  @HttpCode(200)
  @NoStore()
  async verifyMfa(
    @Body(new ZodValidationPipe(mfaVerifySchema)) body: MfaVerifyBody,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.verifyMfa(body, client);
    withCookie(reply, result.cookie);
    return result.body;
  }

  @Get('password-policy')
  @Public()
  passwordPolicy() {
    return this.auth.passwordPolicy();
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: { email: string },
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.auth.requestPasswordReset(body.email, client);
  }

  @Post('password/reset')
  @Public()
  @HttpCode(204)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: { token: string; password: string },
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.auth.resetPassword(body.token, body.password, client);
  }

  @Get('invitations/:token')
  @Public()
  @NoStore()
  getInvitation(
    @Param('token', new ZodValidationPipe(invitationTokenParam, 'params')) token: string,
    @Client() client: ClientInfo,
  ) {
    return this.auth.getInvitation(token, client);
  }

  @Post('invitations/accept')
  @Public()
  @HttpCode(200)
  @NoStore()
  async acceptInvitation(
    @Body(new ZodValidationPipe(acceptInvitationSchema))
    body: { token: string; password: string; display_name: string },
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.acceptInvitation(body, client);
    withCookie(reply, result.cookie);
    return result.body;
  }

  // ------------------------------------------------------------------------------- signed in

  @Post('logout')
  @Authenticated()
  @AllowLimitedSession()
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const { cookie } = await this.auth.logout(auth);
    withCookie(reply, cookie);
  }

  @Get('me')
  @Authenticated()
  @AllowLimitedSession()
  @NoStore()
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  // ------------------------------------------------------------------------------------- MFA

  @Post('mfa/enrol')
  @SelfService()
  @AllowLimitedSession()
  @NoIdempotencyKey()
  @HttpCode(200)
  @NoStore()
  startMfaEnrolment(@CurrentAuth() auth: AuthContext) {
    return this.account.startEnrolment(auth);
  }

  @Post('mfa/enrol/confirm')
  @SelfService()
  @AllowLimitedSession()
  @NoIdempotencyKey()
  @HttpCode(200)
  @NoStore()
  async confirmMfaEnrolment(
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
    @Body(new ZodValidationPipe(mfaConfirmSchema)) body: { code: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.account.confirmEnrolment(auth, body.code, client);
    withCookie(reply, result.cookie);
    return result.body;
  }

  @Post('mfa/recovery-codes/regenerate')
  @SelfService()
  @NoIdempotencyKey()
  @HttpCode(200)
  @NoStore()
  regenerateRecoveryCodes(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(reauthSchema)) body: ReauthBody,
  ) {
    return this.account.regenerateRecoveryCodes(auth, body);
  }

  @Delete('mfa')
  @SelfService()
  @HttpCode(204)
  async disableMfa(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(reauthSchema)) body: ReauthBody,
  ): Promise<void> {
    await this.account.disableMfa(auth, body);
  }

  // --------------------------------------------------------------------------------- sessions

  @Get('sessions')
  @SelfService()
  listMySessions(@CurrentAuth() auth: AuthContext) {
    return this.account.listMySessions(auth);
  }

  @Delete('sessions')
  @SelfService()
  @HttpCode(204)
  async revokeOtherSessions(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.account.revokeOtherSessions(auth);
  }

  @Delete('sessions/:id')
  @SelfService()
  @HttpCode(204)
  async revokeMySession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ZodValidationPipe(uuidParam, 'params')) id: string,
  ): Promise<void> {
    await this.account.revokeMySession(auth, id);
  }
}
