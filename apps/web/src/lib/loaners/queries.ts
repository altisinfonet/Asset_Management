import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { loanersApi } from './api';

/** Query keys of the loaner screens; everything starts with `loaners` so one call refreshes them all. */
export const loanKeys = {
  all: ['loaners'] as const,
  pools: ['loaners', 'pools'] as const,
  pool: (id: string) => ['loaners', 'pool', id] as const,
  members: (id: string) => ['loaners', 'members', id] as const,
  overdue: ['loaners', 'overdue'] as const,
  activity: ['loaners', 'activity'] as const,
  settings: ['loaners', 'settings'] as const,
};

/** Every active and switched-off pool (archived ones are left out); a tenant has a handful. */
export function usePools(enabled = true) {
  return useQuery({
    queryKey: loanKeys.pools,
    queryFn: () => loanersApi.pools({ limit: 100 }),
    select: (page) => page.data,
    enabled,
  });
}

/** The organisation's loan defaults (`loaner:read`); undefined while loading or when the caller cannot read them. */
export function useLoanSettings(enabled = true) {
  return useQuery({
    queryKey: loanKeys.settings,
    queryFn: () => loanersApi.settings(),
    staleTime: 60_000,
    retry: false,
    enabled,
  });
}

/**
 * After a loan or a return: the loaner numbers, and the asset lists and pages that show who holds
 * what (the scan provider refreshes the same keys after a batch scan).
 */
export function useRefreshAfterLoan() {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all(
      ['loaners', 'asset', 'assets', 'asset-history', 'person-held', 'people', 'dashboard'].map(
        (key) => client.invalidateQueries({ queryKey: [key] }),
      ),
    );
  }, [client]);
}
