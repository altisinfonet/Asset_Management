'use client';

import { useQuery } from '@tanstack/react-query';
import { filesSettingsApi } from './api';

/**
 * The upload cap that applies to the organisation (`effective_max_upload_bytes` of
 * `GET /v1/settings/files`), or undefined while it loads or when the caller may not read it. The
 * API enforces the cap either way; this only lets the form say it up front and refuse early.
 */
export function useUploadLimit(): number | undefined {
  const settings = useQuery({
    queryKey: ['files-settings'],
    queryFn: () => filesSettingsApi.get(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return settings.data?.effective_max_upload_bytes;
}
