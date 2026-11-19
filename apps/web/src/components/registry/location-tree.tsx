'use client';

import {
  Building2,
  Car,
  ChevronDown,
  ChevronRight,
  Layers,
  MapPin,
  Package,
  DoorOpen,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { visibleRows, type LocationNode, type VisibleRow } from '@/lib/registry/locations';
import type { LocationKind } from '@/lib/registry/types';

const KIND_ICON: Record<LocationKind, LucideIcon> = {
  site: MapPin,
  building: Building2,
  floor: Layers,
  room: DoorOpen,
  storage: Warehouse,
  vehicle: Car,
  other: Package,
};

export interface LocationTreeProps {
  roots: readonly LocationNode[];
  /** The selected location (its details are on screen). */
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: ReadonlySet<string>;
  onExpandedChange: (next: Set<string>) => void;
  /** F2 on a focused row (rename). */
  onRename?: (id: string) => void;
  /** Ids to mark as search matches. */
  highlight?: ReadonlySet<string>;
  label: string;
}

/**
 * Location tree (design system W19), WAI-ARIA tree pattern with a flat list of rows carrying
 * `aria-level` / `aria-posinset` / `aria-setsize`. One row is in the tab order (roving tabindex).
 * Keys: Up/Down move, Right expands (or enters the first child), Left collapses (or goes to the
 * parent), Home/End jump, Enter and Space select, F2 renames. Every action is also a button in the
 * detail panel, so nothing depends on a gesture.
 */
export function LocationTree({
  roots,
  selectedId,
  onSelect,
  expanded,
  onExpandedChange,
  onRename,
  highlight,
  label,
}: LocationTreeProps) {
  const t = useT();
  const rows = useMemo(() => visibleRows(roots, (id) => expanded.has(id)), [roots, expanded]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // The tab stop: the focused row, else the selected one, else the first.
  const tabStop =
    rows.find((row) => row.node.location.id === focusId)?.node.location.id ??
    rows.find((row) => row.node.location.id === selectedId)?.node.location.id ??
    rows[0]?.node.location.id;

  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    requestAnimationFrame(() =>
      containerRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus(),
    );
  };

  const toggle = (id: string, open: boolean) => {
    const next = new Set(expanded);
    if (open) next.add(id);
    else next.delete(id);
    onExpandedChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: VisibleRow, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const id = row.node.location.id;
    const hasChildren = row.node.children.length > 0;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(rows[index + 1]?.node.location.id);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(rows[index - 1]?.node.location.id);
        break;
      case 'Home':
        event.preventDefault();
        focusRow(rows[0]?.node.location.id);
        break;
      case 'End':
        event.preventDefault();
        focusRow(rows[rows.length - 1]?.node.location.id);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (hasChildren && !expanded.has(id)) toggle(id, true);
        else if (hasChildren) focusRow(row.node.children[0]!.location.id);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (hasChildren && expanded.has(id)) toggle(id, false);
        else if (row.node.location.parent_id) focusRow(row.node.location.parent_id);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect(id);
        break;
      case 'F2':
        if (onRename) {
          event.preventDefault();
          onRename(id);
        }
        break;
    }
  };

  return (
    <div ref={containerRef} role="tree" aria-label={label} className="flex flex-col">
      {rows.map((row, index) => {
        const location = row.node.location;
        const id = location.id;
        const hasChildren = row.node.children.length > 0;
        const isOpen = expanded.has(id);
        const selected = id === selectedId;
        const Icon = KIND_ICON[location.kind ?? 'other'];
        const count = location.asset_count;
        return (
          <div
            key={id}
            role="treeitem"
            data-id={id}
            aria-level={row.level}
            aria-posinset={row.position}
            aria-setsize={row.siblings}
            aria-expanded={hasChildren ? isOpen : undefined}
            aria-selected={selected}
            tabIndex={id === tabStop ? 0 : -1}
            onFocus={() => setFocusId(id)}
            onClick={() => {
              setFocusId(id);
              onSelect(id);
            }}
            onKeyDown={(event) => onKeyDown(event, row, index)}
            style={{ paddingLeft: `${(row.level - 1) * 16 + 8}px` }}
            className={cn(
              'flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-base',
              selected ? 'bg-primary-subtle font-medium text-primary-text' : 'hover:bg-sunken',
              highlight?.has(id) && !selected ? 'bg-warning-subtle' : null,
            )}
          >
            {hasChildren ? (
              <span
                aria-hidden
                onClick={(event) => {
                  event.stopPropagation();
                  toggle(id, !isOpen);
                }}
                className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-sunken"
              >
                {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              </span>
            ) : (
              <span aria-hidden className="size-6 shrink-0" />
            )}
            <Icon aria-hidden className="size-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{location.name}</span>
            {count === undefined ? null : (
              <>
                <span aria-hidden className="shrink-0 text-sm tabular-nums text-muted">
                  {count}
                </span>
                <span className="sr-only">{t('locations.assetCount', { count })}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
