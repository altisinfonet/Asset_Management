import type { ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/access-denied';

/** Starting an import needs `import:run` on top of `import:read`. */
export default function NewImportLayout({ children }: { children: ReactNode }) {
  return <RequirePermission permission="import:run">{children}</RequirePermission>;
}
