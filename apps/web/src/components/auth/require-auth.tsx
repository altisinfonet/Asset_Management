'use client';

import { ServerCrash } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { routes } from '@/lib/routes';

/**
 * Route guard for everything inside the application frame. Nothing renders until `/v1/auth/me`
 * has answered; an anonymous visitor is sent to `/login?next=<where they were going>` (with
 * `reason=expired` when a session ended while the app was open), and a user whose tenant
 * requires MFA is sent to the enrolment screen. Static export has no middleware, so this is a
 * client-side guard: it protects the UI flow, while the API enforces access to the data.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const auth = useAuth();
  const { state } = auth;

  useEffect(() => {
    if (state.status === 'anonymous') {
      if (state.reason === 'signed_out') {
        router.replace(routes.loginWith({ reason: 'signed_out' }));
      } else {
        const next = `${pathname}${window.location.search}`;
        router.replace(routes.loginWith({ next, reason: state.reason }));
      }
    } else if (state.status === 'mfa_enrolment_required') {
      router.replace(routes.mfaEnrol(`${pathname}${window.location.search}`));
    }
  }, [state, pathname, router]);

  if (state.status === 'authenticated') return <>{children}</>;

  if (state.status === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <EmptyState
          headingLevel="h1"
          icon={ServerCrash}
          title={t('session.failedTitle')}
          description={t('session.failedDescription')}
          actions={
            <Button variant="primary" onClick={() => window.location.reload()}>
              {t('common.retry')}
            </Button>
          }
        />
      </main>
    );
  }

  return (
    <div role="status" aria-live="polite" className="flex min-h-screen flex-col gap-4 p-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full max-w-3xl" />
      <span className="sr-only">
        {state.status === 'loading' ? t('session.checking') : t('session.redirecting')}
      </span>
    </div>
  );
}
