import { CircleAlert, CircleCheck, CircleX, Info, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type BannerTone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<BannerTone, { icon: LucideIcon; classes: string; role: 'status' | 'alert' }> = {
  info: { icon: Info, classes: 'bg-info-subtle text-info-text border-info', role: 'status' },
  success: {
    icon: CircleCheck,
    classes: 'bg-success-subtle text-success-text border-success',
    role: 'status',
  },
  warning: {
    icon: CircleAlert,
    classes: 'bg-warning-subtle text-warning-text border-warning',
    role: 'status',
  },
  danger: {
    icon: CircleX,
    classes: 'bg-danger-subtle text-danger-text border-danger',
    role: 'alert',
  },
};

export interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Page-level callout (design system W20): icon, optional title, text and an optional action. */
export function Banner({ tone = 'info', title, children, action, className }: BannerProps) {
  const { icon: Icon, classes, role } = TONES[tone];
  return (
    <div
      role={role}
      className={cn('flex items-start gap-3 rounded-lg border p-3 text-base', classes, className)}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
