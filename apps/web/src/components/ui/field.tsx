'use client';

import { CircleX } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

export interface FieldProps {
  label: ReactNode;
  /** Render the control with the wiring props spread onto it. */
  children: (control: FieldControlProps) => ReactNode;
  hint?: ReactNode;
  /** Error text; makes the control invalid and is announced through `aria-describedby`. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
}

/**
 * Form layout: label above the control, hint and error below, linked with `aria-describedby`.
 * Required fields say "(required)" in text, not only with an asterisk (design system W8).
 */
export function Field({ label, children, hint, error, required, className }: FieldProps) {
  const t = useT();
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-base font-medium text-text">
        {label}
        {required ? (
          <span className="ml-1 font-normal text-muted">{t('common.required')}</span>
        ) : null}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger-text">
          <CircleX aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
