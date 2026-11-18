import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@assettracker/api-client';

/**
 * Query cache defaults. A 4xx answer is a definite answer (forbidden, not found, validation), so
 * it is never retried; network and 5xx failures retry once. Data is fresh for 15 seconds.
 */
export function createQueryClient(options: { retry?: boolean } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry:
          options.retry === false
            ? false
            : (count, error) => count < 1 && !(error instanceof ApiError && error.status < 500),
      },
    },
  });
}
