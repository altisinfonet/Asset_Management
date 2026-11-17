'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { Checkbox } from './checkbox';
import { Skeleton } from './skeleton';

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  columnId: string;
  direction: SortDirection;
}

export interface DataTableColumn<T> {
  id: string;
  /** Header content. Use `srOnlyHeader` for action columns without a visible title. */
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'start' | 'end';
  /** CSS width (`'160px'`); other columns share the remaining space. */
  width?: string;
  sortable?: boolean;
  /** Pin this column to the start edge while scrolling horizontally (use on the first column only). */
  sticky?: boolean;
  /** Render the cell in the mono face (asset tags, serial numbers). */
  mono?: boolean;
  srOnlyHeader?: boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Accessible name of the table region (required). */
  label: string;
  /** Comfortable rows are 36px, compact rows 28px. */
  density?: 'comfortable' | 'compact';
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectedIdsChange?: (ids: Set<string>) => void;
  /** A readable name for a row, used in the row checkbox label. */
  getRowLabel?: (row: T) => string;
  /** Mouse click on a row (opens the quick-view drawer). */
  onRowClick?: (row: T) => void;
  /** Enter on a focused row (opens the full page). */
  onRowOpen?: (row: T) => void;
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  loading?: boolean;
  skeletonRows?: number;
  /** Shown instead of rows when there are none (use `EmptyState`). */
  empty?: ReactNode;
  className?: string;
  /** Scroll-region max height (CSS value). The header stays pinned inside it. */
  maxHeight?: string;
}

/**
 * Data table shell (design system W3): sticky header and first column, 36px rows (28px compact),
 * hover and selection tints instead of zebra, `aria-sort` headers, roving-tabindex row focus with
 * arrow keys, Space to select, Enter to open. Virtualisation, column picker, resizing and inline
 * edit are added on top of this shell by the assets-list story (TanStack Table + Virtual).
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  label,
  density = 'comfortable',
  selectable = false,
  selectedIds,
  onSelectedIdsChange,
  getRowLabel,
  onRowClick,
  onRowOpen,
  sort,
  onSortChange,
  loading = false,
  skeletonRows = 8,
  empty,
  className,
  maxHeight = '70vh',
}: DataTableProps<T>) {
  const t = useT();
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const interactive = selectable || !!onRowClick || !!onRowOpen;
  const selected = selectedIds ?? EMPTY_SET;
  const rowHeight = density === 'compact' ? 'h-7' : 'h-9';
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(getRowId(r)));
  const someSelected = !allSelected && rows.some((r) => selected.has(getRowId(r)));
  const checkboxWidth = 'w-10 min-w-10 max-w-10';

  const toggleRow = useCallback(
    (id: string, on: boolean) => {
      const next = new Set(selected);
      if (on) next.add(id);
      else next.delete(id);
      onSelectedIdsChange?.(next);
    },
    [selected, onSelectedIdsChange],
  );

  const toggleAll = (on: boolean) => {
    onSelectedIdsChange?.(on ? new Set(rows.map(getRowId)) : new Set());
  };

  const focusRow = (index: number) => {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    setFocusIndex(clamped);
    bodyRef.current?.querySelectorAll<HTMLElement>('tr[data-row]')[clamped]?.focus();
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: T, index: number) => {
    if (event.target !== event.currentTarget) return; // keys inside cell controls are theirs
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusRow(0);
        break;
      case 'End':
        event.preventDefault();
        focusRow(rows.length - 1);
        break;
      case ' ':
        if (selectable) {
          event.preventDefault();
          const id = getRowId(row);
          toggleRow(id, !selected.has(id));
        }
        break;
      case 'Enter':
        if (onRowOpen) {
          event.preventDefault();
          onRowOpen(row);
        } else if (onRowClick) {
          event.preventDefault();
          onRowClick(row);
        }
        break;
    }
  };

  const nextSort = (column: DataTableColumn<T>): SortState | null => {
    if (sort?.columnId !== column.id) return { columnId: column.id, direction: 'asc' };
    if (sort.direction === 'asc') return { columnId: column.id, direction: 'desc' };
    return null;
  };

  const stickyOffset = selectable ? 'left-10' : 'left-0';

  return (
    <div
      role="region"
      aria-label={label}
      aria-busy={loading || undefined}
      tabIndex={0}
      style={{ maxHeight }}
      className={cn('relative overflow-auto rounded-lg border border-border bg-surface', className)}
    >
      <table
        role={interactive ? 'grid' : undefined}
        aria-label={label}
        aria-multiselectable={selectable || undefined}
        className="w-full border-separate border-spacing-0 text-sm"
      >
        <thead>
          <tr className="h-9">
            {selectable ? (
              <th
                scope="col"
                className={cn(
                  'sticky top-0 left-0 z-(--z-sticky) border-b border-border bg-sunken px-3 text-left',
                  checkboxWidth,
                )}
              >
                <Checkbox
                  aria-label={t('table.selectAll')}
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(v) => toggleAll(v === true)}
                />
              </th>
            ) : null}
            {columns.map((column, ci) => {
              const active = sort?.columnId === column.id;
              const ariaSort = active
                ? sort.direction === 'asc'
                  ? 'ascending'
                  : 'descending'
                : column.sortable
                  ? 'none'
                  : undefined;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={ariaSort}
                  style={column.width ? { width: column.width, minWidth: column.width } : undefined}
                  className={cn(
                    'sticky top-0 z-(--z-sticky) border-b border-border bg-sunken px-3 text-xs font-semibold whitespace-nowrap text-muted shadow-sm',
                    column.align === 'end' ? 'text-right' : 'text-left',
                    column.sticky && ci === 0 ? cn(stickyOffset, 'z-[11]') : null,
                  )}
                >
                  {column.srOnlyHeader ? <span className="sr-only">{column.header}</span> : null}
                  {column.srOnlyHeader ? null : column.sortable ? (
                    <button
                      type="button"
                      onClick={() => onSortChange?.(nextSort(column))}
                      className="-mx-1 inline-flex min-h-6 items-center gap-1 rounded-sm px-1 text-xs font-semibold text-muted hover:text-text"
                    >
                      {column.header}
                      {active ? (
                        sort.direction === 'asc' ? (
                          <ArrowUp aria-hidden className="size-3.5" />
                        ) : (
                          <ArrowDown aria-hidden className="size-3.5" />
                        )
                      ) : (
                        <ChevronsUpDown aria-hidden className="size-3.5 opacity-60" />
                      )}
                      {active ? (
                        <span className="sr-only">
                          {sort.direction === 'asc'
                            ? t('table.sortedAscending')
                            : t('table.sortedDescending')}
                        </span>
                      ) : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {loading
            ? Array.from({ length: skeletonRows }, (_, r) => (
                <tr key={`skeleton-${r}`} className={rowHeight}>
                  {selectable ? (
                    <td className={cn('border-b border-border px-3', checkboxWidth)}>
                      <Skeleton className="size-4" />
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td key={column.id} className="border-b border-border px-3">
                      <Skeleton className="h-3.5 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, index) => {
                const id = getRowId(row);
                const isSelected = selected.has(id);
                return (
                  <tr
                    key={id}
                    data-row
                    tabIndex={interactive ? (index === focusIndex ? 0 : -1) : undefined}
                    aria-selected={interactive && selectable ? isSelected : undefined}
                    onFocus={() => setFocusIndex(index)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={interactive ? (e) => onRowKeyDown(e, row, index) : undefined}
                    className={cn(
                      rowHeight,
                      'group transition-colors duration-100',
                      onRowClick ? 'cursor-pointer' : null,
                      isSelected ? 'bg-primary-subtle' : 'hover:bg-sunken',
                    )}
                  >
                    {selectable ? (
                      <td
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          'sticky left-0 z-(--z-sticky) border-b border-border px-3',
                          isSelected ? 'bg-primary-subtle' : 'bg-surface group-hover:bg-sunken',
                          checkboxWidth,
                        )}
                      >
                        <Checkbox
                          aria-label={t('table.selectRow', { label: getRowLabel?.(row) ?? id })}
                          checked={isSelected}
                          onCheckedChange={(v) => toggleRow(id, v === true)}
                        />
                      </td>
                    ) : null}
                    {columns.map((column, ci) => (
                      <td
                        key={column.id}
                        className={cn(
                          'border-b border-border px-3 whitespace-nowrap',
                          column.align === 'end' ? 'text-right tabular-nums' : 'text-left',
                          column.mono ? 'font-tag' : null,
                          column.sticky && ci === 0
                            ? cn(
                                'sticky z-(--z-sticky)',
                                stickyOffset,
                                isSelected
                                  ? 'bg-primary-subtle'
                                  : 'bg-surface group-hover:bg-sunken',
                              )
                            : null,
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
      {!loading && rows.length === 0 && empty ? <div>{empty}</div> : null}
      <span className="sr-only" role="status" aria-live="polite">
        {loading ? t('table.loadingRows') : ''}
      </span>
    </div>
  );
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export interface BulkActionBarProps {
  count: number;
  /** Bulk actions ("Check out", "Change status"). */
  children?: ReactNode;
  onClear: () => void;
}

/** Appears under the table when rows are selected; announces the count politely. */
export function BulkActionBar({ count, children, onClear }: BulkActionBarProps) {
  const t = useT();
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 shadow-sm">
      <span role="status" className="px-2 text-base font-medium">
        {t('table.selected', { count })}
      </span>
      {children}
      <button
        type="button"
        onClick={onClear}
        className="ml-auto rounded-md px-2 py-1 text-sm text-primary-text underline underline-offset-2"
      >
        {t('table.clearSelection')}
      </button>
    </div>
  );
}
