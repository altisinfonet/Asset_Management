import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends ComponentProps<'input'> {
  /** Marks the field invalid (red border, `aria-invalid`). Pair it with an error message via `Field`. */
  invalid?: boolean;
}

/** 36px text input with a 3:1 boundary; 16px text on small screens to prevent iOS zoom. */
export function Input({ className, invalid, type = 'text', ...props }: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-(--size-control) w-full rounded-md border border-border-strong bg-surface px-3 text-md text-text sm:text-base',
        'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted',
        'aria-invalid:border-danger aria-invalid:border-2',
        'read-only:bg-sunken',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: ComponentProps<'textarea'> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-20 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-md text-text sm:text-base',
        'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted',
        'aria-invalid:border-danger aria-invalid:border-2',
        className,
      )}
      {...props}
    />
  );
}
