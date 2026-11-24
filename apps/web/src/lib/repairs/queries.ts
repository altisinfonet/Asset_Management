'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/auth-context';
import { repairsApi } from './api';

/**
 * Whether an asset has a repair that is still open (`open` or `in_progress`), from its repair summary
 * (the same query, and so the same cache entry, as the totals on the asset's Repairs tab). `known`
 * is false until the answer is in and for roles without `repair:read`: nobody can say "no repair is
 * logged" without being able to look.
 */
export function useAssetHasOpenRepair(assetId: string | undefined): {
  known: boolean;
  hasOpen: boolean;
} {
  const { can } = useAuth();
  const enabled = !!assetId && can('repair:read');
  const summary = useQuery({
    queryKey: ['repairs', 'summary', assetId],
    queryFn: () => repairsApi.summary(assetId!),
    enabled,
  });
  return {
    known: enabled && summary.isSuccess,
    hasOpen: (summary.data?.open_count ?? 0) > 0,
  };
}
