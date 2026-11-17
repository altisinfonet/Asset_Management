import {
  healthResponseSchema,
  versionResponseSchema,
  type HealthResponse,
  type VersionResponse,
} from '@assettracker/schemas';

export interface ApiClientOptions {
  /** Base URL of the API. Empty string means same-origin (the production default). */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  getHealth(): Promise<HealthResponse>;
  getVersion(): Promise<VersionResponse>;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function get(path: string, acceptStatuses: number[] = []): Promise<unknown> {
    const res = await doFetch(`${baseUrl}${path}`, { headers: { accept: 'application/json' } });
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok && !acceptStatuses.includes(res.status)) {
      throw new ApiError(`GET ${path} failed with ${res.status}`, res.status, body);
    }
    return body;
  }

  return {
    // A degraded API answers 503 with a valid health body; surface it instead of throwing.
    getHealth: async () => healthResponseSchema.parse(await get('/v1/health', [503])),
    getVersion: async () => versionResponseSchema.parse(await get('/v1/version')),
  };
}

export type { HealthResponse, VersionResponse } from '@assettracker/schemas';
