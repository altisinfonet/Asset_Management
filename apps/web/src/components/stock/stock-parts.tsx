'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/cn';
import { categoriesApi, fetchAll } from '@/lib/registry/api';
import type { Category } from '@/lib/registry/types';
import type { StockKind } from '@/lib/stock/api';
import { stockLevel, type StockLevel } from '@/lib/stock/helpers';

const LEVEL_STYLE: Record<StockLevel, { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon }> =
  {
    ok: { tone: 'success', icon: CircleCheck },
    low: { tone: 'warning', icon: TriangleAlert },
    out: { tone: 'danger', icon: CircleX },
  };

/** "In stock" / "Low stock" / "Out of stock": an icon and the words, never colour alone. */
export function StockLevelBadge({ available, minimum }: { available: number; minimum: number }) {
  const { t } = useI18n();
  const level = stockLevel(available, minimum);
  const { tone, icon } = LEVEL_STYLE[level];
  return (
    <Badge tone={tone} icon={icon} data-level={level}>
      {t(`stock.level.${level}`)}
    </Badge>
  );
}

const BAR_TONE: Record<StockLevel, string> = {
  ok: 'bg-success',
  low: 'bg-warning',
  out: 'bg-danger',
};

/**
 * Level bar: how much of the stock is left, with a tick at the minimum. It is a labelled `meter`
 * (the value is also written next to it), and the colour only repeats what the badge says.
 */
export function StockBar({
  value,
  total,
  minimum,
  label,
  className,
}: {
  value: number;
  total: number;
  minimum: number;
  label: string;
  className?: string;
}) {
  const level = stockLevel(value, minimum);
  const max = Math.max(total, value, 1);
  const share = Math.min(100, Math.max(0, (value / max) * 100));
  const tick = minimum > 0 ? Math.min(100, (minimum / max) * 100) : null;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn('relative h-2 w-full min-w-16 overflow-hidden rounded-full bg-sunken', className)}
    >
      <div
        className={cn('h-full rounded-full', BAR_TONE[level])}
        style={{ width: `${level === 'out' ? 0 : Math.max(share, 4)}%` }}
      />
      {tick !== null ? (
        <span
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-text/60"
          style={{ left: `${tick}%` }}
        />
      ) : null}
    </div>
  );
}

/** Categories of one kind (accessory or consumable) for the forms and the filter. */
export function useStockCategories(kind: StockKind) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['lookup', 'categories-of-kind', kind],
    queryFn: () =>
      fetchAll<Category>((cursor) =>
        categoriesApi.list({ limit: 200, cursor, kind, archived: 'exclude', sort: ['name'] }),
      ),
    enabled: can('catalog:read'),
    staleTime: 60_000,
  });
}
