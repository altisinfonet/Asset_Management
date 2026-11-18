import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { SecurityLogService } from './security-log.service.js';
import { SessionService } from './session.service.js';
import { ThrottleService } from './throttle.service.js';
import { UsersService } from './users.service.js';

/**
 * Identity and access (M1-AUTH): passwords, browser sessions, MFA, invitations, password reset, API
 * keys, user management and the RBAC policy. Registers the global {@link AuthGuard} (every route must
 * declare an access rule). Auth errors are platform `ApiProblem`s (codes in PROBLEM_CATALOG), rendered
 * by the platform ProblemFilter: there is no import-order dependency.
 *
 * Needs the ports AUDIT_WRITER, MAIL_SENDER and SECRET_BOX from the platform module, and (global)
 * TenancyService, IdentityLookupService, ControlPlaneService.
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
  ],
  exports: [PolicyService, AuthService],
})
export class AuthModule {}
