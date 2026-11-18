import { createTransport, type Transporter } from 'nodemailer';
import type { RenderedEmail } from './templates.js';

/** The delivery edge. SMTP today (Mailpit in dev, the customer relay self-hosted); SES in Cloud (M6). */
export interface MailTransport {
  deliver(mail: OutgoingMail): Promise<{ messageId: string }>;
  close(): void;
}

export interface OutgoingMail extends Pick<RenderedEmail, 'subject' | 'text' | 'html'> {
  from: string;
  to: string;
  /** Correlation, e.g. the mail row id: lets an operator find the message in relay logs. */
  reference?: string;
}

/** SMTP adapter over nodemailer. `url` is `smtp://host:port` or `smtps://user:pass@host:465`. */
export class SmtpMailTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(url: string) {
    this.transporter = createTransport({
      url,
      pool: true,
      maxConnections: 2,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async deliver(mail: OutgoingMail): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({
      from: mail.from,
      to: mail.to,
      // Header injection guard: a subject is one line.
      subject: mail.subject.replace(/[\r\n]+/g, ' '),
      text: mail.text,
      html: mail.html,
      headers: {
        'Auto-Submitted': 'auto-generated',
        ...(mail.reference ? { 'X-Entity-Ref-ID': mail.reference } : {}),
      },
    });
    return { messageId: info.messageId };
  }

  close(): void {
    this.transporter.close();
  }
}

/** Used when no SMTP_URL is configured: failing loudly beats silently dropping a password reset. */
export class UnconfiguredMailTransport implements MailTransport {
  async deliver(): Promise<{ messageId: string }> {
    throw new Error('SMTP_URL is not configured: cannot send mail');
  }
  close(): void {}
}
