import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';
import { RequireAuth } from '@/components/auth/require-auth';

/**
 * Everything except the auth screens and the not-found screen renders inside the application
 * frame, behind the auth guard (redirects to `/login?next=...` without a session).
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
