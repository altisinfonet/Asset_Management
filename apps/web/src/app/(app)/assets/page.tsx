'use client';

import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { AssetsTable } from './assets-table';

export default function AssetsPage() {
  const t = useT();
  return (
    <>
      <PageTitle title={t('assets.title')} />
      <PageHeader
        title={t('assets.title')}
        description={t('assets.description')}
        actions={
          <>
            <Button disabled>{t('assets.import')}</Button>
            <Button variant="primary" disabled>
              {t('assets.newAsset')}
            </Button>
          </>
        }
      />
      <Banner tone="info" className="mb-4">
        {t('assets.placeholderBanner')}
      </Banner>
      <AssetsTable />
    </>
  );
}
