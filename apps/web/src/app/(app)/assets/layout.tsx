import type { ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/access-denied';

/** The registry screens need `asset:read`; other roles see the 403 screen (WEB-24). */
export default function AssetsLayout({ children }: { children: ReactNode }) {
  return <RequirePermission permission="asset:read">{children}</RequirePermission>;
}
