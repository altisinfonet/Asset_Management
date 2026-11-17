'use client';

import { FileQuestion } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PageTitle } from '@/components/page-title';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useT } from '@/i18n';
import { parseQrPath, routes } from '@/lib/routes';

/**
 * Not-found screen. It is also the SPA fallback page: unknown paths are served `404.html` (the
 * export of this component) by CloudFront and Caddy (ADR-0002). QR labels encode `/s/<code>`, so
 * this component reads the real URL and forwards a QR path to the asset lookup.
 */
export default function NotFound() {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const code = parseQrPath(pathname);

  useEffect(() => {
    if (code) router.replace(routes.assetByCode(code));
  }, [code, router]);

  if (code) {
    return (
      <p data-testid="resolving" role="status" className="p-6 text-base text-muted">
        {t('notFound.openingCode', { code })}
      </p>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center">
      <PageTitle title={t('notFound.title')} />
      <EmptyState
        headingLevel="h1"
        icon={FileQuestion}
        title={<span data-testid="not-found">{t('notFound.title')}</span>}
        description={t('notFound.description')}
        actions={
          <Button asChild variant="primary">
            <Link href={routes.dashboard}>{t('notFound.home')}</Link>
          </Button>
        }
      />
    </main>
  );
}
