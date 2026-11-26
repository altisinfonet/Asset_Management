'use client';

import {
  ChevronRight,
  Bell,
  History,
  Keyboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Repeat,
  ScanLine,
  Search,
  ShieldCheck,
  Upload,
  User,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth/auth-context';
import { hasAnyPermission } from '@/lib/auth/permissions';
import { isAssetCode, pushRecent, readRecent, type RecentEntry } from '@/lib/recent-items';
import { search } from '@/lib/registry/api';
import { useDebounced } from '@/lib/use-debounced';
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
import { NotificationBell } from '@/components/notifications/notification-bell';
import { useScan } from '@/components/scan/scan-provider';
import { NAV_ITEMS, normalizePathname, type NavItem } from './nav-config';
import { ScopeIndicator } from './scope-indicator';
import { ShortcutsDialog } from './shortcuts-dialog';
import { WorkflowProviders } from './workflow-providers';
import { Brand, SidebarCollapseButton, SidebarNav } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import { useShortcuts, type GoToTarget } from './use-shortcuts';

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
export function AppShell(props: AppShellProps) {
  return (
    <WorkflowProviders>
      <AppShellFrame {...props} />
    </WorkflowProviders>
  );
}

function AppShellFrame({ children, navItems = NAV_ITEMS }: AppShellProps) {
  const t = useT();
  const scan = useScan();
  const router = useRouter();
  const pathname = normalizePathname(usePathname());
  const { setTheme } = useTheme();
  const auth = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);
  // the scan provider sends focus back here after a scan opens an asset
  const setScanField = scan.setScanField;
  useEffect(() => {
    setScanField(scanRef.current);
    return () => setScanField(null);
  }, [setScanField]);
  const canCreateAsset = auth.can('asset:create');
  const canImport = auth.can('import:run');
  const canLoanerDesk = auth.can('loaner:checkout');
  // Live search (GET /v1/search) while the palette is open, debounced so typing does not flood it.
  const liveQuery = useDebounced(paletteSearch.trim(), 250);
  const live = useQuery({
    queryKey: ['palette-search', liveQuery],
    queryFn: ({ signal }) => search(liveQuery, signal),
    enabled: paletteOpen && liveQuery.length >= 2 && auth.can('search:read'),
    staleTime: 10_000,
    retry: false,
  });

  // Role-aware navigation: hide what the signed-in user has no permission for.
  const permissions = auth.me?.permissions;
  const visibleItems = useMemo(
    () =>
      navItems.filter(
        (item) =>
          !item.permission || (permissions && hasAnyPermission(permissions, item.permission)),
      ),
    [navItems, permissions],
  );

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

  const setPalette = useCallback((open: boolean) => {
    setPaletteOpen(open);
    if (open) setRecent(readRecent());
    else setPaletteSearch('');
  }, []);
  const togglePalette = useCallback(() => setPalette(!paletteOpen), [paletteOpen, setPalette]);
  useCommandPaletteHotkey(togglePalette);

  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const goTo = useCallback(
    (target: GoToTarget) => {
      const href =
        target === 'dashboard'
          ? routes.dashboard
          : target === 'assets'
            ? routes.assets
            : routes.settings();
      // Only navigate to screens this user can see in the menu.
      if (visibleItems.some((candidate) => candidate.available && candidate.href === href)) {
        router.push(href);
      }
    },
    [router, visibleItems],
  );
  const newAsset = useCallback(() => router.push(routes.assetNew), [router]);
  useShortcuts({
    onHelp: openShortcuts,
    onGoTo: goTo,
    onNewAsset: canCreateAsset ? newAsset : undefined,
  });

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

  const openAssetByCode = useCallback(
    (code: string) => {
      pushRecent({ type: 'asset', code });
      router.push(routes.assetByCode(code));
    },
    [router],
  );

  const onSignOut = useCallback(async () => {
    await auth.signOut();
    router.replace(routes.loginWith({ reason: 'signed_out' }));
  }, [auth, router]);

  const groups = useMemo<CommandPaletteGroup[]>(() => {
    const available = visibleItems.filter((item) => item.available);
    const goToItems = available.map((item) => ({
      id: `go-${item.id}`,
      label: t(item.labelKey),
      icon: item.icon,
      onSelect: () => {
        pushRecent({ type: 'page', id: item.id });
        router.push(item.href);
      },
    }));

    const list: CommandPaletteGroup[] = [];
    const code = paletteSearch.trim();
    if (!code) {
      const recentItems = recent.flatMap((entry) => {
        if (entry.type === 'asset') {
          return [
            {
              id: `recent-asset-${entry.code}`,
              label: t('palette.openAsset', { code: entry.code }),
              icon: History,
              onSelect: () => openAssetByCode(entry.code),
            },
          ];
        }
        const item = available.find((candidate) => candidate.id === entry.id);
        return item
          ? [
              {
                id: `recent-page-${item.id}`,
                label: t(item.labelKey),
                icon: History,
                onSelect: () => {
                  pushRecent({ type: 'page', id: item.id });
                  router.push(item.href);
                },
              },
            ]
          : [];
      });
      if (recentItems.length > 0) {
        list.push({ id: 'recent', heading: t('palette.recent'), items: recentItems });
      }
    }

    list.push(
      { id: 'go-to', heading: t('palette.goTo'), items: goToItems },
      {
        id: 'actions',
        heading: t('palette.actions'),
        items: [
          ...(canCreateAsset
            ? [
                {
                  id: 'new-asset',
                  label: t('palette.newAsset'),
                  icon: Plus,
                  shortcut: 'C',
                  keywords: ['create', 'add'],
                  onSelect: () => router.push(routes.assetNew),
                },
              ]
            : []),
          ...(canImport
            ? [
                {
                  id: 'import-data',
                  label: t('palette.importData'),
                  icon: Upload,
                  keywords: ['import', 'csv', 'spreadsheet', 'upload', 'google admin'],
                  onSelect: () => router.push(routes.importNew()),
                },
              ]
            : []),
          ...(canLoanerDesk
            ? [
                {
                  id: 'loaner-desk',
                  label: t('palette.loanerDesk'),
                  icon: Repeat,
                  keywords: ['loan', 'loaner', 'borrow', 'return', 'lend'],
                  onSelect: () => router.push(routes.loanerDesk()),
                },
              ]
            : []),
          {
            id: 'batch-scan',
            label: t('palette.batchScan'),
            icon: ScanLine,
            keywords: ['scan', 'barcode', 'check in', 'check out'],
            onSelect: scan.openPanel,
          },
          {
            id: 'security',
            label: t('palette.security'),
            icon: ShieldCheck,
            onSelect: () => router.push(routes.security),
          },
          {
            id: 'notification-settings',
            label: t('palette.notificationSettings'),
            icon: Bell,
            keywords: ['notifications', 'alerts', 'email'],
            onSelect: () => router.push(routes.notificationSettings),
          },
          {
            id: 'shortcuts',
            label: t('palette.shortcuts'),
            icon: Keyboard,
            shortcut: '?',
            onSelect: openShortcuts,
          },
          {
            id: 'sign-out',
            label: t('palette.signOut'),
            icon: LogOut,
            onSelect: () => void onSignOut(),
          },
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
    );
    // Live results from the API: assets first, then models and categories (always shown: the server
    // already matched them, the palette must not re-filter on a different field).
    const results = live.data ?? [];
    for (const [type, heading] of [
      ['asset', t('palette.assets')],
      ['model', t('palette.models')],
      ['category', t('palette.categories')],
    ] as const) {
      const items = results
        .filter((r) => r.type === type && liveQuery === code)
        .map((r) => ({
          id: `live-${r.type}-${r.id}`,
          label: r.sublabel ? `${r.label} (${r.sublabel})` : r.label,
          icon: type === 'asset' ? Package : undefined,
          alwaysShow: true,
          onSelect: () => {
            if (type === 'asset') {
              const tag = r.label.split(' ')[0] ?? '';
              if (isAssetCode(tag)) pushRecent({ type: 'asset', code: tag });
              router.push(routes.assetView(r.id));
            } else
              router.push(
                type === 'model' ? routes.settings('models') : routes.settings('categories'),
              );
          },
        }));
      if (items.length > 0) list.push({ id: `live-${type}`, heading, items });
    }
    // Tag quick-jump: whatever tag-like text is typed can be opened directly. It comes last so
    // Enter prefers a real match (typing "settings" must not open an asset called settings).
    if (code && isAssetCode(code)) {
      list.push({
        id: 'asset-jump',
        heading: t('palette.assets'),
        items: [
          {
            id: 'open-asset',
            label: t('palette.openAsset', { code }),
            icon: Package,
            alwaysShow: true,
            onSelect: () => openAssetByCode(code),
          },
        ],
      });
    }
    return list;
  }, [
    visibleItems,
    paletteSearch,
    recent,
    router,
    setTheme,
    t,
    openAssetByCode,
    openShortcuts,
    onSignOut,
    live.data,
    liveQuery,
    canCreateAsset,
    canImport,
    canLoanerDesk,
    scan.openPanel,
  ]);

  const onScanSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get('scan');
    if (typeof code === 'string' && code.trim()) {
      // cleared at once (not after the lookup), so the next scan typed right away starts empty
      if (scanRef.current) scanRef.current.value = '';
      else event.currentTarget.reset();
      void scan.scan(code, 'field');
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

      <aside className="sidebar-scope sticky top-0 hidden h-screen flex-col lg:flex">
        <Brand collapsed={collapsed} tenantName={auth.me?.tenant.name} />
        <div className="flex-1 overflow-y-auto py-3">
          <SidebarNav collapsed={collapsed} items={visibleItems} />
        </div>
        <div
          className={cn(
            'flex flex-col gap-2 border-t border-border p-3',
            collapsed ? 'items-center px-2' : 'items-end',
          )}
        >
          <SidebarCollapseButton collapsed={collapsed} onToggle={toggleCollapsed} />
        </div>
      </aside>

      <Drawer open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DrawerContent side="left" className="sidebar-scope w-(--size-sidebar)">
          <DrawerTitle className="sr-only">{t('nav.primary')}</DrawerTitle>
          <DrawerDescription className="sr-only">{t('nav.openNavigation')}</DrawerDescription>
          <Brand tenantName={auth.me?.tenant.name} />
          <div className="flex-1 overflow-y-auto py-2">
            <SidebarNav items={visibleItems} onNavigate={() => setMobileNavOpen(false)} />
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
          {/* M2-LOC-03: why a location-scoped user sees only part of the organisation */}
          <ScopeIndicator className="max-w-[40vw] md:max-w-xs xl:max-w-md" />

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

          <IconButton
            icon={ScanLine}
            label={t('scan.openPanel')}
            onClick={scan.openPanel}
            variant="secondary"
          />

          <Button variant="secondary" onClick={togglePalette}>
            <Search aria-hidden className="size-4" />
            <span className="sr-only md:not-sr-only">{t('topbar.palette')}</span>
            <Kbd aria-hidden className="hidden md:inline-flex">
              {t('topbar.paletteShortcut')}
            </Kbd>
          </Button>

          <NotificationBell />
          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton icon={User} label={t('topbar.userMenu')} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel className="flex flex-col font-normal">
                <span className="font-medium text-text">
                  {auth.me?.user.display_name ?? t('topbar.userMenu')}
                </span>
                {auth.me ? <span className="text-xs text-muted">{auth.me.user.email}</span> : null}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={routes.security}>
                  <ShieldCheck aria-hidden className="size-4" />
                  {t('topbar.security')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={routes.notificationSettings}>
                  <Bell aria-hidden className="size-4" />
                  {t('topbar.notificationSettings')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openShortcuts}>
                <Keyboard aria-hidden className="size-4" />
                <span className="flex-1">{t('topbar.shortcuts')}</span>
                <Kbd aria-hidden>{'?'}</Kbd>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void onSignOut()}>
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

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPalette}
        groups={groups}
        search={paletteSearch}
        onSearchChange={setPaletteSearch}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
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
  if (pathname === '/assets/new' || pathname === '/assets/edit') {
    return [
      { label: t('nav.assets'), href: routes.assets },
      { label: t(pathname === '/assets/new' ? 'assetForm.newTitle' : 'assetForm.editTitle') },
    ];
  }
  if (pathname === '/locations') return [{ label: t('nav.locations') }];
  if (pathname === '/stock') return [{ label: t('nav.stock') }];
  if (pathname === '/stock/view') {
    return [{ label: t('nav.stock'), href: routes.stock() }, { label: t('stockView.title') }];
  }
  if (pathname === '/repairs') return [{ label: t('nav.repairs') }];
  if (pathname === '/account/notifications') {
    return [{ label: t('nav.account') }, { label: t('notifications.settings.title') }];
  }
  if (pathname === '/people') return [{ label: t('nav.people') }];
  if (pathname === '/people/view') {
    return [{ label: t('nav.people'), href: routes.people }, { label: t('personView.title') }];
  }
  if (pathname === '/account/security') {
    return [{ label: t('nav.account') }, { label: t('security.title') }];
  }
  if (pathname.startsWith('/settings')) {
    const section = pathname.split('/')[2];
    const sectionKey = (
      {
        organisation: 'settings.sections.organisation',
        users: 'settings.sections.users',
        categories: 'settings.sections.categories',
        models: 'settings.sections.models',
        manufacturers: 'settings.sections.manufacturers',
        fields: 'settings.sections.fields',
        status: 'settings.sections.status',
        tags: 'settings.sections.tags',
        vendors: 'settings.sections.vendors',
      } as const
    )[section as 'organisation'];
    return [
      { label: t('nav.settings'), href: routes.settings() },
      ...(sectionKey ? [{ label: t(sectionKey) }] : []),
    ];
  }
  return [{ label: t('app.name') }];
}
