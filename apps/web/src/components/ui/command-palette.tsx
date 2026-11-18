'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Search, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { DialogOverlay } from './dialog';
import { Kbd } from './kbd';

export interface CommandPaletteItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Display-only hint ("G A"). */
  shortcut?: string;
  /** Extra search terms. */
  keywords?: string[];
  /** Always listed, whatever is typed (a "jump to <typed tag>" row is built from the query). */
  alwaysShow?: boolean;
  onSelect: () => void;
}

export interface CommandPaletteGroup {
  id: string;
  heading: string;
  items: CommandPaletteItem[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: CommandPaletteGroup[];
  /** Controlled search text. Leave both undefined for an uncontrolled palette. */
  search?: string;
  onSearchChange?: (search: string) => void;
}

/**
 * Command palette shell (design system W7) on cmdk inside a Radix dialog: focus trapped, Esc
 * closes, typing filters, arrows move, Enter runs. Live asset search (tag, serial, name) plugs
 * in later as another group; this shell only knows static groups.
 */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
  search,
  onSearchChange,
}: CommandPaletteProps) {
  const t = useT();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            'fixed top-[15%] left-1/2 z-(--z-dialog) w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface text-text shadow-lg',
            'data-[state=open]:animate-[at-pop-in_160ms_ease-out]',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{t('palette.title')}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t('palette.description')}
          </DialogPrimitive.Description>
          <Command label={t('palette.title')} loop>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden className="size-4 shrink-0 text-muted" />
              <Command.Input
                autoFocus
                value={search}
                onValueChange={onSearchChange}
                placeholder={t('palette.placeholder')}
                aria-label={t('palette.placeholder')}
                className="min-h-12 w-full bg-transparent text-md text-text outline-none placeholder:text-muted sm:text-base"
              />
            </div>
            <Command.List className="max-h-80 overflow-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-base text-muted">
                {t('palette.empty')}
              </Command.Empty>
              {groups.map((group) => (
                <Command.Group
                  key={group.id}
                  heading={group.heading}
                  forceMount={group.items.some((item) => item.alwaysShow)}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted"
                >
                  {group.items.map((item) => (
                    <Command.Item
                      key={item.id}
                      // Always-shown rows get a value no typed text matches, so they rank last and
                      // Enter picks a real match first.
                      value={item.alwaysShow ? `⁣${item.id}` : `${group.heading} ${item.label}`}
                      keywords={item.keywords}
                      forceMount={item.alwaysShow}
                      onSelect={() => {
                        onOpenChange(false);
                        item.onSelect();
                      }}
                      className="flex min-h-(--size-control) cursor-pointer items-center gap-3 rounded-md px-2 text-base data-[selected=true]:bg-primary-subtle data-[selected=true]:text-primary-text"
                    >
                      {item.icon ? <item.icon aria-hidden className="size-4 shrink-0" /> : null}
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.shortcut ? <Kbd>{item.shortcut}</Kbd> : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
            <div className="flex items-center gap-4 border-t border-border px-3 py-2 text-xs text-muted">
              <span className="flex items-center gap-1">
                <Kbd>↑↓</Kbd> {t('palette.hintNavigate')}
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> {t('palette.hintSelect')}
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Esc</Kbd> {t('palette.hintClose')}
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** `Ctrl+K` / `Cmd+K` toggles the palette from anywhere (including inside inputs). */
export function useCommandPaletteHotkey(toggle: () => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);
}
