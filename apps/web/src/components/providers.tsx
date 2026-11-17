'use client';

import type { ReactNode } from 'react';
import { I18nProvider } from '@/i18n';
import { ThemeProvider } from '@/lib/theme';
import { ToastProvider } from '@/components/ui/toast';

/** Client providers for the whole app: theme, i18n (English only for now) and toasts. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider locale="en">
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
