'use client';

import type { ReactNode } from 'react';
import { CustodyProvider, useHasCustody } from '@/components/custody/custody-provider';
import { ScanProvider, useHasScan } from '@/components/scan/scan-provider';

/**
 * The shell-level workflow hosts: the single check-out / check-in dialog and the scan machinery
 * (global wedge listener, scan panel). The app shell mounts them for every screen; they sit inside
 * the toast, query and auth providers. Mounting them twice is harmless (an outer one wins), which
 * lets a screen be rendered alone in tests with the same hosts.
 */
export function WorkflowProviders({ children }: { children: ReactNode }) {
  const hasCustody = useHasCustody();
  const hasScan = useHasScan();
  if (hasCustody && hasScan) return <>{children}</>;
  return (
    <CustodyProvider>
      <ScanProvider>{children}</ScanProvider>
    </CustodyProvider>
  );
}
