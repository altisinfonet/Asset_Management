'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import {
  Archive,
  CircleCheck,
  CircleHelp,
  ClockAlert,
  Hourglass,
  Repeat,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { Tooltip } from './tooltip';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-sunken text-muted',
        primary: 'bg-primary-subtle text-primary-text',
        success: 'bg-success-subtle text-success-text',
        warning: 'bg-warning-subtle text-warning-text',
        danger: 'bg-danger-subtle text-danger-text',
        info: 'bg-info-subtle text-info-text',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  icon?: LucideIcon;
}

/** Generic pill. Colour is never the only signal: pair it with an icon or text. */
export function Badge({ tone, icon: Icon, className, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" /> : null}
      {children}
    </span>
  );
}

/**
 * State types (data model: `status_label.state_type`) plus the derived `overdue` and `loaned`.
 * Colour and icon are fixed per state type; admins rename the label, never the colour (design
 * system section 4), which keeps the contrast guarantees. `pending` has no row in the design
 * table and uses the info tone with an hourglass.
 */
export type StateType =
  | 'deployable'
  | 'deployed'
  | 'pending'
  | 'undeployable'
  | 'archived'
  | 'lost'
  | 'overdue'
  | 'loaned';

export const STATE_TYPE_STYLE: Record<
  StateType,
  { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon }
> = {
  deployable: { tone: 'success', icon: CircleCheck },
  deployed: { tone: 'primary', icon: User },
  pending: { tone: 'info', icon: Hourglass },
  undeployable: { tone: 'warning', icon: Wrench },
  archived: { tone: 'neutral', icon: Archive },
  lost: { tone: 'danger', icon: CircleHelp },
  overdue: { tone: 'danger', icon: ClockAlert },
  loaned: { tone: 'info', icon: Repeat },
};

export interface StatusBadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  type: StateType;
  /** The admin-chosen label ("Out for fix"); defaults to the catalogue name of the state type. */
  label?: ReactNode;
  /** Dot-only variant for dense rows: icon with a tooltip, label still available to screen readers. */
  dot?: boolean;
}

export function StatusBadge({ type, label, dot = false, className, ...props }: StatusBadgeProps) {
  const t = useT();
  const { tone, icon: Icon } = STATE_TYPE_STYLE[type];
  const text = label ?? t(`status.${type}`);

  if (dot) {
    return (
      <Tooltip content={text}>
        <span
          className={cn(
            badgeVariants({ tone }),
            'size-6 justify-center rounded-full p-0',
            className,
          )}
          {...props}
        >
          <Icon aria-hidden className="size-3.5" />
          <span className="sr-only">{text}</span>
        </span>
      </Tooltip>
    );
  }
  return (
    <Badge tone={tone} icon={Icon} className={className} {...props}>
      {text}
    </Badge>
  );
}
