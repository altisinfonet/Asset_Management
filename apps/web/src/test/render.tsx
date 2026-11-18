import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { I18nProvider } from '@/i18n';
import { AuthProvider } from '@/lib/auth/auth-context';
import { setCsrfToken } from '@/lib/auth/http';
import { createQueryClient } from '@/lib/query-client';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { findUser, updateState } from '@/mocks/state';

/** Put a signed-in session into the mock API (what the HttpOnly cookie would be). */
export function seedSession(
  email: string = MOCK_ACCOUNTS.owner,
  options: { limited?: boolean } = {},
) {
  const user = findUser(email);
  if (!user) throw new Error(`unknown mock account ${email}`);
  updateState((state) => {
    state.session = {
      id: 'sess-test',
      email: user.email,
      csrf: 'csrf-test',
      mfaVerified: true,
      limited: options.limited ?? false,
      createdAt: new Date().toISOString(),
    };
  });
  // The page-level CSRF token is module state: a previous test may have left a rotated one behind.
  setCsrfToken('csrf-test');
}

/** Render with the providers the real app has (i18n, toasts, auth bootstrap against the mock API). */
export function renderApp(ui: ReactElement) {
  const queryClient = createQueryClient({ retry: false });
  return render(
    <I18nProvider locale="en">
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{ui}</AuthProvider>
        </QueryClientProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}
