'use client';

import { PanelLeftClose, PanelLeftOpen, Package } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { NAV_ITEMS, normalizePathname, type NavItem } from './nav-config';

interface SidebarNavProps {
  /** Icon rail (56px) instead of the full 232px sidebar. */
  collapsed?: boolean;
  /** Called after a link is chosen (closes the mobile sheet). */
  onNavigate?: () => void;
  items?: NavItem[];
}

/** Logo slot: 32px mark and wordmark on the navy sidebar (the same in every theme). */
export function Brand({
  collapsed = false,
  tenantName,
}: {
  collapsed?: boolean;
  /** Organisation of the signed-in user, shown under the wordmark. */
  tenantName?: string;
}) {
  const t = useT();
  return (
    <div
      className={cn('flex min-h-16 items-center gap-3 px-4', collapsed && 'justify-center px-2')}
    >
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-on"
      >
        <Package className="size-[18px]" />
      </span>
      {collapsed ? (
        <span className="sr-only">
          {t('app.name')}
          {tenantName ? ` ${tenantName}` : ''}
        </span>
      ) : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-base font-semibold tracking-wide uppercase">{t('app.name')}</span>
          {tenantName ? (
            <span data-testid="tenant-name" className="truncate text-xs text-muted">
              {tenantName}
            </span>
          ) : null}
        </span>
      )}
    </div>
  );
}

/**
 * A nav label that shortens itself with an ellipsis when the sidebar is too narrow for it gets its
 * full text as a `title` tooltip (a label that fits needs none).
 */
function NavLabel({ label }: { label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    // the observer reports once when it starts watching, then on every size change
    const observer = new ResizeObserver(() =>
      setTruncated(element.scrollWidth > element.clientWidth),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [label]);
  return (
    <span ref={ref} title={truncated ? label : undefined} className="truncate">
      {label}
    </span>
  );
}

/** Primary navigation. The active item gets `aria-current="page"`, a tint and a 3px leading bar. */
export function SidebarNav({ collapsed = false, onNavigate, items = NAV_ITEMS }: SidebarNavProps) {
  const t = useT();
  const pathname = normalizePathname(usePathname());

  return (
    <nav aria-label={t('nav.primary')} className="flex flex-col gap-1 px-3">
      {items
        .filter((item) => item.available)
        .map((item) => {
          const active = item.isActive(pathname);
          const label = t(item.labelKey);
          const link = (
            <Link
              key={item.id}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              aria-label={collapsed ? label : undefined}
              className={cn(
                'relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-base text-muted hover:bg-sunken hover:text-text',
                collapsed && 'justify-center px-0',
                active && 'bg-primary-subtle font-semibold text-text hover:bg-primary-subtle',
              )}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-primary"
                />
              ) : null}
              <item.icon aria-hidden className={cn('size-5 shrink-0', active && 'text-primary')} />
              {collapsed ? null : <NavLabel label={label} />}
            </Link>
          );
          return collapsed ? (
            <Tooltip key={item.id} content={label} side="right">
              {link}
            </Tooltip>
          ) : (
            link
          );
        })}
    </nav>
  );
}

export function SidebarCollapseButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <IconButton
      icon={collapsed ? PanelLeftOpen : PanelLeftClose}
      label={collapsed ? t('nav.expand') : t('nav.collapse')}
      onClick={onToggle}
      aria-expanded={!collapsed}
    />
  );
}
