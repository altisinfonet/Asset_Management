'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { normalizePathname } from '@/components/app-shell/nav-config';
import { PageHeader } from '@/components/page-header';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/cn';
import { routes, SETTINGS_SECTIONS } from '@/lib/routes';
import { SECTION_PERMISSION } from './settings-gate';

/** Areas that have their own screens but belong with the organisation's settings. */
const LINKS = [
  {
    id: 'imports',
    href: routes.imports,
    labelKey: 'settings.links.imports',
    permission: 'import:read',
  },
  {
    id: 'loan-defaults',
    href: routes.loanerPools,
    labelKey: 'settings.links.loanerPools',
    permission: 'loaner:read',
  },
] as const;

export function SettingsNav() {
  const t = useT();
  const { can } = useAuth();
  const pathname = normalizePathname(usePathname());
  return (
    <div className="lg:w-56 lg:shrink-0">
      <PageHeader title={t('settings.title')} />
      <nav aria-label={t('settings.subnav')} className="flex gap-1 overflow-x-auto lg:flex-col">
        {/* only the sections the role can open (a location-scoped role holds none of the org-only
            permissions, so Users and roles and Notification rules disappear for it, M2-LOC-03) */}
        {SETTINGS_SECTIONS.filter((section) => can(SECTION_PERMISSION[section])).map((section) => {
          const active = pathname === `/settings/${section}`;
          return (
            <Link
              key={section}
              href={routes.settings(section)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-(--size-control) items-center rounded-md px-2.5 text-base whitespace-nowrap hover:bg-sunken',
                active && 'bg-primary-subtle font-medium text-primary-text hover:bg-primary-subtle',
              )}
            >
              {t(`settings.sections.${section}`)}
            </Link>
          );
        })}
        {LINKS.filter((link) => can(link.permission)).map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.id}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-(--size-control) items-center rounded-md px-2.5 text-base whitespace-nowrap hover:bg-sunken',
                active && 'bg-primary-subtle font-medium text-primary-text hover:bg-primary-subtle',
              )}
            >
              {t(link.labelKey)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
