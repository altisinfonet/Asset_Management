'use client';

import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { ApiStatus } from './api-status';

/** Dashboard placeholder (WEB-03): tiles are skeletons until the registry provides counts. */
export default function DashboardPage() {
  const t = useT();
  const tiles = [
    t('dashboard.ready'),
    t('dashboard.assigned'),
    t('dashboard.inRepair'),
    t('dashboard.overdue'),
  ];
  return (
    <>
      <PageTitle title={t('dashboard.title')} />
      <PageHeader title={t('dashboard.title')} description={t('dashboard.description')} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((label) => (
          <div
            key={label}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
          >
            <Skeleton className="h-8 w-16" />
            <span className="text-sm text-muted">{label}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-base text-muted">{t('dashboard.placeholder')}</p>
      <div className="mt-4 max-w-xl">
        <ApiStatus />
      </div>
    </>
  );
}
