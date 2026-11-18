'use client';

import type { ReactNode } from 'react';
import { I18nProvider } from '@/i18n';
import { AuthProvider } from '@/lib/auth/auth-context';
import { ThemeProvider } from '@/lib/theme';
import { MockBoundary } from '@/components/mock-boundary';
import { ToastProvider } from '@/components/ui/toast';

/**
 * Client providers for the whole app: theme, i18n (English only for now), toasts, the optional
 * mock API (dev and e2e builds only) and the auth state (`/v1/auth/me` bootstrap).
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider locale="en">
        <ToastProvider>
          <MockBoundary>
            <AuthProvider>{children}</AuthProvider>
          </MockBoundary>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
