'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { normalizePathname } from '@/components/app-shell/nav-config';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/routes';

/** Overview, desk and pools: the three screens of the loaner area (the desk needs `loaner:checkout`). */
export function LoanersNav() {
  const t = useT();
  const { can } = useAuth();
  const pathname = normalizePathname(usePathname());
  const items = [
    { id: 'overview', href: routes.loaners, active: pathname === '/loaners', show: true },
    {
      id: 'desk',
      href: routes.loanerDesk(),
      active: pathname === '/loaners/desk',
      show: can('loaner:checkout'),
    },
    {
      id: 'pools',
      href: routes.loanerPools,
      active: pathname === '/loaners/pools' || pathname === '/loaners/pool',
      show: true,
    },
  ] as const;
  return (
    <nav aria-label={t('loaners.sectionsLabel')} className="mb-4 flex gap-1 overflow-x-auto">
      {items
        .filter((item) => item.show)
        .map((item) => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={item.active ? 'page' : undefined}
            className={cn(
              'flex min-h-(--size-control) items-center rounded-md px-3 text-base whitespace-nowrap hover:bg-sunken',
              item.active &&
                'bg-primary-subtle font-medium text-primary-text hover:bg-primary-subtle',
            )}
          >
            {t(`loaners.sections.${item.id}`)}
          </Link>
        ))}
    </nav>
  );
}
