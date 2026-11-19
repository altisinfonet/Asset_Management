import type { ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/access-denied';

/** The repair log needs `repair:read`; other roles see the 403 screen (WEB-24). */
export default function RepairsLayout({ children }: { children: ReactNode }) {
  return <RequirePermission permission="repair:read">{children}</RequirePermission>;
}
