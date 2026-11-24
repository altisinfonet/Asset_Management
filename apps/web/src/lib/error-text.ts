import type { Translator } from '@/i18n';
import type { UiError } from '@/lib/api';

/** Keys of a `409` problem's `usage` member the API sends today, with a catalogue key each. */
const USAGE_LABELS = {
  assets: 'usage.assets',
  people: 'usage.people',
  models: 'usage.models',
  custom_fields: 'usage.customFields',
  assets_with_values: 'usage.assetsWithValues',
  children: 'usage.children',
  locations: 'usage.locations',
  open_assignments: 'usage.openAssignments',
  assignments: 'usage.openAssignments',
  login_accounts: 'usage.loginAccounts',
} as const;

/** "12 assets, 3 models" for the `usage` of a 409; empty when the problem carried none. */
export function usageSummary(t: Translator['t'], usage: UiError['usage']): string {
  if (!usage) return '';
  return Object.entries(usage)
    .filter(([, count]) => count > 0)
    .map(([what, count]) =>
      what in USAGE_LABELS
        ? t(USAGE_LABELS[what as keyof typeof USAGE_LABELS], { count })
        : `${what}: ${count}`,
    )
    .join(', ');
}

/**
 * The sentence to show for a failed call: the counts of what still uses the record when the API
 * sent them (409 `usage`), else the problem's own `detail`, else the catalogue message of the status.
 */
export function uiErrorText(t: Translator['t'], error: UiError): string {
  const used = usageSummary(t, error.usage);
  if (used) return t('error.inUse', { usage: used });
  return error.detail ?? t(error.messageKey);
}
