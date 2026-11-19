import type { ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/access-denied';

/** The people screens need `person:read`; other roles see the 403 screen (WEB-24). */
export default function PeopleLayout({ children }: { children: ReactNode }) {
  return <RequirePermission permission="person:read">{children}</RequirePermission>;
}
