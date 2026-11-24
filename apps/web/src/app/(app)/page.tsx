'use client';

import { Dashboard } from '@/components/dashboard/dashboard';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { useT } from '@/i18n';

/** The landing page (WEB-03): counts of the registry and what needs attention. */
export default function DashboardPage() {
  const t = useT();
  return (
    <>
      <PageTitle title={t('dashboard.title')} />
      <PageHeader title={t('dashboard.title')} description={t('dashboard.description')} />
      <Dashboard />
    </>
  );
}
