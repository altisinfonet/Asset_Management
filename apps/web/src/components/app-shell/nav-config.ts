import {
  ClipboardCheck,
  LayoutDashboard,
  MapPin,
  Package,
  Printer,
  Repeat,
  Settings,
  Upload,
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
}

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
  },
  {
    id: 'locations',
    labelKey: 'nav.locations',
    href: '/locations',
    icon: MapPin,
    isActive: prefix('/locations'),
    available: false,
  },
  {
    id: 'loaner',
    labelKey: 'nav.loanerPool',
    href: '/loaner',
    icon: Repeat,
    isActive: prefix('/loaner'),
    available: false,
  },
  {
    id: 'repairs',
    labelKey: 'nav.repairs',
    href: '/repairs',
    icon: Wrench,
    isActive: prefix('/repairs'),
    available: false,
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
  {
    id: 'import',
    labelKey: 'nav.import',
    href: '/import',
    icon: Upload,
    isActive: prefix('/import'),
    available: false,
  },
  {
    id: 'settings',
    labelKey: 'nav.settings',
    href: routes.settings(),
    icon: Settings,
    isActive: prefix('/settings'),
    available: true,
  },
];

/** Strip a trailing slash (`trailingSlash: true` makes `/assets/` the canonical pathname). */
export function normalizePathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : '';
}
