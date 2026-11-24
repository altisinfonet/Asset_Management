import type { Translator } from '@/i18n';
import { getApi } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import { importProblemOf, type ImportState } from './api';

export interface ImportErrorText {
  /** The sentence to show. */
  message: string;
  requestId?: string;
  /** The problem code (`import-wrong-state`, `import-stale-dry-run`, `import-quota-exceeded` ...). */
  code?: string;
  /** What exactly was refused, one line each (the problem's field errors). */
  details: string[];
}

/**
 * The sentence for a failed import call: the three import problems get their own wording (the state
 * the import is in, "run the dry run again", "try again in N seconds"); everything else is the
 * `fallback` followed by the problem's own message.
 */
export function importErrorText(
  t: Translator['t'],
  err: unknown,
  fallback: string,
): ImportErrorText {
  const ui = getApi().toUiError(err);
  const problem = importProblemOf(err);
  const base = { requestId: ui.requestId, code: ui.code, details: [] as string[] };
  switch (problem?.code) {
    case 'import-wrong-state':
      return {
        ...base,
        message: t('imports.problems.wrongState', {
          state: problem.state ? t(`imports.states.${problem.state as ImportState}`) : '?',
        }),
      };
    case 'import-stale-dry-run':
      return { ...base, message: t('imports.problems.stale') };
    case 'import-quota-exceeded':
      return {
        ...base,
        message:
          problem.retryAfterSeconds !== undefined
            ? t('imports.problems.quota', { count: problem.retryAfterSeconds })
            : t('imports.problems.quotaNoWait'),
      };
    default:
      return {
        ...base,
        message: `${fallback} ${uiErrorText(t, ui)}`,
        details: ui.fieldErrors.map((e) => e.message),
      };
  }
}
