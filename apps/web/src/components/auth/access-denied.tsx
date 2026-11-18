'use client';

import { Lock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageTitle } from '@/components/page-title';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { routes } from '@/lib/routes';

/**
 * Permission-denied screen (wireframe WEB-24, 403): a lock, one sentence on what to do, a way
 * out and the request id when the API sent one. It does not hint whether the resource exists.
 */
export function AccessDenied({ requestId }: { requestId?: string }) {
  const t = useT();
  return (
    <>
      <PageTitle title={t('access.deniedTitle')} />
      <EmptyState
        headingLevel="h1"
        icon={Lock}
        title={<span data-testid="access-denied">{t('access.deniedTitle')}</span>}
        description={t('access.deniedDescription')}
        actions={
          <>
            <Button asChild variant="primary">
              <Link href={routes.dashboard}>{t('access.goHome')}</Link>
            </Button>
            {requestId ? (
              <p className="w-full font-tag text-xs text-muted">
                {t('access.requestId', { id: requestId })}
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}

/** Renders `children` only when the signed-in user holds one of `permission`; else the 403 screen. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: string | readonly string[];
  children: ReactNode;
}) {
  const auth = useAuth();
  // Until /me has answered we do not know the permissions; RequireAuth shows the loading state.
  if (auth.state.status !== 'authenticated') return null;
  return auth.can(permission) ? <>{children}</> : <AccessDenied />;
}
