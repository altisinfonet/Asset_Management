'use client';

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
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
import { OrganisationScreen } from './organisation-screen';
import { UsersScreen } from './users-screen';

/** The body of a settings page: each section has its own screen. */
export function SettingsSectionScreen({ section }: { section: SettingsSection }) {
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
        <OrganisationScreen />
      )}
    </Suspense>
  );
}
