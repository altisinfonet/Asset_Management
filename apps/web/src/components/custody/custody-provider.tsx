'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CustodyDialog, type CustodyRequest } from './custody-dialog';

interface CustodyContextValue {
  /** Open the check-out / check-in / transfer dialog for one asset, or a bulk action for several. */
  open: (request: CustodyRequest) => void;
}

const CustodyContext = createContext<CustodyContextValue | null>(null);

/**
 * Hosts the single custody dialog of the app shell, so any screen (asset page, list selection,
 * person page, a scan from anywhere) starts a check-out through `useCustody().open(...)`.
 */
export function CustodyProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<CustodyRequest | null>(null);
  const open = useCallback((next: CustodyRequest) => setRequest(next), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <CustodyContext.Provider value={value}>
      {children}
      <CustodyDialog request={request} onClose={() => setRequest(null)} />
    </CustodyContext.Provider>
  );
}

export function useCustody(): CustodyContextValue {
  const context = useContext(CustodyContext);
  if (!context) throw new Error('useCustody must be used inside <CustodyProvider>');
  return context;
}

export function useHasCustody(): boolean {
  return useContext(CustodyContext) !== null;
}
