'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  name?: string;
  /** Needed when the select has no visible `<label htmlFor>`. */
  'aria-label'?: string;
  'aria-describedby'?: string;
  className?: string;
  /** `md` is the 36px form control; `sm` is the 28px dense control (24px inside a compact table). */
  size?: 'md' | 'sm';
  /**
   * `outline` always shows the border (forms, filters). `ghost` hides border and fill at rest and shows
   * them on hover and focus; the chevron stays visible so it still reads as a control. Use `size="sm"
   * variant="ghost"` for selects inside table cells.
   */
  variant?: 'outline' | 'ghost';
}

/**
 * Single-select dropdown on Radix Select (keyboard: type-ahead, arrows, Home/End).
 * Item values must be non-empty strings (Radix reserves "" for "no selection").
 */
export function Select({
  options,
  placeholder,
  invalid,
  id,
  className,
  size = 'md',
  variant = 'outline',
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  ...root
}: SelectProps) {
  return (
    <SelectPrimitive.Root {...root}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={cn(
          'flex items-center justify-between rounded-md border text-text',
          size === 'sm'
            ? 'min-h-(--size-control-dense) gap-1.5 px-2 text-sm in-data-[density=compact]:min-h-6'
            : 'min-h-(--size-control) gap-2 px-3 text-md sm:text-base',
          variant === 'ghost'
            ? 'w-auto border-transparent bg-transparent hover:border-border-strong hover:bg-sunken disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-muted disabled:hover:bg-transparent'
            : 'w-full border-border-strong bg-surface disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted',
          'data-[placeholder]:text-muted',
          'aria-invalid:border-danger aria-invalid:border-2',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            'z-(--z-popover) max-h-72 min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-border bg-surface text-text shadow-md',
            'data-[state=open]:animate-[at-pop-in_100ms_ease-out]',
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'relative flex min-h-(--size-control-dense) cursor-pointer items-center rounded-md py-1 pr-3 pl-8 text-base select-none',
                  'data-[highlighted]:bg-sunken data-[highlighted]:outline-none',
                  'data-[disabled]:cursor-not-allowed data-[disabled]:text-muted',
                )}
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex items-center">
                  <Check aria-hidden className="size-4 text-primary-text" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
