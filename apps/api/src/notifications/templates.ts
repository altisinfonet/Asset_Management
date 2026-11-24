import type { NotificationType } from './types.js';

/**
 * Notification texts (M2-NOT-01): the in-app title and body of every type, from a message catalogue
 * per locale (English only for now; a language is one more catalogue in {@link CATALOGUES}, no code
 * change). The same title and body are the subject and the body of the email (mail template
 * `notification.message`), so the bell and the inbox never disagree. `{name}` placeholders are filled
 * from the variables a subscription describes (`subscriptions.ts`); a missing variable renders empty.
 *
 * Keys: `notification.<type>.title` and `notification.<type>.body`.
 */
export type Catalogue = Record<string, string>;

export const en: Catalogue = {
  'notification.attachment.infected.title': 'A file you uploaded was blocked',
  'notification.attachment.infected.body':
    '"{filename}" was removed because the virus scan found {signature}. Nothing was attached to your record.',

  'notification.asset.checked_out.title': '{asset} was checked out to you',
  'notification.asset.checked_out.body': '{asset} is now assigned to you. {due}',

  'notification.export.completed.title': 'Your export is ready',
  'notification.export.completed.body':
    '{filename} ({rows} rows) is ready to download. The file is removed after 24 hours.',

  'notification.consumable.low_stock.title': 'Low stock: {name}',
  'notification.consumable.low_stock.body': '{name} is at or below its reorder level. {detail}',

  'notification.accessory.low_stock.title': 'Low stock: {name}',
  'notification.accessory.low_stock.body': '{name} is at or below its minimum. {detail}',

  'notification.label.batch.failed.title': 'Your labels could not be rendered',
  'notification.label.batch.failed.body':
    'The batch of labels failed ({reason}). Nothing was printed; start the batch again.',

  'notification.label.batch.ready.title': 'Your labels are ready',
  'notification.label.batch.ready.body':
    'Your batch of {count} label(s) is ready to print. The file is removed after it expires.',

  'notification.loan.overdue.title': 'Overdue: {asset}',
  'notification.loan.overdue.body':
    '{asset} was due back on {due_date} and is {days_overdue} day(s) overdue. Borrower: {borrower}. {escalation}',

  'notification.loan.due_soon.title': 'Due back soon: {asset}',
  'notification.loan.due_soon.body': '{asset} is due back on {due_date}.',

  'notification.import.completed.title': 'Import finished',
  'notification.import.completed.body':
    'The import of {filename} finished: {created} created, {updated} updated, {failed} rows with errors.',

  'notification.digest.title': 'Your daily digest: {count} notification(s)',
  'notification.digest.body': 'Here is what happened since the last digest.',
  'notification.digest.more': '...and {count} more. Open the notification bell to see them all.',
};

export const CATALOGUES: Record<string, Catalogue> = { en };
export const DEFAULT_LOCALE = 'en';

const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function catalogueFor(locale: string | null | undefined): Catalogue {
  if (!locale || !LOCALE.test(locale)) return en;
  const tag = locale.toLowerCase();
  return CATALOGUES[tag] ?? CATALOGUES[tag.split('-')[0]!] ?? en;
}

export type Vars = Readonly<Record<string, string | number | undefined>>;

function fill(template: string, vars: Vars): string {
  return template
    .replace(/\{(\w+)\}/g, (_m, name: string) => {
      const value = vars[name];
      return value === undefined ? '' : String(value);
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export interface RenderedNotification {
  title: string;
  body: string;
}

/** The title and body of `type` for `locale` (unknown locales fall back to English). */
export function renderNotification(
  type: NotificationType | 'digest',
  locale: string | null | undefined,
  vars: Vars,
): RenderedNotification {
  const catalogue = catalogueFor(locale);
  const text = (part: 'title' | 'body') => {
    const key = `notification.${type}.${part}`;
    return fill(catalogue[key] ?? en[key] ?? key, vars);
  };
  return { title: text('title').slice(0, 300), body: text('body').slice(0, 2000) };
}

/** A line of the digest footer ("...and 12 more"). */
export function renderMore(locale: string | null | undefined, count: number): string {
  const catalogue = catalogueFor(locale);
  return fill(catalogue['notification.digest.more'] ?? en['notification.digest.more']!, { count });
}
