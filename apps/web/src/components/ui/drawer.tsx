'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { DialogOverlay } from './dialog';

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export interface DrawerContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** Right is the detail drawer (480px); left is the mobile navigation sheet. */
  side?: 'right' | 'left';
  hideClose?: boolean;
}

/**
 * Side drawer (design system W11): 480px wide, 12px leading corners, `shadow-lg`. Esc closes and
 * focus returns to the element that opened it (the table row). Uses a modal Radix Dialog.
 */
export function DrawerContent({
  className,
  children,
  side = 'right',
  hideClose = false,
  ...props
}: DrawerContentProps) {
  const t = useT();
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay className="z-(--z-drawer)" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 z-(--z-drawer) flex w-(--size-drawer) max-w-full flex-col border-border bg-surface text-text shadow-lg',
          side === 'right'
            ? 'right-0 rounded-l-xl border-l data-[state=open]:animate-[at-slide-in-right_160ms_ease-out]'
            : 'left-0 rounded-r-xl border-r data-[state=open]:animate-[at-slide-in-left_160ms_ease-out]',
          'data-[state=closed]:animate-[at-fade-out_100ms_ease-out]',
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

export function DrawerHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-1 border-b border-border p-4 pr-14', className)}
      {...props}
    />
  );
}

export function DrawerBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex-1 overflow-auto p-4', className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center justify-end gap-2 border-t border-border p-4', className)}
      {...props}
    />
  );
}

export function DrawerTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold text-text', className)}
      {...props}
    />
  );
}

export function DrawerDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-sm text-muted', className)} {...props} />;
}
