import type { ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/access-denied';

/** The locations screens need `location:read`; other roles see the 403 screen (WEB-24). */
export default function LocationsLayout({ children }: { children: ReactNode }) {
  return <RequirePermission permission="location:read">{children}</RequirePermission>;
}
