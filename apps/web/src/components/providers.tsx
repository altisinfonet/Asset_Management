'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { I18nProvider } from '@/i18n';
import { AuthProvider, useAuth } from '@/lib/auth/auth-context';
import { createQueryClient } from '@/lib/query-client';
import { ThemeProvider } from '@/lib/theme';
import { MockBoundary } from '@/components/mock-boundary';
import { ToastProvider } from '@/components/ui/toast';

/**
 * Client providers for the whole app: theme, i18n (English only for now), toasts, the optional
 * mock API (dev and e2e builds only), the auth state (`/v1/auth/me` bootstrap) and the query cache
 * for registry data.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <ThemeProvider>
      <I18nProvider locale="en">
        <ToastProvider>
          <MockBoundary>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <ForgetDataOnSignOut queryClient={queryClient} />
                {children}
              </AuthProvider>
            </QueryClientProvider>
          </MockBoundary>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

/** Cached registry data belongs to a session: drop it when the user signs out or is signed out. */
function ForgetDataOnSignOut({
  queryClient,
}: {
  queryClient: ReturnType<typeof createQueryClient>;
}) {
  const { state } = useAuth();
  const anonymous = state.status === 'anonymous';
  useEffect(() => {
    if (anonymous) queryClient.clear();
  }, [anonymous, queryClient]);
  return null;
}
