/**
 * CSRF token memory. Cookie sessions are `HttpOnly`, so the browser attaches the cookie itself;
 * mutations also send `X-CSRF-Token` (the value returned by login and `GET /v1/auth/me`). The
 * typed client reads it through `getCsrfToken` (see `lib/api.ts`).
 */
let csrfToken: string | undefined;

/** Remember the CSRF token returned by login / `me`; cleared on sign-out. */
export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

export function getCsrfToken(): string | undefined {
  return csrfToken;
}
