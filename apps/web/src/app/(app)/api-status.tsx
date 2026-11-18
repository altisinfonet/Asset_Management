'use client';

import { getHealth, type HealthResponse } from '@assettracker/api-client';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; health: HealthResponse }
  | { kind: 'error'; error: UiError };

/** Live API health (`/v1/health`, same origin). Shows a skeleton, then status; never blocks the page. */
export function ApiStatus() {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const api = getApi();
    getHealth(api.http)
      .then((health) => !cancelled && setState({ kind: 'ready', health }))
      .catch(
        (err: unknown) => !cancelled && setState({ kind: 'error', error: api.toUiError(err) }),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      aria-live="polite"
      aria-busy={state.kind === 'loading'}
      aria-labelledby="api-status-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="api-status-heading" className="mb-2 text-sm font-semibold text-muted">
        {t('dashboard.apiStatus')}
      </h2>
      {state.kind === 'loading' ? (
        <>
          <Skeleton className="h-5 w-48" />
          <span className="sr-only">{t('api.checking')}</span>
        </>
      ) : null}
      {state.kind === 'error' ? (
        <p role="alert" className="text-danger-text">
          {t('api.unreachable', { message: t(state.error.messageKey) })}
        </p>
      ) : null}
      {state.kind === 'ready' ? (
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={state.health.status === 'ok' ? 'success' : 'warning'}>
            {state.health.status === 'ok' ? t('api.statusOk') : t('api.statusDegraded')}
          </Badge>
          <span className="text-base text-muted">
            {t('api.database', { status: state.health.checks.db.status })}
            {state.health.checks.db.latencyMs !== undefined
              ? ` (${t('api.latency', { ms: state.health.checks.db.latencyMs })})`
              : ''}
          </span>
        </p>
      ) : null}
    </section>
  );
}
