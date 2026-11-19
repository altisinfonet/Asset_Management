import { describe, expect, it } from 'vitest';
import { resolveLocale, translator } from './i18n.js';
import {
  TEMPLATE_IDS,
  TemplateDataError,
  UnknownTemplateError,
  parseTemplateData,
  renderTemplate,
} from './templates.js';

const SAMPLE: Record<string, Record<string, unknown>> = {
  'auth.invitation': {
    tenantName: 'Acme <Corp>',
    inviterName: 'Ada',
    inviteeName: 'Bob',
    acceptUrl: 'https://app.example.com/accept?token=T0K3N&x=1',
    expiresAt: '2026-12-01',
  },
  'auth.password-reset': { resetUrl: 'https://app.example.com/reset?token=R3S3T', userName: 'Bob' },
  'auth.mfa-enabled': {
    userName: 'Bob',
    occurredAt: '2026-11-18 10:00 UTC',
    securityUrl: 'https://app.example.com/security',
  },
  'notification.message': {
    title: 'A file you uploaded was blocked',
    body: 'invoice.pdf was removed: Win.Test.EICAR_HDB-1.',
    items: ['Low stock: Toner', 'Overdue: LAP-0001'],
    url: 'https://app.example.com/assets/view?id=1',
  },
  'auth.new-login': {
    userName: 'Bob',
    occurredAt: '2026-11-18 10:00 UTC',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 <script>alert(1)</script>',
    securityUrl: 'https://app.example.com/sessions',
  },
};

describe('mail templates (M1-PLAT-09)', () => {
  it('ships the four auth templates and the generic notification template', () => {
    expect(TEMPLATE_IDS.sort()).toEqual([
      'auth.invitation',
      'auth.mfa-enabled',
      'auth.new-login',
      'auth.password-reset',
      'notification.message',
    ]);
  });

  it.each(Object.keys(SAMPLE))('%s renders subject, plain text and HTML', (template) => {
    const data = parseTemplateData(template, SAMPLE[template]);
    const mail = renderTemplate(template, 'en', data);
    expect(mail.subject.length).toBeGreaterThan(5);
    expect(mail.subject).not.toMatch(/[\r\n{}]/);
    expect(mail.text).toMatch(/Asset Tracker/);
    expect(mail.html).toMatch(/^<!doctype html>/);
    expect(mail.html).toContain('<a href=');
    // the call-to-action link is in BOTH parts
    const link = Object.values(SAMPLE[template]!).find((v) => String(v).startsWith('https://'));
    expect(mail.text).toContain(String(link));
    expect(mail.html).toContain(String(link).replace(/&/g, '&amp;'));
    expect(mail.locale).toBe('en');
  });

  it('escapes interpolated values in HTML but not in the text part', () => {
    const data = parseTemplateData('auth.invitation', SAMPLE['auth.invitation']);
    const mail = renderTemplate('auth.invitation', 'en', data);
    expect(mail.html).toContain('Acme &lt;Corp&gt;');
    expect(mail.html).not.toContain('Acme <Corp>');
    expect(mail.text).toContain('Acme <Corp>');
    const login = renderTemplate(
      'auth.new-login',
      'en',
      parseTemplateData('auth.new-login', SAMPLE['auth.new-login']),
    );
    expect(login.html).not.toContain('<script>');
    expect(login.html).toContain('&lt;script&gt;');
  });

  it('validates data: missing fields, bad urls, javascript: links, unknown templates', () => {
    expect(() => parseTemplateData('auth.invitation', { tenantName: 'x' })).toThrow(
      TemplateDataError,
    );
    expect(() =>
      parseTemplateData('auth.password-reset', { resetUrl: 'javascript:alert(1)' }),
    ).toThrow(TemplateDataError);
    expect(() => parseTemplateData('auth.password-reset', { resetUrl: 'not a url' })).toThrow(
      /resetUrl/,
    );
    expect(() => parseTemplateData('auth.nope', {})).toThrow(UnknownTemplateError);
    expect(() => renderTemplate('auth.nope', 'en', {})).toThrow(UnknownTemplateError);
  });

  it('applies defaults (reset validity, MFA method)', () => {
    expect(
      parseTemplateData('auth.password-reset', { resetUrl: 'https://a.example/r' }),
    ).toMatchObject({
      expiresInMinutes: 60,
    });
    expect(parseTemplateData('auth.mfa-enabled', {})).toMatchObject({ method: 'totp' });
  });
});

describe('i18n mechanism', () => {
  it('falls back from exact tag to language to English', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('en-GB')).toBe('en');
    expect(resolveLocale('de-DE')).toBe('en'); // no German catalogue yet
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale('x; drop table')).toBe('en');
  });

  it('interpolates placeholders and returns the key for a missing message', () => {
    const t = translator('en');
    expect(t('common.greeting.named', { name: 'Ada' })).toBe('Hello Ada,');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('renders an unsupported locale in English instead of failing', () => {
    const mail = renderTemplate('auth.password-reset', 'fr-CA', {
      resetUrl: 'https://a.example/r',
      expiresInMinutes: 30,
    });
    expect(mail.locale).toBe('en');
    expect(mail.text).toContain('30 minutes');
  });
});
