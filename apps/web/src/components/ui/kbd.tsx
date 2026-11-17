import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Keyboard hint chip (`Ctrl K`, `/`). Decorative next to a labelled control. */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-sm border border-border bg-sunken px-1 font-sans text-xs font-medium text-muted',
        className,
      )}
      {...props}
    />
  );
}
