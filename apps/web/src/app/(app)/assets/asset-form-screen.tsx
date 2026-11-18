'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PackageSearch } from 'lucide-react';
import { RequirePermission } from '@/components/auth/access-denied';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { getApi } from '@/lib/api';
import { assetsApi } from '@/lib/registry/api';
import { useLookups } from '@/lib/registry/queries';
import { routes } from '@/lib/routes';
import { AssetForm, type AssetFormMode } from './asset-form';

/**
 * Loads what the form needs (catalogue lookups and, for edit and clone, the source asset) and
 * only then mounts the form, so its state starts from complete data. `/assets/new`,
 * `/assets/new?clone=<id>` and `/assets/edit?id=<id>` are fixed paths (ADR-0002).
 */
export function AssetFormScreen({ kind }: { kind: 'new' | 'edit' }) {
  const t = useT();
  const params = useSearchParams();
  const mode: AssetFormMode = kind === 'edit' ? 'edit' : params.get('clone') ? 'clone' : 'create';
  const sourceId =
    mode === 'edit' ? params.get('id') : mode === 'clone' ? params.get('clone') : null;
  const lookups = useLookups();
  // `gcTime: 0` + a distinct key: the editor always starts from a fresh read, with its own ETag.
  const source = useQuery({
    queryKey: ['asset-source', mode, sourceId],
    queryFn: () => assetsApi.get(sourceId!),
    enabled: !!sourceId,
    gcTime: 0,
    retry: false,
  });

  const title =
    mode === 'edit'
      ? t('assetForm.editTitle')
      : mode === 'clone'
        ? t('assetForm.cloneTitle')
        : t('assetForm.newTitle');

  let body;
  if (mode === 'edit' && !sourceId) {
    body = <NotFound />;
  } else if (source.error) {
    body =
      getApi().toUiError(source.error).kind === 'not_found' ? (
        <NotFound />
      ) : (
        <Banner
          tone="danger"
          action={<Button onClick={() => void source.refetch()}>{t('common.retry')}</Button>}
        >
          {t('assetView.loadFailed')}
        </Banner>
      );
  } else if (lookups.loading || (sourceId && !source.data)) {
    body = <Skeleton className="h-64 w-full max-w-3xl" />;
  } else {
    body = <AssetForm mode={mode} lookups={lookups} source={source.data} />;
  }

  return (
    <RequirePermission permission={mode === 'edit' ? 'asset:update' : 'asset:create'}>
      <PageTitle title={title} />
      <PageHeader title={title} />
      {body}
    </RequirePermission>
  );
}

function NotFound() {
  const t = useT();
  return (
    <EmptyState
      icon={PackageSearch}
      title={<span data-testid="asset-not-found">{t('assetView.notFoundTitle')}</span>}
      description={t('assetView.notFoundHint')}
      actions={
        <Button asChild variant="primary">
          <Link href={routes.assets}>{t('assetView.backToList')}</Link>
        </Button>
      }
    />
  );
}
