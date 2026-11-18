import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { MAIL_SENDER, type MailSender } from '../ports/index.js';

/**
 * The mails the auth module sends (templates `auth.invitation`, `auth.password-reset`,
 * `auth.mfa-enabled`, `auth.new-login`), through the MAIL_SENDER port.
 *
 * Every method MUST be called inside the caller's `withTenantTx` (ADR 0004): the platform sender
 * stores the encrypted message and enqueues the `mail.send` job in that same transaction, so the
 * mail exists if and only if the business change (invitation, reset token, MFA row) commits, and
 * SMTP never runs on the request path. A failure (bad template data) therefore fails the caller's
 * request and rolls the change back. Template data never contains a password; links carry the
 * single-use token.
 */
@Injectable()
export class AuthMailer {
  constructor(
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private link(path: string, token: string): string {
    return `${this.config.WEB_BASE_URL.replace(/\/+$/, '')}${path}?token=${encodeURIComponent(token)}`;
  }

  private send(
    template: string,
    to: string,
    data: Record<string, unknown>,
    locale?: string | null,
  ): Promise<void> {
    return this.mail.send({ to, template, data, ...(locale ? { locale } : {}) });
  }

  /** Template data follows the platform schemas in `src/mail/templates.ts` (camelCase, URLs not tokens). */
  invitation(input: {
    to: string;
    displayName: string;
    tenantName: string;
    roleName: string;
    token: string;
    expiresAt: Date;
    invitedBy?: string;
  }) {
    return this.send('auth.invitation', input.to, {
      tenantName: input.tenantName,
      inviteeName: input.displayName,
      ...(input.invitedBy ? { inviterName: input.invitedBy } : {}),
      acceptUrl: this.link('/invitation', input.token),
      expiresAt: input.expiresAt.toISOString(),
    });
  }

  passwordReset(input: {
    to: string;
    displayName: string;
    tenantName: string;
    token: string;
    expiresAt: Date;
    locale?: string | null;
  }) {
    return this.send(
      'auth.password-reset',
      input.to,
      {
        userName: input.displayName,
        resetUrl: this.link('/reset-password', input.token),
        expiresInMinutes: this.config.PASSWORD_RESET_TTL_MINUTES,
      },
      input.locale,
    );
  }

  mfaEnabled(input: {
    to: string;
    displayName: string;
    tenantName: string;
    locale?: string | null;
  }) {
    return this.send(
      'auth.mfa-enabled',
      input.to,
      {
        userName: input.displayName,
        method: 'totp',
        occurredAt: new Date().toISOString(),
        securityUrl: `${this.config.WEB_BASE_URL.replace(/\/+$/, '')}/account/security`,
      },
      input.locale,
    );
  }
}
