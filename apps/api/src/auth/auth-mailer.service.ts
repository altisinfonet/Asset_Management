import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { MAIL_SENDER, type MailSender } from '../ports/index.js';

/**
 * The mails the auth module sends (templates `auth.invitation`, `auth.password-reset`,
 * `auth.mfa-enabled`, `auth.new-login`), through the MAIL_SENDER port. Callers send AFTER their
 * transaction committed (never mail a token for a rolled-back change) and a delivery failure is
 * logged, never surfaced: the admin can resend an invitation, the user can request another reset.
 * Template data never contains a password; links carry the single-use token.
 */
@Injectable()
export class AuthMailer {
  private readonly logger = new Logger(AuthMailer.name);

  constructor(
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private link(path: string, token: string): string {
    return `${this.config.WEB_BASE_URL.replace(/\/+$/, '')}${path}?token=${encodeURIComponent(token)}`;
  }

  private async send(
    template: string,
    to: string,
    data: Record<string, unknown>,
    locale?: string | null,
  ) {
    try {
      await this.mail.send({ to, template, data, ...(locale ? { locale } : {}) });
    } catch (err) {
      this.logger.error(`mail ${template} could not be sent: ${String(err)}`);
    }
  }

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
      display_name: input.displayName,
      tenant_name: input.tenantName,
      role_name: input.roleName,
      invited_by: input.invitedBy ?? null,
      link: this.link('/invitation', input.token),
      token: input.token,
      expires_at: input.expiresAt.toISOString(),
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
        display_name: input.displayName,
        tenant_name: input.tenantName,
        link: this.link('/reset-password', input.token),
        token: input.token,
        expires_at: input.expiresAt.toISOString(),
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
      { display_name: input.displayName, tenant_name: input.tenantName },
      input.locale,
    );
  }
}
