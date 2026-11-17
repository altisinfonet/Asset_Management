'use client';

import { PackageSearch } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/i18n';
import { routes } from '@/lib/routes';

/**
 * Asset detail placeholder (WEB-05). The route is `/assets/view?id=<uuid>` (ADR-0002); a scanned
 * code arrives as `?code=` (QR links `/s/<code>` redirect here). Loading and saving arrive with
 * the registry stories.
 */
export function AssetView() {
  const t = useT();
  const params = useSearchParams();
  const id = params.get('id');
  const code = params.get('code');

  if (!id && !code) {
    return (
      <>
        <PageTitle title={t('assetView.title')} />
        <EmptyState
          headingLevel="h1"
          icon={PackageSearch}
          title={<span data-testid="no-asset">{t('assetView.noneSelected')}</span>}
          description={t('assetView.noneSelectedHint')}
          actions={
            <Button asChild variant="primary">
              <Link href={routes.assets}>{t('assetView.backToList')}</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageTitle title={t('assetView.title')} />
      <PageHeader
        title={t('assetView.title')}
        description={
          id ? (
            <>
              {t('assetView.idLabel')}:{' '}
              <span data-testid="asset-id" className="font-tag">
                {id}
              </span>
            </>
          ) : (
            <>
              {t('assetView.codeLabel')}:{' '}
              <span data-testid="asset-code" className="font-tag">
                {code}
              </span>
            </>
          )
        }
      />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('assetView.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="history">{t('assetView.tabs.history')}</TabsTrigger>
          <TabsTrigger value="repairs">{t('assetView.tabs.repairs')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('assetView.tabs.attachments')}</TabsTrigger>
        </TabsList>
        {(['overview', 'history', 'repairs', 'attachments'] as const).map((tab) => (
          <TabsContent key={tab} value={tab}>
            <p className="text-base text-muted">{t('assetView.tabPlaceholder')}</p>
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
