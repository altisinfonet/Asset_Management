'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'scrim fixed inset-0 z-(--z-dialog)',
        'data-[state=open]:animate-[at-fade-in_160ms_ease-out] data-[state=closed]:animate-[at-fade-out_100ms_ease-out]',
        className,
      )}
      {...props}
    />
  );
}

export interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** `md` is 520px wide (confirmations), `lg` is 640px (forms). */
  size?: 'md' | 'lg';
  /** Hide the corner close button (the footer must then offer Cancel). */
  hideClose?: boolean;
}

/**
 * Modal dialog: focus trapped, Esc closes, focus returns to the trigger, background inert.
 * Always render a `DialogTitle` (and a `DialogDescription` when there is explanatory text).
 */
export function DialogContent({
  className,
  children,
  size = 'md',
  hideClose = false,
  ...props
}: DialogContentProps) {
  const t = useT();
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-(--z-dialog) flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-auto rounded-xl border border-border bg-surface p-6 text-text shadow-lg',
          size === 'md' ? 'max-w-[520px]' : 'max-w-[640px]',
          'data-[state=open]:animate-[at-pop-in_160ms_ease-out]',
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.close')}
              className="absolute top-3 right-3"
            >
              <X aria-hidden className="size-4" />
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold text-text', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn('text-base text-muted', className)} {...props} />
  );
}
