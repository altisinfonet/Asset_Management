'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { LabelDialog, type LabelsRequest } from './label-dialog';

interface LabelsContextValue {
  /** Open the print-labels dialog for some assets, or for everything a list filter shows. */
  open: (request: LabelsRequest) => void;
}

const LabelsContext = createContext<LabelsContextValue | null>(null);

/**
 * Hosts the single print-labels dialog of the app shell, so the asset list (selection or current
 * filter) and the asset page start it through `useLabels().open(...)`.
 */
export function LabelsProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<LabelsRequest | null>(null);
  const open = useCallback((next: LabelsRequest) => setRequest(next), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <LabelsContext.Provider value={value}>
      {children}
      <LabelDialog request={request} onClose={() => setRequest(null)} />
    </LabelsContext.Provider>
  );
}

export function useLabels(): LabelsContextValue {
  const context = useContext(LabelsContext);
  if (!context) throw new Error('useLabels must be used inside <LabelsProvider>');
  return context;
}

export function useHasLabels(): boolean {
  return useContext(LabelsContext) !== null;
}
