'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { normalizePathname, SETTINGS_PERMISSIONS } from '@/components/app-shell/nav-config';
import { RequirePermission } from '@/components/auth/access-denied';
import { isSettingsSection, type SettingsSection } from '@/lib/routes';

/** Permission each settings page needs; anything not listed falls back to catalogue management. */
const SECTION_PERMISSION: Record<SettingsSection, string | readonly string[]> = {
  organisation: SETTINGS_PERMISSIONS,
  users: 'user:read',
  categories: 'catalog:manage',
  models: 'catalog:manage',
  manufacturers: 'catalog:manage',
  fields: 'catalog:manage',
  status: 'catalog:manage',
  tags: 'catalog:manage',
  vendors: 'catalog:manage',
  // everybody who can read departments sees the page; writing needs department:manage
  departments: 'department:read',
  notifications: 'notification:manage',
};

/** Shows the 403 screen (WEB-24) instead of a settings page the user's role cannot open. */
export function SettingsGate({ children }: { children: ReactNode }) {
  const pathname = normalizePathname(usePathname());
  const section = pathname.split('/')[2] ?? '';
  const permission = isSettingsSection(section)
    ? SECTION_PERMISSION[section]
    : SETTINGS_PERMISSIONS;
  return <RequirePermission permission={permission}>{children}</RequirePermission>;
}
