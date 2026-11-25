'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { useTheme, type ThemePreference } from '@/lib/theme';

const OPTIONS = [
  { value: 'system', icon: Monitor, labelKey: 'theme.systemShort' },
  { value: 'light', icon: Sun, labelKey: 'theme.light' },
  { value: 'dark', icon: Moon, labelKey: 'theme.dark' },
] as const satisfies ReadonlyArray<{ value: ThemePreference; icon: unknown; labelKey: string }>;

/**
 * The three themes side by side (System, Light, Dark) as a segmented radio group, shown in the
 * sidebar footer. The top bar's Theme menu sets the same preference.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const t = useT();
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label={t('theme.label')}
      data-testid="theme-switch"
      className={cn('grid grid-cols-3 gap-0.5 rounded-lg bg-sunken p-0.5', className)}
      onKeyDown={(event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const index = OPTIONS.findIndex((option) => option.value === theme);
        const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length]!;
        setTheme(next.value);
        event.currentTarget
          .querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)
          ?.focus();
      }}
    >
      {OPTIONS.map((option) => {
        const checked = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={option.value}
            tabIndex={checked ? 0 : -1}
            onClick={() => setTheme(option.value)}
            className={cn(
              'flex min-h-(--size-control-dense) items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted hover:text-text',
              checked && 'bg-primary-subtle text-text shadow-sm',
            )}
          >
            <option.icon
              aria-hidden
              className={cn('size-3.5 shrink-0', checked && 'text-primary')}
            />
            {t(option.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
