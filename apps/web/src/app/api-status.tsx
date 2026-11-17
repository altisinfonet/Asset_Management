'use client';

import { createApiClient, type HealthResponse } from '@assettracker/api-client';
import { useEffect, useState } from 'react';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; health: HealthResponse }
  | { kind: 'error'; message: string };

// Same-origin in production (CloudFront/Caddy route /v1 to the API); the dev server proxies it.
const client = createApiClient();

export function ApiStatus() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    client
      .getHealth()
      .then((health) => !cancelled && setState({ kind: 'ready', health }))
      .catch(
        (err: unknown) =>
          !cancelled &&
          setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-live="polite" className="rounded-lg border border-slate-300/40 p-4">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide opacity-70">API status</h2>
      {state.kind === 'loading' && <p>Checking /v1/health…</p>}
      {state.kind === 'error' && (
        <p role="alert" className="text-red-600">
          API unreachable: {state.message}
        </p>
      )}
      {state.kind === 'ready' && (
        <p>
          <span
            className={
              state.health.status === 'ok'
                ? 'font-semibold text-green-600'
                : 'font-semibold text-amber-600'
            }
          >
            {state.health.status}
          </span>{' '}
          · database {state.health.checks.db.status}
          {state.health.checks.db.latencyMs !== undefined &&
            ` (${state.health.checks.db.latencyMs} ms)`}
        </p>
      )}
    </section>
  );
}
