import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';

/** Everything except /login and the not-found screen renders inside the application frame. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
