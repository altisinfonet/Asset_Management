import type { ReactNode } from 'react';
import { SettingsGate } from './settings-gate';
import { SettingsNav } from './settings-nav';

/**
 * Settings shell (wireframes WEB-08..11): sub-navigation on the left, the selected page on the
 * right. The gate shows the 403 screen to roles without the section's permission.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsGate>
      <div className="flex flex-col gap-6 lg:flex-row">
        <SettingsNav />
        <section className="min-w-0 flex-1">{children}</section>
      </div>
    </SettingsGate>
  );
}
