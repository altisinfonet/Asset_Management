import type { TranslationKey } from '@/i18n';
import { toUiError } from '@/lib/api';
import { AuthRequestError } from './http';

type T = (key: TranslationKey, values?: Record<string, string | number>) => string;

/** Minimum password length shown in hints and checked client-side (the server is authoritative). */
export const MIN_PASSWORD_LENGTH = 12;

/** "45 seconds" / "2 minutes" for a throttle wait, rounded up to whole minutes from 60 s. */
export function formatWait(seconds: number, t: T): string {
  if (seconds >= 60) return t('wait.minutes', { count: Math.ceil(seconds / 60) });
  return t('wait.seconds', { count: Math.max(1, Math.ceil(seconds)) });
}

export function tooManyAttemptsMessage(err: unknown, t: T): string {
  const wait = err instanceof AuthRequestError ? err.retryAfterSeconds : undefined;
  return wait === undefined
    ? t('login.errors.tooManyAttemptsNoWait')
    : t('login.errors.tooManyAttempts', { wait: formatWait(wait, t) });
}

export interface DescribedError {
  message: string;
  requestId?: string;
}

/**
 * Message for a failed sign-in step. A `401` is always the same sentence, so the screen never
 * reveals whether the account exists, is locked or has MFA; a `429` says how long to wait.
 */
export function describeLoginError(err: unknown, t: T): DescribedError {
  const ui = toUiError(err);
  if (ui.status === 401) return { message: t('login.errors.invalidCredentials') };
  if (ui.status === 429)
    return { message: tooManyAttemptsMessage(err, t), requestId: ui.requestId };
  return { message: t(ui.messageKey), requestId: ui.requestId };
}

/** The server's message for a `/password` field error (breached, too short), if it sent one. */
export function passwordFieldError(err: unknown): string | undefined {
  return toUiError(err).fieldErrors.find((e) => e.pointer === '/password')?.message;
}

export function isStatus(err: unknown, ...statuses: number[]): boolean {
  return err instanceof AuthRequestError && statuses.includes(err.status);
}

export function errorCode(err: unknown): string | undefined {
  return err instanceof AuthRequestError ? err.code : undefined;
}
