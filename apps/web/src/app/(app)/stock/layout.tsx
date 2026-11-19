import type { ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/access-denied';

/** The stock screens need `accessory:read` or `consumable:read`; other roles see the 403 screen (WEB-24). */
export default function StockLayout({ children }: { children: ReactNode }) {
  return (
    <RequirePermission permission={['accessory:read', 'consumable:read']}>
      {children}
    </RequirePermission>
  );
}
