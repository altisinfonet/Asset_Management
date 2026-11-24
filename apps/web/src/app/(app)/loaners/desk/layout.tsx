import type { ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/access-denied';

/** The desk lends and returns devices: it needs `loaner:checkout` on top of `loaner:read`. */
export default function LoanerDeskLayout({ children }: { children: ReactNode }) {
  return <RequirePermission permission="loaner:checkout">{children}</RequirePermission>;
}
