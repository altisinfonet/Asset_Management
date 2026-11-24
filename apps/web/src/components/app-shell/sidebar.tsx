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

/** Logo slot: 24px mark and wordmark, monochrome so it works in both themes. */
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
    <div className="flex min-h-14 items-center gap-2 px-3">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-on"
      >
        <Package className="size-4" />
      </span>
      {collapsed ? (
        <span className="sr-only">
          {t('app.name')}
          {tenantName ? ` ${tenantName}` : ''}
        </span>
      ) : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-lg font-semibold">{t('app.name')}</span>
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
    <nav aria-label={t('nav.primary')} className="flex flex-col gap-0.5 px-2">
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
                'relative flex min-h-(--size-control) items-center gap-3 rounded-md px-2.5 text-base text-text hover:bg-sunken',
                collapsed && 'justify-center px-0',
                active && 'bg-primary-subtle font-medium text-primary-text hover:bg-primary-subtle',
              )}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute top-1.5 bottom-1.5 -left-2 w-[3px] rounded-full bg-primary"
                />
              ) : null}
              <item.icon aria-hidden className="size-5 shrink-0" />
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
