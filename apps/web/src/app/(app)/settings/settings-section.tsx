'use client';

import { Wrench } from 'lucide-react';
import { Suspense } from 'react';
import { PageTitle } from '@/components/page-title';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import type { SettingsSection } from '@/lib/routes';
import { CategoriesScreen } from './categories-screen';
import {
  ManufacturersScreen,
  ModelsScreen,
  StatusLabelsScreen,
  TagNumberingScreen,
  VendorsScreen,
} from './catalog-screens';
import { DepartmentsScreen } from './departments-screen';
import { FieldsScreen } from './fields-screen';
import { NotificationRulesScreen } from './notification-rules-screen';
import { UsersScreen } from './users-screen';

/** The body of a settings page. Each section has its own screen; the organisation page is a placeholder. */
export function SettingsSectionScreen({ section }: { section: SettingsSection }) {
  const t = useT();
  const name = t(`settings.sections.${section}`);
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      {section === 'categories' ? (
        <CategoriesScreen />
      ) : section === 'fields' ? (
        <FieldsScreen />
      ) : section === 'models' ? (
        <ModelsScreen />
      ) : section === 'manufacturers' ? (
        <ManufacturersScreen />
      ) : section === 'status' ? (
        <StatusLabelsScreen />
      ) : section === 'tags' ? (
        <TagNumberingScreen />
      ) : section === 'vendors' ? (
        <VendorsScreen />
      ) : section === 'users' ? (
        <UsersScreen />
      ) : section === 'departments' ? (
        <DepartmentsScreen />
      ) : section === 'notifications' ? (
        <NotificationRulesScreen />
      ) : (
        <>
          <PageTitle title={name} />
          <p data-testid="settings-section" className="sr-only">
            {section}
          </p>
          <EmptyState
            headingLevel="h2"
            icon={Wrench}
            title={t('settings.placeholderTitle', { section: name })}
            description={t('settings.placeholderDescription')}
          />
        </>
      )}
    </Suspense>
  );
}
