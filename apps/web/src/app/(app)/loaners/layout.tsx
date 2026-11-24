import type { ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/access-denied';
import { LoanersNav } from '@/components/loaners/loaners-nav';

/** The loaner screens need `loaner:read`; other roles see the 403 screen (WEB-24). */
export default function LoanersLayout({ children }: { children: ReactNode }) {
  return (
    <RequirePermission permission="loaner:read">
      <LoanersNav />
      {children}
    </RequirePermission>
  );
}
