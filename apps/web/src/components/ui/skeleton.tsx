import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Loading placeholder that matches the final layout. Decorative (`aria-hidden`); announce loading
 * state with `aria-busy` on the surrounding region and a polite live region.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn('animate-[at-pulse_1.6s_ease-in-out_infinite] rounded-md bg-sunken', className)}
      {...props}
    />
  );
}

/** A paragraph-shaped block of `lines` skeleton lines; the last line is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn('h-4', i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}
