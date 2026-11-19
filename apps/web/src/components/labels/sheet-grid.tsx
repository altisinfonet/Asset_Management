'use client';

import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import type { LabelTemplate } from '@/lib/labels/api';
import { sheetSlots, slotCell, slotsPerSheet } from '@/lib/labels/helpers';

type Geometry = Pick<LabelTemplate, 'cols' | 'rows' | 'page_width_mm' | 'page_height_mm'>;

const CELL_STYLE = {
  used: 'border-border bg-sunken text-muted [background-image:repeating-linear-gradient(135deg,transparent_0_4px,var(--color-border)_4px_5px)]',
  label: 'border-primary bg-primary-subtle text-primary-text',
  empty: 'border-dashed border-border-strong bg-surface text-muted',
} as const;

/**
 * The sheet as a grid of slots (visual start-position picker, wireframe WEB-15). On the first sheet
 * every slot is a radio button (arrow keys move and choose); a slot before the start is "already
 * used" (hatched), the ones that get a label are filled, the rest are dashed. Later sheets are only
 * shown. Slots are never smaller than 24 x 24 px (WCAG 2.5.8), so a dense sheet scrolls sideways.
 */
export function SheetGrid({
  template,
  start,
  onStartChange,
  count,
  sheet,
  sheets,
}: {
  template: Geometry;
  start: number;
  onStartChange: (slot: number) => void;
  count: number;
  /** Sheet shown, 1-based. Only sheet 1 can be clicked. */
  sheet: number;
  sheets: number;
}) {
  const t = useT();
  const perSheet = slotsPerSheet(template);
  const states = sheetSlots(sheet, count, start, template);
  const interactive = sheet === 1;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const ratio =
    template.page_width_mm && template.page_height_mm
      ? template.page_width_mm / template.page_height_mm
      : 8.5 / 11;
  const activeSlot = ((Math.max(1, start) - 1) % perSheet) + 1;

  const move = (slot: number) => {
    const next = Math.min(perSheet, Math.max(1, slot));
    onStartChange(next);
    refs.current[next - 1]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, slot: number) => {
    const { cols } = template;
    const target =
      event.key === 'ArrowRight'
        ? slot + 1
        : event.key === 'ArrowLeft'
          ? slot - 1
          : event.key === 'ArrowDown'
            ? slot + cols
            : event.key === 'ArrowUp'
              ? slot - cols
              : event.key === 'Home'
                ? 1
                : event.key === 'End'
                  ? perSheet
                  : null;
    if (target === null) return;
    event.preventDefault();
    move(target);
  };

  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${template.cols}, minmax(24px, 1fr))`,
    gridAutoRows: 'minmax(24px, 1fr)',
    aspectRatio: String(ratio),
  };

  const cells = states.map((state, index) => {
    const slot = index + 1;
    const { row, col } = slotCell(slot, template);
    const name = `${t('labels.cell', { position: slot, row: row + 1, col: col + 1 })}, ${t(`labels.cellState.${state}`)}`;
    const classes = cn(
      'flex min-h-6 min-w-6 items-center justify-center rounded-sm border text-xs font-medium',
      CELL_STYLE[state],
    );
    return interactive ? (
      <button
        key={slot}
        ref={(node) => {
          refs.current[index] = node;
        }}
        type="button"
        role="radio"
        aria-checked={slot === activeSlot}
        aria-label={name}
        tabIndex={slot === activeSlot ? 0 : -1}
        onClick={() => onStartChange(slot)}
        onKeyDown={(event) => onKeyDown(event, slot)}
        className={cn(
          classes,
          'hover:border-primary',
          slot === activeSlot && 'ring-2 ring-focus ring-offset-1',
        )}
      >
        {slot}
      </button>
    ) : (
      <span key={slot} className={classes} aria-hidden>
        {slot}
      </span>
    );
  });

  return (
    <div className="max-w-full overflow-x-auto">
      {interactive ? (
        <div
          role="radiogroup"
          aria-label={t('labels.gridLabel')}
          className="grid w-full max-w-[22rem] gap-1 rounded-md border border-border-strong bg-surface p-2"
          style={style}
          data-testid="sheet-grid"
        >
          {cells}
        </div>
      ) : (
        <div
          role="img"
          aria-label={t('labels.sheetOf', { sheet, sheets })}
          className="grid w-full max-w-[22rem] gap-1 rounded-md border border-border-strong bg-surface p-2"
          style={style}
          data-testid="sheet-grid"
        >
          {cells}
        </div>
      )}
    </div>
  );
}
