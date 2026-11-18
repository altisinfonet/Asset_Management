'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/i18n';

/**
 * Starts the mock API (MSW service worker) before anything renders, so the `/v1/auth/me`
 * bootstrap already goes through it. Active only when the build sets `NEXT_PUBLIC_API_MOCKS=1`
 * (`pnpm dev:mock`, `pnpm build:mock`); in the production build the flag is `undefined`, the
 * branch below is dead code and the bundler never includes `@/mocks/*` or `msw`.
 */
export function MockBoundary({ children }: { children: ReactNode }) {
  const t = useT();
  const [ready, setReady] = useState(process.env.NEXT_PUBLIC_API_MOCKS !== '1');

  useEffect(() => {
    let cancelled = false;
    if (process.env.NEXT_PUBLIC_API_MOCKS === '1') {
      import('@/mocks/browser')
        .then((mod) => mod.startMockWorker())
        .catch((err: unknown) => console.error('mock API failed to start', err))
        .finally(() => {
          if (!cancelled) setReady(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <p role="status" className="p-6 text-base text-muted">
        {t('dev.startingMocks')}
      </p>
    );
  }
  return <>{children}</>;
}
