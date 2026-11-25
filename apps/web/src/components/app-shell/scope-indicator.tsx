'use client';

import { MapPin } from 'lucide-react';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/cn';

/**
 * "Scoped to: Riverside Elementary / Main building" (M2-LOC-03, ED-26): shown in the top bar for a
 * principal whose role assignments are all limited to locations, so they know why they see only part
 * of the organisation. Nothing for an org-wide principal.
 */
export function ScopeIndicator({ className }: { className?: string }) {
  const t = useT();
  const { locationScope } = useAuth();
  if (!locationScope) return null;
  const paths = locationScope.locations.map((l) => l.path).join(', ');
  const text = paths ? t('locationScope.indicator', { paths }) : t('locationScope.indicatorNone');
  return (
    <p
      data-testid="scope-indicator"
      title={text}
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-sunken px-2 py-1 text-sm text-text',
        className,
      )}
    >
      <MapPin aria-hidden className="size-4 shrink-0 text-muted" />
      <span className="truncate">{text}</span>
    </p>
  );
}
