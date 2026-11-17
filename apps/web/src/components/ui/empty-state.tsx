import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  title: ReactNode;
  /** One sentence on why it is empty and what to do. */
  description?: ReactNode;
  icon?: LucideIcon;
  /** Optional 16:9 line-illustration slot (120px tall). Not stock art. */
  illustration?: ReactNode;
  /** Primary action first, then an optional secondary (for example "Import CSV"). */
  actions?: ReactNode;
  /** Heading level for the title; defaults to `h2`. */
  headingLevel?: 'h1' | 'h2' | 'h3';
  className?: string;
}

/**
 * Empty state (design system W14). Variants are just different copy and actions: first use
 * (create/import), no results (clear filters), no permission (lock icon, no hint that data exists).
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  illustration,
  actions,
  headingLevel: Heading = 'h2',
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      {illustration ? <div className="h-[120px] aspect-video">{illustration}</div> : null}
      {Icon ? (
        <span className="flex size-12 items-center justify-center rounded-full bg-sunken text-muted">
          <Icon aria-hidden className="size-6" />
        </span>
      ) : null}
      <Heading className="text-2xl font-semibold text-text">{title}</Heading>
      {description ? <p className="max-w-[72ch] text-base text-muted">{description}</p> : null}
      {actions ? <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
