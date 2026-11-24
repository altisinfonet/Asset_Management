import {
  Boxes,
  ClipboardCheck,
  LayoutDashboard,
  MapPin,
  Package,
  Printer,
  Repeat,
  Settings,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n';
import { routes } from '@/lib/routes';

export interface NavItem {
  id: string;
  labelKey: TranslationKey;
  href: string;
  icon: LucideIcon;
  /** True when `pathname` (without trailing slash) belongs to this item. */
  isActive: (pathname: string) => boolean;
  /**
   * Whether the module exists in the running milestone. Unavailable items are not rendered
   * (hide navigation to modules that are not there), but the full wireframe order is kept here.
   */
  available: boolean;
  /**
   * Permission(s) needed to see the item (any one of them). Role-aware navigation hides what the
   * signed-in user cannot open; the API still enforces every request.
   */
  permission?: string | readonly string[];
}

/** Settings is useful to anyone who can manage the catalogue or see users. */
export const SETTINGS_PERMISSIONS = ['catalog:manage', 'user:read'] as const;

const exact = (path: string) => (pathname: string) => pathname === path;
const prefix = (path: string) => (pathname: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

/** Sidebar order follows docs/design/wireframes.md WEB-04 (the dashboard is the landing page). */
export const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    labelKey: 'nav.dashboard',
    href: routes.dashboard,
    icon: LayoutDashboard,
    isActive: exact(''),
    available: true,
  },
  {
    id: 'assets',
    labelKey: 'nav.assets',
    href: routes.assets,
    icon: Package,
    isActive: prefix('/assets'),
    available: true,
    permission: 'asset:read',
  },
  {
    id: 'locations',
    labelKey: 'nav.locations',
    href: routes.locations(),
    icon: MapPin,
    isActive: prefix('/locations'),
    available: true,
    permission: 'location:read',
  },
  {
    id: 'people',
    labelKey: 'nav.people',
    href: routes.people,
    icon: Users,
    isActive: prefix('/people'),
    available: true,
    permission: 'person:read',
  },
  {
    id: 'stock',
    labelKey: 'nav.stock',
    href: routes.stock(),
    icon: Boxes,
    isActive: prefix('/stock'),
    available: true,
    permission: ['accessory:read', 'consumable:read'],
  },
  {
    id: 'loaner',
    labelKey: 'nav.loanerPool',
    href: routes.loaners,
    icon: Repeat,
    isActive: prefix('/loaners'),
    available: true,
    permission: 'loaner:read',
  },
  {
    id: 'repairs',
    labelKey: 'nav.repairs',
    href: routes.repairs(),
    icon: Wrench,
    isActive: prefix('/repairs'),
    available: true,
    permission: 'repair:read',
  },
  {
    id: 'stocktake',
    labelKey: 'nav.stocktake',
    href: '/stocktake',
    icon: ClipboardCheck,
    isActive: prefix('/stocktake'),
    available: false,
  },
  {
    id: 'labels',
    labelKey: 'nav.labels',
    href: '/labels',
    icon: Printer,
    isActive: prefix('/labels'),
    available: false,
  },
  // Import is not a sidebar item: it is an occasional admin task (onboarding, a new batch), so it lives
  // where its data does: the "Import" button of the Assets page, an "Imports" link in the Settings
  // navigation (history, resume) and the command palette. See `routes.imports`.
  {
    id: 'settings',
    labelKey: 'nav.settings',
    href: routes.settings(),
    icon: Settings,
    isActive: prefix('/settings'),
    available: true,
    permission: SETTINGS_PERMISSIONS,
  },
];

/** Strip a trailing slash (`trailingSlash: true` makes `/assets/` the canonical pathname). */
export function normalizePathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : '';
}
