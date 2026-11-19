import { z } from 'zod';
import { type Translator, resolveLocale, translator } from './i18n.js';

/**
 * Transactional mail templates (M1-PLAT-09): `auth.invitation`, `auth.password-reset`,
 * `auth.mfa-enabled`, `auth.new-login`. Each template declares
 *   - a zod schema of its data (validated when `MailSender.send` is called, so a bad caller fails
 *     in its own request, not later in the worker);
 *   - a layout: subject, preheader and a list of blocks, rendered to BOTH a plain-text and a simple
 *     HTML body from the same source, so the two cannot drift apart.
 * All text comes from the locale catalogue (`i18n.ts`). Every interpolated value is HTML-escaped in
 * the HTML part; links are only accepted as http(s) URLs.
 */
export const PRODUCT_NAME = 'Asset Tracker';

const httpUrl = z
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'must be an http(s) URL')
  .max(2048);
const shortText = (max = 200) => z.string().trim().min(1).max(max);

export const TEMPLATE_SCHEMAS = {
  'auth.invitation': z.object({
    tenantName: shortText(120),
    inviterName: shortText(120).optional(),
    inviteeName: shortText(120).optional(),
    acceptUrl: httpUrl,
    expiresAt: shortText(60).optional(),
  }),
  'auth.password-reset': z.object({
    userName: shortText(120).optional(),
    resetUrl: httpUrl,
    expiresInMinutes: z.number().int().positive().max(10_080).default(60),
  }),
  'auth.mfa-enabled': z.object({
    userName: shortText(120).optional(),
    method: z.enum(['totp', 'passkey']).default('totp'),
    occurredAt: shortText(60).optional(),
    securityUrl: httpUrl.optional(),
  }),
  // M2-NOT-01: one generic template for every notification (and the daily digest); the texts come from
  // src/notifications/templates.ts, so the mail module knows nothing of the notification types.
  'notification.message': z.object({
    title: shortText(300),
    body: z.string().trim().max(2000).optional(),
    items: z.array(shortText(300)).max(50).optional(),
    moreText: shortText(300).optional(),
    url: httpUrl.optional(),
    ctaLabel: shortText(60).optional(),
  }),
  'auth.new-login': z.object({
    userName: shortText(120).optional(),
    occurredAt: shortText(60),
    ip: shortText(64).optional(),
    userAgent: shortText(300).optional(),
    location: shortText(120).optional(),
    securityUrl: httpUrl.optional(),
  }),
} as const;

export type TemplateId = keyof typeof TEMPLATE_SCHEMAS;
export const TEMPLATE_IDS = Object.keys(TEMPLATE_SCHEMAS) as TemplateId[];
export type TemplateData<T extends TemplateId> = z.input<(typeof TEMPLATE_SCHEMAS)[T]>;

export class UnknownTemplateError extends Error {
  constructor(readonly template: string) {
    super(`unknown mail template "${template}" (known: ${TEMPLATE_IDS.join(', ')})`);
    this.name = 'UnknownTemplateError';
  }
}

export class TemplateDataError extends Error {
  constructor(
    readonly template: string,
    readonly issues: string[],
  ) {
    super(`invalid data for mail template ${template}: ${issues.join('; ')}`);
    this.name = 'TemplateDataError';
  }
}

export function isTemplateId(id: string): id is TemplateId {
  return Object.hasOwn(TEMPLATE_SCHEMAS, id);
}

/** Validates and normalises template data (defaults applied). Throws {@link TemplateDataError}. */
export function parseTemplateData(template: string, data: unknown): Record<string, unknown> {
  if (!isTemplateId(template)) throw new UnknownTemplateError(template);
  const result = TEMPLATE_SCHEMAS[template].safeParse(data);
  if (!result.success) {
    throw new TemplateDataError(
      template,
      result.error.issues.map((i) => `${i.path.join('.') || '(data)'}: ${i.message}`),
    );
  }
  return result.data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------- layout

type Block =
  | { type: 'p'; text: string }
  | { type: 'note'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'button'; label: string; url: string };

interface Layout {
  subject: string;
  preheader: string;
  blocks: Block[];
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  locale: string;
}

const greeting = (t: Translator, name: string | undefined): Block => ({
  type: 'p',
  text: name ? t('common.greeting.named', { name }) : t('common.greeting'),
});

function layoutFor(template: TemplateId, data: Record<string, unknown>, t: Translator): Layout {
  const product = PRODUCT_NAME;
  const d = data as Record<string, string | number | undefined>;
  switch (template) {
    case 'auth.invitation': {
      const vars = { tenantName: d.tenantName, inviterName: d.inviterName, product };
      return {
        subject: t('auth.invitation.subject', vars),
        preheader: t('auth.invitation.preheader', vars),
        blocks: [
          greeting(t, d.inviteeName as string | undefined),
          {
            type: 'p',
            text: t(
              d.inviterName ? 'auth.invitation.intro' : 'auth.invitation.intro.anonymous',
              vars,
            ),
          },
          { type: 'button', label: t('auth.invitation.cta'), url: String(d.acceptUrl) },
          ...(d.expiresAt
            ? [
                {
                  type: 'note',
                  text: t('auth.invitation.expires', { expiresAt: d.expiresAt }),
                } as Block,
              ]
            : []),
          { type: 'note', text: t('common.ignore') },
        ],
      };
    }
    case 'auth.password-reset':
      return {
        subject: t('auth.password-reset.subject', { product }),
        preheader: t('auth.password-reset.preheader'),
        blocks: [
          greeting(t, d.userName as string | undefined),
          { type: 'p', text: t('auth.password-reset.intro', { product }) },
          { type: 'button', label: t('auth.password-reset.cta'), url: String(d.resetUrl) },
          {
            type: 'note',
            text: t('auth.password-reset.expires', { expiresInMinutes: d.expiresInMinutes }),
          },
          { type: 'note', text: t('auth.password-reset.ignore') },
        ],
      };
    case 'auth.mfa-enabled': {
      const method = t(`auth.mfa-enabled.method.${String(d.method ?? 'totp')}`);
      return {
        subject: t('auth.mfa-enabled.subject', { product }),
        preheader: t('auth.mfa-enabled.preheader'),
        blocks: [
          greeting(t, d.userName as string | undefined),
          {
            type: 'p',
            text: t('auth.mfa-enabled.intro', {
              product,
              method,
              when: d.occurredAt ? ` (${String(d.occurredAt)})` : '',
            }),
          },
          { type: 'p', text: t('auth.mfa-enabled.warning') },
          ...(d.securityUrl
            ? [
                {
                  type: 'button',
                  label: t('auth.mfa-enabled.cta'),
                  url: String(d.securityUrl),
                } as Block,
              ]
            : []),
        ],
      };
    }
    case 'notification.message': {
      const items = (d.items as unknown as string[] | undefined) ?? [];
      return {
        subject: String(d.title),
        preheader: String(d.body ?? d.title).slice(0, 120),
        blocks: [
          { type: 'p', text: String(d.title) },
          ...(d.body ? [{ type: 'p', text: String(d.body) } as Block] : []),
          ...(items.length ? [{ type: 'list', items } as Block] : []),
          ...(d.moreText ? [{ type: 'note', text: String(d.moreText) } as Block] : []),
          ...(d.url
            ? [
                {
                  type: 'button',
                  label: String(d.ctaLabel ?? t('notification.message.cta', { product })),
                  url: String(d.url),
                } as Block,
              ]
            : []),
        ],
      };
    }
    case 'auth.new-login': {
      const details = [
        t('auth.new-login.detail.time', { occurredAt: d.occurredAt }),
        ...(d.ip ? [t('auth.new-login.detail.ip', { ip: d.ip })] : []),
        ...(d.userAgent ? [t('auth.new-login.detail.device', { userAgent: d.userAgent })] : []),
        ...(d.location ? [t('auth.new-login.detail.location', { location: d.location })] : []),
      ];
      return {
        subject: t('auth.new-login.subject', { product }),
        preheader: t('auth.new-login.preheader'),
        blocks: [
          greeting(t, d.userName as string | undefined),
          { type: 'p', text: t('auth.new-login.intro', { product }) },
          { type: 'list', items: details },
          { type: 'p', text: t('auth.new-login.warning') },
          ...(d.securityUrl
            ? [
                {
                  type: 'button',
                  label: t('auth.new-login.cta'),
                  url: String(d.securityUrl),
                } as Block,
              ]
            : []),
        ],
      };
    }
  }
}

/** Renders `template` for `locale` (unknown locales fall back to English). Data must be parsed already. */
export function renderTemplate(
  template: string,
  locale: string | undefined,
  data: Record<string, unknown>,
): RenderedEmail {
  if (!isTemplateId(template)) throw new UnknownTemplateError(template);
  const resolved = resolveLocale(locale);
  const t = translator(resolved);
  const layout = layoutFor(template, data, t);
  const footer = t('common.footer', { product: PRODUCT_NAME });
  return {
    subject: layout.subject,
    text: toText(layout, t, footer),
    html: toHtml(layout, t, footer, resolved),
    locale: resolved,
  };
}

function toText(layout: Layout, t: Translator, footer: string): string {
  const parts: string[] = [];
  for (const block of layout.blocks) {
    switch (block.type) {
      case 'p':
      case 'note':
        parts.push(block.text);
        break;
      case 'list':
        parts.push(block.items.map((i) => `- ${i}`).join('\n'));
        break;
      case 'button':
        parts.push(`${block.label}:\n${block.url}`);
        break;
    }
  }
  void t;
  return `${parts.join('\n\n')}\n\n--\n${footer}\n`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toHtml(layout: Layout, t: Translator, footer: string, locale: string): string {
  const e = escapeHtml;
  const body = layout.blocks
    .map((block) => {
      switch (block.type) {
        case 'p':
          return `<p style="margin:0 0 16px;line-height:1.5">${e(block.text)}</p>`;
        case 'note':
          return `<p style="margin:0 0 12px;line-height:1.5;color:#555;font-size:13px">${e(block.text)}</p>`;
        case 'list':
          return `<ul style="margin:0 0 16px;padding-left:20px;line-height:1.6">${block.items
            .map((i) => `<li>${e(i)}</li>`)
            .join('')}</ul>`;
        case 'button':
          return (
            `<p style="margin:24px 0"><a href="${e(block.url)}" style="background:#1f4fd8;color:#ffffff;` +
            `text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">` +
            `${e(block.label)}</a></p>` +
            `<p style="margin:0 0 16px;font-size:12px;color:#555;word-break:break-all">` +
            `${e(t('common.button.fallback'))}<br>${e(block.url)}</p>`
          );
      }
    })
    .join('\n');
  return (
    `<!doctype html>\n<html lang="${e(locale)}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${e(layout.subject)}</title></head>` +
    `<body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">` +
    `<span style="display:none;max-height:0;overflow:hidden">${e(layout.preheader)}</span>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px">` +
    `<tr><td>\n${body}\n<hr style="border:none;border-top:1px solid #e3e5e8;margin:24px 0 12px">` +
    `<p style="margin:0;font-size:12px;color:#777">${e(footer)}</p></td></tr></table></td></tr></table>` +
    `</body></html>\n`
  );
}
