'use client';

import { Plus, Upload } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { routes } from '@/lib/routes';
import { AssetsTable } from './assets-table';

export default function AssetsPage() {
  const t = useT();
  const { can } = useAuth();
  return (
    <>
      <PageTitle title={t('assets.title')} />
      <PageHeader
        title={t('assets.title')}
        description={t('assets.description')}
        actions={
          <>
            {can('import:run') ? (
              <Button asChild>
                <Link href={routes.importNew('asset')}>
                  <Upload aria-hidden className="size-4" />
                  {t('assets.import')}
                </Link>
              </Button>
            ) : null}
            {can('asset:create') ? (
              <Button asChild variant="primary">
                <Link href={routes.assetNew}>
                  <Plus aria-hidden className="size-4" />
                  {t('assets.newAsset')}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {/* `useSearchParams` (deep-linked filters) needs a Suspense boundary in a static export. */}
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <AssetsTable />
      </Suspense>
    </>
  );
}
