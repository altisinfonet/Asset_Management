'use client';

import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Second line: where the option sits (a location path), or who it is (an email). */
  description?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  /** The chosen value, or null/'' for nothing chosen. */
  value: string | null;
  /** Label of the chosen value when it is not (or no longer) in `options` (async lists). */
  selectedLabel?: string;
  onValueChange: (value: string | null, option: ComboboxOption | undefined) => void;
  /**
   * Async lists: called with the typed text so the caller can fetch matching options. When set the
   * options are shown as given (the server already filtered them); otherwise they are filtered here.
   */
  onQueryChange?: (query: string) => void;
  loading?: boolean;
  placeholder?: string;
  /** Shown in the open list when nothing matches. */
  emptyText: string;
  /** Announced (and shown as an empty-state hint) while `loading`. */
  loadingText?: string;
  /** Adds a clear button (its accessible name) when a value is chosen. */
  clearLabel?: string;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  /** Called when the list opens (lets a caller start fetching). */
  onOpenChange?: (open: boolean) => void;
}

const matches = (option: ComboboxOption, needle: string) =>
  option.label.toLowerCase().includes(needle) ||
  (option.description ?? '').toLowerCase().includes(needle);

/**
 * Searchable single-select (design system W8 "select/combobox", ARIA 1.2 combobox pattern): a text
 * input that owns focus, a listbox below it, `aria-activedescendant` for the highlighted option.
 * Keys: Down/Up open and move, Enter chooses, Esc closes (the first Esc closes the list, not the
 * dialog around it), Tab leaves. The list is not portalled, so it stays inside a dialog's focus trap.
 */
export function Combobox({
  options,
  value,
  selectedLabel,
  onValueChange,
  onQueryChange,
  loading = false,
  placeholder,
  emptyText,
  loadingText,
  clearLabel,
  id,
  name,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  invalid,
  disabled,
  autoFocus,
  className,
  onOpenChange,
}: ComboboxProps) {
  const t = useT();
  const generated = useId();
  const inputId = id ?? `${generated}-input`;
  const listId = `${generated}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [typing, setTyping] = useState(false);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
    if (!next) {
      setTyping(false);
      setQuery('');
    }
  };

  const current = value ? options.find((o) => o.value === value) : undefined;
  const chosenLabel = current?.label ?? (value ? (selectedLabel ?? '') : '');
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (onQueryChange || !typing || !needle) return options;
    return options.filter((option) => matches(option, needle));
  }, [options, query, typing, onQueryChange]);

  // Keep the highlight on a real option: the chosen one when the list opens, the first while typing.
  const firstEnabled = (list: readonly ComboboxOption[], from = 0) => {
    const index = list.findIndex((o, i) => i >= from && !o.disabled);
    return index === -1 ? 0 : index;
  };
  useEffect(() => {
    if (!open) return;
    const chosen = shown.findIndex((o) => o.value === value);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-anchor the highlight when the list changes
    setActive(typing || chosen === -1 ? firstEnabled(shown) : chosen);
  }, [open, shown, typing, value]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const choose = (option: ComboboxOption | undefined) => {
    if (!option || option.disabled) return;
    onValueChange(option.value, option);
    setOpen(false);
  };

  const move = (step: 1 | -1) => {
    if (shown.length === 0) return;
    let next = active;
    for (let i = 0; i < shown.length; i += 1) {
      next = (next + step + shown.length) % shown.length;
      if (!shown[next]!.disabled) break;
    }
    setActive(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) setOpen(true);
        else move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) setOpen(true);
        else move(-1);
        break;
      case 'Enter':
        if (open) {
          event.preventDefault(); // choosing must not submit the form around the field
          choose(shown[active]);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        break;
      case 'Tab':
        if (open) setOpen(false);
        break;
    }
  };

  const activeId = open && shown[active] ? `${listId}-${active}` : undefined;
  const text = typing ? query : chosenLabel;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <input
        id={inputId}
        name={name}
        role="combobox"
        type="text"
        autoComplete="off"
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        data-combobox-open={open ? 'true' : undefined}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          setTyping(true);
          setQuery(event.target.value);
          onQueryChange?.(event.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onClick={() => {
          if (!open && !disabled) setOpen(true);
        }}
        onBlur={(event) => {
          // Leaving the field (not moving into its own list) closes the list.
          if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'min-h-(--size-control) w-full rounded-md border border-border-strong bg-surface py-0 pr-16 pl-3 text-md text-text sm:text-base',
          'placeholder:text-muted disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted',
          'aria-invalid:border-danger aria-invalid:border-2',
        )}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 text-muted">
        {loading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
        <ChevronDown aria-hidden className="size-4" />
      </span>
      {clearLabel && value && !disabled ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => {
            onValueChange(null, undefined);
            setOpen(false);
          }}
          className="absolute inset-y-0 right-8 my-auto flex size-6 items-center justify-center rounded-sm text-muted hover:bg-sunken hover:text-text"
        >
          <X aria-hidden className="size-4" />
        </button>
      ) : null}

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute top-full right-0 left-0 z-(--z-popover) mt-1 max-h-60 overflow-auto rounded-lg border border-border bg-surface p-1 text-text shadow-md"
          onMouseDown={(event) => event.preventDefault()}
        >
          {shown.length === 0 ? (
            <li role="presentation" className="px-3 py-2 text-base text-muted">
              {loading && loadingText ? loadingText : emptyText}
            </li>
          ) : (
            shown.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                data-index={index}
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                onClick={() => choose(option)}
                onMouseMove={() => !option.disabled && setActive(index)}
                className={cn(
                  'relative flex min-h-(--size-control) cursor-pointer flex-col justify-center rounded-md py-1 pr-3 pl-8 text-base select-none',
                  index === active ? 'bg-sunken' : null,
                  option.disabled ? 'cursor-not-allowed text-muted' : null,
                )}
              >
                {option.value === value ? (
                  <Check aria-hidden className="absolute top-2.5 left-2 size-4 text-primary-text" />
                ) : null}
                <span>{option.label}</span>
                {option.description ? (
                  <span className="text-sm text-muted">{option.description}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">
        {open
          ? loading
            ? (loadingText ?? '')
            : t('combobox.results', { count: shown.length })
          : ''}
      </span>
    </div>
  );
}
