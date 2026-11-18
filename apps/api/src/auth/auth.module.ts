import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AccessController } from './access.controller.js';
import { AccountSecurityService } from './account-security.service.js';
import { ApiKeysService } from './api-keys.service.js';
import { AuthMailer } from './auth-mailer.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AuthenticationService } from './authentication.service.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { PolicyService } from './policy.service.js';
import { AuthProblemFilter } from './problems.js';
import { SecurityLogService } from './security-log.service.js';
import { SessionService } from './session.service.js';
import { ThrottleService } from './throttle.service.js';
import { UsersService } from './users.service.js';

/**
 * Identity and access (M1-AUTH): passwords, browser sessions, MFA, invitations, password reset, API
 * keys, user management and the RBAC policy. Registers the global {@link AuthGuard} (every route must
 * declare an access rule) and the filter that renders the auth problem codes.
 *
 * Needs the ports AUDIT_WRITER, MAIL_SENDER and SECRET_BOX from the platform module, and (global)
 * TenancyService, IdentityLookupService, ControlPlaneService.
 *
 * Import order matters for the filter: Nest tries the most recently registered global filter first,
 * so this module must be imported AFTER PlatformModule (whose catch-all filter would otherwise
 * render AuthProblem as a generic HTTP error). test/auth/auth-filter.e2e.test.ts guards that.
 */
@Module({
  controllers: [AuthController, AccessController],
  providers: [
    PolicyService,
    PasswordService,
    ThrottleService,
    SecurityLogService,
    SessionService,
    MfaService,
    AuthMailer,
    AuthService,
    AccountSecurityService,
    UsersService,
    ApiKeysService,
    AuthenticationService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AuthProblemFilter },
  ],
  exports: [PolicyService, AuthService],
})
export class AuthModule {}
