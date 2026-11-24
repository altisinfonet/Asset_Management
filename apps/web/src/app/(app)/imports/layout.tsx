import type { ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/access-denied';

/** The import screens need `import:read`; other roles see the 403 screen (WEB-24). */
export default function ImportsLayout({ children }: { children: ReactNode }) {
  return <RequirePermission permission="import:read">{children}</RequirePermission>;
}
