'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { Tooltip } from './tooltip';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium select-none',
    'transition-colors duration-100 ease-out',
    'disabled:bg-sunken disabled:text-muted disabled:border-border disabled:hover:bg-sunken',
    'aria-disabled:bg-sunken aria-disabled:text-muted aria-disabled:border-border',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-on hover:bg-primary-hover border border-transparent',
        secondary: 'border border-border-strong bg-surface text-text hover:bg-sunken',
        ghost: 'border border-transparent bg-transparent text-text hover:bg-sunken',
        danger: 'border border-transparent bg-danger text-danger-on hover:brightness-90',
        link: 'border border-transparent bg-transparent text-primary-text underline underline-offset-2 hover:bg-primary-subtle',
      },
      size: {
        md: 'min-h-(--size-control) px-3 text-base',
        sm: 'min-h-(--size-control-dense) px-2 text-sm',
        icon: 'size-(--size-control) p-0',
        'icon-sm': 'size-(--size-control-dense) p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (for example a Next.js `Link`) with button styling. */
  asChild?: boolean;
  /** Shows a spinner, keeps the label and ignores clicks ("Checking out..."). */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'size' | 'aria-label'> {
  icon: LucideIcon;
  /** Accessible name and tooltip text (required for icon-only controls). */
  label: string;
  size?: 'icon' | 'icon-sm';
}

/** Icon-only button: always has an `aria-label` and a visible tooltip. */
export function IconButton({
  icon: Icon,
  label,
  size = 'icon',
  variant = 'ghost',
  ...props
}: IconButtonProps) {
  return (
    <Tooltip content={label}>
      <Button variant={variant} size={size} aria-label={label} {...props}>
        <Icon aria-hidden className="size-4" />
      </Button>
    </Tooltip>
  );
}
