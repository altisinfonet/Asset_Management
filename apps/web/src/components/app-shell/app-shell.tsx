'use client';

import { ChevronRight, LogOut, Menu, ScanLine, Search, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/routes';
import { useTheme } from '@/lib/theme';
import { Button, IconButton } from '@/components/ui/button';
import {
  CommandPalette,
  useCommandPaletteHotkey,
  type CommandPaletteGroup,
} from '@/components/ui/command-palette';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { NAV_ITEMS, normalizePathname, type NavItem } from './nav-config';
import { Brand, SidebarCollapseButton, SidebarNav } from './sidebar';
import { ThemeToggle } from './theme-toggle';

const SIDEBAR_KEY = 'at-sidebar';

interface AppShellProps {
  children: ReactNode;
  /** Defaults to the full navigation; modules that do not exist yet are filtered out. */
  navItems?: NavItem[];
}

/**
 * Application frame (design system W1/W2, wireframes WEB-04): skip link, sidebar (232px,
 * collapsible to a 56px rail, off-canvas below `lg`), top bar (breadcrumbs, scan field, command
 * palette, theme, user menu) and the content area (max 1440px). Landmarks: header, nav, main.
 */
export function AppShell({ children, navItems = NAV_ITEMS }: AppShellProps) {
  const t = useT();
  const router = useRouter();
  const pathname = normalizePathname(usePathname());
  const { setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage
      setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed');
    } catch {
      /* storage unavailable */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, current ? 'expanded' : 'collapsed');
      } catch {
        /* storage unavailable */
      }
      return !current;
    });
  };

  const togglePalette = useCallback(() => setPaletteOpen((open) => !open), []);
  useCommandPaletteHotkey(togglePalette);

  // `/` focuses the scan field unless the user is already typing somewhere.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const el = event.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
        return;
      event.preventDefault();
      scanRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const groups = useMemo<CommandPaletteGroup[]>(
    () => [
      {
        id: 'go-to',
        heading: t('palette.goTo'),
        items: navItems
          .filter((item) => item.available)
          .map((item) => ({
            id: `go-${item.id}`,
            label: t(item.labelKey),
            icon: item.icon,
            onSelect: () => router.push(item.href),
          })),
      },
      {
        id: 'actions',
        heading: t('palette.actions'),
        items: [
          {
            id: 'theme-light',
            label: `${t('palette.toggleTheme')}: ${t('theme.light')}`,
            onSelect: () => setTheme('light'),
          },
          {
            id: 'theme-dark',
            label: `${t('palette.toggleTheme')}: ${t('theme.dark')}`,
            onSelect: () => setTheme('dark'),
          },
          {
            id: 'theme-system',
            label: `${t('palette.toggleTheme')}: ${t('theme.system')}`,
            onSelect: () => setTheme('system'),
          },
        ],
      },
    ],
    [navItems, router, setTheme, t],
  );

  const onScanSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get('scan');
    if (typeof code === 'string' && code.trim()) {
      router.push(routes.assetByCode(code.trim()));
      event.currentTarget.reset();
    }
  };

  return (
    <div
      className="min-h-screen lg:grid lg:grid-cols-[var(--sidebar-w)_minmax(0,1fr)]"
      style={
        {
          '--sidebar-w': collapsed ? 'var(--size-sidebar-collapsed)' : 'var(--size-sidebar)',
        } as React.CSSProperties
      }
    >
      <a
        href="#main"
        className="sr-only z-(--z-toast) rounded-md bg-primary px-3 py-2 text-primary-on focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('common.skipToContent')}
      </a>

      <aside className="sticky top-0 hidden h-screen flex-col border-r border-border bg-surface lg:flex">
        <Brand collapsed={collapsed} />
        <div className="flex-1 overflow-y-auto py-2">
          <SidebarNav collapsed={collapsed} items={navItems} />
        </div>
        <div
          className={cn(
            'flex border-t border-border p-2',
            collapsed ? 'justify-center' : 'justify-end',
          )}
        >
          <SidebarCollapseButton collapsed={collapsed} onToggle={toggleCollapsed} />
        </div>
      </aside>

      <Drawer open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DrawerContent side="left" className="w-(--size-sidebar)">
          <DrawerTitle className="sr-only">{t('nav.primary')}</DrawerTitle>
          <DrawerDescription className="sr-only">{t('nav.openNavigation')}</DrawerDescription>
          <Brand />
          <div className="flex-1 overflow-y-auto py-2">
            <SidebarNav items={navItems} onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </DrawerContent>
      </Drawer>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-(--z-sticky) flex min-h-14 items-center gap-2 border-b border-border bg-surface px-4 lg:px-6">
          <IconButton
            icon={Menu}
            label={t('nav.openNavigation')}
            className="lg:hidden"
            onClick={() => setMobileNavOpen(true)}
          />
          <Breadcrumbs pathname={pathname} />
          <div className="flex-1" />

          <form onSubmit={onScanSubmit} role="search" className="hidden w-64 sm:block">
            <label className="relative flex items-center">
              <span className="sr-only">{t('topbar.scanLabel')}</span>
              <ScanLine
                aria-hidden
                className="pointer-events-none absolute left-2.5 size-4 text-muted"
              />
              <input
                ref={scanRef}
                name="scan"
                autoComplete="off"
                placeholder={t('topbar.scanPlaceholder')}
                className="min-h-(--size-control) w-full rounded-md border border-border-strong bg-surface pr-8 pl-8 text-base"
              />
              <Kbd aria-hidden className="pointer-events-none absolute right-2">
                /
              </Kbd>
            </label>
          </form>

          <Button variant="secondary" onClick={togglePalette}>
            <Search aria-hidden className="size-4" />
            <span className="sr-only md:not-sr-only">{t('topbar.palette')}</span>
            <Kbd aria-hidden className="hidden md:inline-flex">
              {t('topbar.paletteShortcut')}
            </Kbd>
          </Button>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton icon={User} label={t('topbar.userMenu')} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{t('topbar.userMenu')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push(routes.login)}>
                <LogOut aria-hidden className="size-4" />
                {t('topbar.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none lg:px-6">
          <div className="mx-auto w-full max-w-(--size-content-max)">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={groups} />
    </div>
  );
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  const t = useT();
  const trail = breadcrumbTrail(pathname, t);
  return (
    <nav aria-label={t('nav.breadcrumbs')} className="min-w-0">
      <ol className="flex items-center gap-1 text-base">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={crumb.label} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
              ) : null}
              {crumb.href && !last ? (
                <Link href={crumb.href} className="truncate rounded-sm text-muted hover:text-text">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="truncate font-medium">
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumbs derive from the route table; detail pages append their own name later. */
export function breadcrumbTrail(pathname: string, t: ReturnType<typeof useT>): Crumb[] {
  if (pathname === '') return [{ label: t('nav.dashboard') }];
  if (pathname === '/assets') return [{ label: t('nav.assets') }];
  if (pathname === '/assets/view') {
    return [{ label: t('nav.assets'), href: routes.assets }, { label: t('assetView.title') }];
  }
  if (pathname.startsWith('/settings')) {
    const section = pathname.split('/')[2];
    const sectionKey = (
      {
        organisation: 'settings.sections.organisation',
        users: 'settings.sections.users',
        categories: 'settings.sections.categories',
        models: 'settings.sections.models',
        fields: 'settings.sections.fields',
        status: 'settings.sections.status',
      } as const
    )[section as 'organisation'];
    return [
      { label: t('nav.settings'), href: routes.settings() },
      ...(sectionKey ? [{ label: t(sectionKey) }] : []),
    ];
  }
  return [{ label: t('app.name') }];
}
