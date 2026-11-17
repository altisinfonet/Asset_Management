'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import { CircleAlert, CircleCheck, CircleX, Info, X, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useT, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { IconButton } from './button';

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  /** An action ("Undo") keeps the toast on screen until dismissed. */
  action?: { label: string; onClick: () => void };
  /** Support request id; shown in error toasts. */
  requestId?: string;
  /** Milliseconds; defaults to 5000, or until dismissed when there is an action. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string;
  /** Show an error toast from a catalogue key and optional request id. */
  error: (messageKey: TranslationKey, requestId?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 5000;
const PERSIST = 24 * 60 * 60 * 1000;

const VARIANT_STYLES: Record<
  ToastVariant,
  { icon: LucideIcon; classes: string; iconClass: string }
> = {
  default: { icon: Info, classes: 'border-border', iconClass: 'text-muted' },
  success: { icon: CircleCheck, classes: 'border-success', iconClass: 'text-success' },
  warning: { icon: CircleAlert, classes: 'border-warning', iconClass: 'text-warning' },
  danger: { icon: CircleX, classes: 'border-danger', iconClass: 'text-danger' },
  info: { icon: Info, classes: 'border-info', iconClass: 'text-info' },
};

let counter = 0;

/**
 * Toasts (design system W13): bottom-right, 5 s auto-dismiss, kept while an action is offered,
 * paused on hover and focus, at most 3 stacked. Errors use `role="alert"` (assertive); everything
 * else is `role="status"` (polite). A toast is never the only place an error appears.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const id = `toast-${++counter}`;
    setItems((current) => [...current, { ...options, id }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const error = useCallback(
    (messageKey: TranslationKey, requestId?: string) =>
      toast({ variant: 'danger', title: t(messageKey), requestId }),
    [toast, t],
  );

  const value = useMemo(() => ({ toast, error, dismiss }), [toast, error, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" label={t('toast.notifications')}>
        {children}
        {items.map((item) => {
          const style = VARIANT_STYLES[item.variant ?? 'default'];
          const Icon = style.icon;
          return (
            <ToastPrimitive.Root
              key={item.id}
              type={item.variant === 'danger' ? 'foreground' : 'background'}
              duration={item.duration ?? (item.action ? PERSIST : DEFAULT_DURATION)}
              onOpenChange={(open) => {
                if (!open) dismiss(item.id);
              }}
              className={cn(
                'flex items-start gap-3 rounded-lg border bg-surface p-3 text-text shadow-md',
                'data-[state=open]:animate-[at-slide-in-right_160ms_ease-out] data-[state=closed]:animate-[at-fade-out_100ms_ease-out]',
                style.classes,
              )}
            >
              <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', style.iconClass)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <ToastPrimitive.Title className="text-base font-medium">
                  {item.title}
                </ToastPrimitive.Title>
                {item.description ? (
                  <ToastPrimitive.Description className="text-sm text-muted">
                    {item.description}
                  </ToastPrimitive.Description>
                ) : null}
                {item.requestId ? (
                  <p className="font-tag text-xs text-muted">
                    {t('toast.requestId', { id: item.requestId })}
                  </p>
                ) : null}
                {item.action ? (
                  <ToastPrimitive.Action altText={item.action.label} asChild>
                    <button
                      type="button"
                      onClick={item.action.onClick}
                      className="mt-1 w-fit rounded-md px-1 text-sm font-medium text-primary-text underline underline-offset-2"
                    >
                      {item.action.label}
                    </button>
                  </ToastPrimitive.Action>
                ) : null}
              </div>
              <ToastPrimitive.Close asChild>
                <IconButton icon={X} label={t('toast.dismiss')} size="icon-sm" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-(--z-toast) flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
