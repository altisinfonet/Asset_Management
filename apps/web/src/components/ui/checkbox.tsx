'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends ComponentProps<typeof CheckboxPrimitive.Root> {
  /** Visible label. Without one, pass `aria-label`. */
  label?: ReactNode;
  labelClassName?: string;
}

/**
 * Checkbox with a 24x24 minimum target (WCAG 2.5.8): the whole label row is clickable, and the
 * box has a 3:1 `border-strong` boundary. `checked="indeterminate"` is supported.
 */
export function Checkbox({ label, className, labelClassName, id, ...props }: CheckboxProps) {
  const box = (
    <CheckboxPrimitive.Root
      id={id}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface text-primary-on',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        'disabled:cursor-not-allowed disabled:border-border disabled:bg-sunken',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        {props.checked === 'indeterminate' ? (
          <Minus aria-hidden className="size-3" strokeWidth={3} />
        ) : (
          <Check aria-hidden className="size-3" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!label) {
    return <span className="inline-flex size-6 items-center justify-center">{box}</span>;
  }
  return (
    <label
      className={cn(
        'inline-flex min-h-6 cursor-pointer items-center gap-2 text-base',
        labelClassName,
      )}
    >
      {box}
      <span>{label}</span>
    </label>
  );
}
