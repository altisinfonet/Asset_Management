'use client';

import { Wrench } from 'lucide-react';
import { PageTitle } from '@/components/page-title';
import { EmptyState } from '@/components/ui/empty-state';
import { useT } from '@/i18n';
import type { SettingsSection } from '@/lib/routes';

/** Placeholder body of a settings page; each section is built by its own story. */
export function SettingsSectionPlaceholder({ section }: { section: SettingsSection }) {
  const t = useT();
  const name = t(`settings.sections.${section}`);
  return (
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
  );
}
