import { routes } from '@/lib/routes';

/** Paths that must never be a post-login destination (they would loop or leak the flow). */
const BLOCKED = /^\/(?:login|forgot-password|reset-password|invitation|mfa)(?:\/|\?|$)/;

/**
 * Sanitise the `?next=` parameter: only same-origin absolute paths are allowed, so a crafted
 * login link cannot bounce the user to another site (open redirect). Anything else becomes `/`.
 * `URLSearchParams.get` has already decoded the value once.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return routes.dashboard;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return routes.dashboard;
  // Control characters (tab, newline) can make browsers read `/<tab>/host` as `//host`.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return routes.dashboard;
  if (BLOCKED.test(raw)) return routes.dashboard;
  return raw;
}
