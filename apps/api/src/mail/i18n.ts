/**
 * Message catalogues for transactional mail (M1-PLAT-09). English only in M1, but the mechanism is
 * the final one: a catalogue per locale, keys looked up with fallback locale -> language -> `en`,
 * `{name}` placeholders. Adding a language is a new catalogue object plus an entry in
 * {@link CATALOGUES}; no template code changes.
 */
export type Catalogue = Record<string, string>;

export const en: Catalogue = {
  'common.greeting': 'Hello,',
  'common.greeting.named': 'Hello {name},',
  'common.ignore': 'If you did not expect this email, you can safely ignore it.',
  'common.footer': 'Sent by {product}. This is an automated message, please do not reply.',
  'common.button.fallback': 'If the button does not work, copy this link into your browser:',

  'auth.invitation.subject': 'You are invited to join {tenantName} on {product}',
  'auth.invitation.preheader': 'Accept your invitation to {tenantName}.',
  'auth.invitation.intro': '{inviterName} has invited you to join {tenantName} on {product}.',
  'auth.invitation.intro.anonymous': 'You have been invited to join {tenantName} on {product}.',
  'auth.invitation.expires': 'This invitation expires on {expiresAt}.',
  'auth.invitation.cta': 'Accept invitation',

  'auth.password-reset.subject': 'Reset your {product} password',
  'auth.password-reset.preheader': 'Use this link to choose a new password.',
  'auth.password-reset.intro':
    'We received a request to reset the password of your {product} account.',
  'auth.password-reset.expires':
    'This link is valid for {expiresInMinutes} minutes and can be used once.',
  'auth.password-reset.cta': 'Choose a new password',
  'auth.password-reset.ignore':
    'If you did not request a reset, no action is needed: your password has not changed.',

  'auth.mfa-enabled.subject': 'Two-factor authentication is now on for your {product} account',
  'auth.mfa-enabled.preheader': 'A second sign-in step was added to your account.',
  'auth.mfa-enabled.intro':
    'Two-factor authentication ({method}) was turned on for your {product} account{when}.',
  'auth.mfa-enabled.warning':
    'If this was not you, sign in and review your security settings right away, or contact your administrator.',
  'auth.mfa-enabled.cta': 'Review security settings',
  'auth.mfa-enabled.method.totp': 'authenticator app',
  'auth.mfa-enabled.method.passkey': 'passkey',

  'notification.message.cta': 'Open {product}',

  'auth.new-login.subject': 'New sign-in to your {product} account',
  'auth.new-login.preheader': 'We noticed a sign-in from a new device or location.',
  'auth.new-login.intro':
    'Your {product} account was just signed in to from a device we have not seen before.',
  'auth.new-login.detail.time': 'Time: {occurredAt}',
  'auth.new-login.detail.ip': 'IP address: {ip}',
  'auth.new-login.detail.device': 'Device: {userAgent}',
  'auth.new-login.detail.location': 'Approximate location: {location}',
  'auth.new-login.warning':
    'If this was you, no action is needed. If not, change your password and review your active sessions.',
  'auth.new-login.cta': 'Review active sessions',
};

/** Locale tag -> catalogue. Keys are lower-case BCP 47 tags (`en`, `en-gb`, `de`...). */
export const CATALOGUES: Record<string, Catalogue> = { en };

export const DEFAULT_LOCALE = 'en';

const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** The catalogue key to use for a requested locale: exact, then primary language, then `en`. */
export function resolveLocale(requested: string | undefined): string {
  if (!requested || !LOCALE.test(requested)) return DEFAULT_LOCALE;
  const tag = requested.toLowerCase();
  if (CATALOGUES[tag]) return tag;
  const language = tag.split('-')[0]!;
  return CATALOGUES[language] ? language : DEFAULT_LOCALE;
}

export type Translator = (
  key: string,
  vars?: Record<string, string | number | undefined>,
) => string;

/** A translator bound to `locale`; a missing key falls back to English, then to the key itself. */
export function translator(locale: string): Translator {
  const catalogue = CATALOGUES[locale] ?? en;
  return (key, vars = {}) => {
    const template = catalogue[key] ?? en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
      const value = vars[name];
      return value === undefined ? '' : String(value);
    });
  };
}
