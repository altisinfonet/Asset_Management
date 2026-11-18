import { ApiError } from './errors.js';
import type { components } from './generated/schema.js';
import type { TypedClient } from './typed.js';

export type HealthResponse = components['schemas']['HealthResponse'];
export type VersionResponse = components['schemas']['VersionResponse'];

/**
 * `GET /v1/health`. A degraded API answers `503` with a valid health body, which is a normal
 * answer here (the caller shows it), not an error; any other failure throws `ApiError`.
 */
export async function getHealth(client: TypedClient): Promise<HealthResponse> {
  try {
    const { data } = await client.GET('/v1/health');
    return data as HealthResponse;
  } catch (err) {
    const body = err instanceof ApiError && err.status === 503 ? err.body : undefined;
    if (
      typeof body === 'object' &&
      body !== null &&
      (body as { status?: unknown }).status === 'degraded'
    ) {
      return body as HealthResponse;
    }
    throw err;
  }
}

/** `GET /v1/version`. */
export async function getVersion(client: TypedClient): Promise<VersionResponse> {
  const { data } = await client.GET('/v1/version');
  return data as VersionResponse;
}
