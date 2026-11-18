import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/**
 * Service-worker mock API for `pnpm dev:mock` and the e2e build (`pnpm build:mock`). Imported
 * only through the `NEXT_PUBLIC_API_MOCKS` gate in `components/mock-boundary.tsx`.
 * Unhandled requests pass through (in dev they reach the real API proxy).
 */
let started: Promise<unknown> | undefined;

export function startMockWorker(): Promise<unknown> {
  started ??= setupWorker(...handlers).start({
    onUnhandledRequest: 'bypass',
    quiet: true,
    serviceWorker: { url: '/mockServiceWorker.js' },
  });
  return started;
}
