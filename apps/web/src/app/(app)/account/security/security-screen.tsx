'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AccessDenied } from '@/components/auth/access-denied';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { toUiError, type UiError } from '@/lib/api';
import { authApi } from '@/lib/auth/auth-api';
import { useAuth } from '@/lib/auth/auth-context';
import type { SessionInfo } from '@/lib/auth/types';
import { routes } from '@/lib/routes';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; sessions: SessionInfo[] }
  | { kind: 'error'; error: UiError };

/**
 * Account security: whether two-step verification is on (with a way to set it up) and the list
 * of signed-in devices with a revoke button each (M1-WEB-03). Revoked sessions fail on their
 * next request (M1-AUTH-03). The current device is signed out with "Sign out", not revoked here.
 */
export function SecurityScreen() {
  const { t, formatDateTime } = useI18n();
  const { toast } = useToast();
  const auth = useAuth();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    authApi
      .listSessions(controller.signal)
      .then((sessions) => setLoad({ kind: 'ready', sessions }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', error: toUiError(err) });
      });
    return () => controller.abort();
  }, []);

  const revoke = useCallback(
    async (session: SessionInfo) => {
      setRevoking(session.id);
      try {
        await authApi.revokeSession(session.id);
        setLoad((current) =>
          current.kind === 'ready'
            ? { kind: 'ready', sessions: current.sessions.filter((s) => s.id !== session.id) }
            : current,
        );
        toast({ variant: 'success', title: t('security.revoked') });
      } catch (err) {
        const ui = toUiError(err);
        toast({ variant: 'danger', title: t(ui.messageKey), requestId: ui.requestId });
      } finally {
        setRevoking(null);
      }
    },
    [t, toast],
  );

  const mfaEnabled = auth.me?.user.mfa_enabled === true;

  return (
    <>
      <PageTitle title={t('security.title')} />
      <PageHeader title={t('security.title')} description={t('security.description')} />

      <div className="flex max-w-3xl flex-col gap-6">
        <section
          aria-labelledby="security-mfa"
          className="rounded-lg border border-border bg-surface p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="security-mfa" className="flex items-center gap-2 text-lg font-semibold">
                {t('security.mfaHeading')}
                <Badge tone={mfaEnabled ? 'success' : 'neutral'}>
                  {mfaEnabled ? t('security.mfaOn') : t('security.mfaOff')}
                </Badge>
              </h2>
              <p className="mt-1 text-base text-muted">
                {mfaEnabled ? t('security.mfaOnDescription') : t('security.mfaOffDescription')}
              </p>
            </div>
            {mfaEnabled ? null : (
              <Button asChild variant="primary">
                <Link href={routes.mfaEnrol(routes.security)}>{t('security.setUp')}</Link>
              </Button>
            )}
          </div>
        </section>

        <section
          aria-labelledby="security-sessions"
          aria-busy={load.kind === 'loading'}
          className="rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="security-sessions" className="text-lg font-semibold">
            {t('security.sessionsHeading')}
          </h2>
          <p className="mt-1 mb-3 text-base text-muted">{t('security.sessionsDescription')}</p>

          {load.kind === 'loading' ? (
            <div role="status" className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <span className="sr-only">{t('security.loading')}</span>
            </div>
          ) : null}

          {load.kind === 'error' && load.error.kind === 'forbidden' ? (
            <AccessDenied requestId={load.error.requestId} />
          ) : null}
          {load.kind === 'error' && load.error.kind !== 'forbidden' ? (
            <Banner tone="danger" title={t('security.loadFailed')}>
              {t(load.error.messageKey)}
            </Banner>
          ) : null}

          {load.kind === 'ready' ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-left text-base">
                <caption className="sr-only">{t('security.sessionsLabel')}</caption>
                <thead>
                  <tr className="border-b border-border text-sm text-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('security.device')}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('security.ip')}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('security.lastActive')}
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      <span className="sr-only">{t('common.moreActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {load.sessions.map((session) => (
                    <tr key={session.id} className="border-b border-border last:border-b-0">
                      <th scope="row" className="py-2 pr-4 font-normal">
                        <span className="mr-2">{session.user_agent}</span>
                        {session.current ? (
                          <Badge tone="primary">{t('security.current')}</Badge>
                        ) : null}
                      </th>
                      <td className="py-2 pr-4 font-tag text-sm">{session.ip}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {formatDateTime(session.last_seen_at)}
                      </td>
                      <td className="py-2 text-right">
                        {session.current ? null : (
                          <Button
                            size="sm"
                            loading={revoking === session.id}
                            aria-label={t('security.revokeLabel', {
                              device: session.user_agent ?? session.ip ?? '',
                            })}
                            onClick={() => void revoke(session)}
                          >
                            {t('security.revoke')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
