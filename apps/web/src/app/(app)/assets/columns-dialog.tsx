'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, IconButton } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { DEFAULT_COLUMNS, STANDARD_COLUMNS } from '@/lib/registry/asset-view';
import type { CustomFieldDef } from '@/lib/registry/types';

export interface ColumnsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: string[];
  fields: CustomFieldDef[];
  onChange: (columns: string[]) => void;
}

/**
 * Column picker (wireframe WEB-04): every standard column and every custom field, with Move up /
 * Move down buttons (no drag-only interaction) and a reset.
 */
export function ColumnsDialog({
  open,
  onOpenChange,
  columns,
  fields,
  onChange,
}: ColumnsDialogProps) {
  const t = useT();
  const [search, setSearch] = useState('');

  const all = useMemo(() => {
    const labelOf = (id: string) =>
      id.startsWith('cf:')
        ? (fields.find((f) => `cf:${f.key}` === id)?.label ?? id.slice(3))
        : t(`assets.columns.${id as (typeof STANDARD_COLUMNS)[number]}`);
    const ids = [
      ...columns,
      ...STANDARD_COLUMNS.filter((c) => !columns.includes(c)),
      ...fields
        .map((f) => `cf:${f.key}`)
        .filter((c, i, list) => !columns.includes(c) && list.indexOf(c) === i),
    ];
    return ids.map((id) => ({ id, label: labelOf(id), custom: id.startsWith('cf:') }));
  }, [columns, fields, t]);

  const q = search.trim().toLowerCase();
  const visible = all.filter((c) => !q || c.label.toLowerCase().includes(q));

  const toggle = (id: string, on: boolean) => {
    if (on) onChange([...columns, id]);
    else if (columns.length > 1) onChange(columns.filter((c) => c !== id));
  };
  const move = (id: string, delta: -1 | 1) => {
    const index = columns.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  const row = (c: (typeof all)[number]) => {
    const shown = columns.includes(c.id);
    const index = columns.indexOf(c.id);
    return (
      <li key={c.id} className="flex items-center justify-between gap-2">
        <Checkbox
          label={c.label}
          checked={shown}
          disabled={shown && columns.length === 1}
          onCheckedChange={(v) => toggle(c.id, v === true)}
        />
        {shown ? (
          <span className="flex gap-1">
            <IconButton
              icon={ArrowUp}
              size="icon-sm"
              label={t('assets.columnsDialog.moveUp', { name: c.label })}
              disabled={index === 0}
              onClick={() => move(c.id, -1)}
            />
            <IconButton
              icon={ArrowDown}
              size="icon-sm"
              label={t('assets.columnsDialog.moveDown', { name: c.label })}
              disabled={index === columns.length - 1}
              onClick={() => move(c.id, 1)}
            />
          </span>
        ) : null}
      </li>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assets.columnsDialog.title')}</DialogTitle>
          <DialogDescription>{t('assets.columnsDialog.description')}</DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          aria-label={t('assets.columnsDialog.search')}
          placeholder={t('assets.columnsDialog.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul
          aria-label={t('assets.columnsDialog.title')}
          className="flex max-h-72 flex-col gap-1 overflow-auto"
        >
          {visible.filter((c) => !c.custom).map(row)}
          {visible.some((c) => c.custom) ? (
            <li role="presentation" className="mt-2 text-xs font-semibold text-muted">
              {t('assets.columnsDialog.customFields')}
            </li>
          ) : null}
          {visible.filter((c) => c.custom).map(row)}
        </ul>
        <DialogFooter>
          <Button onClick={() => onChange([...DEFAULT_COLUMNS])}>
            {t('assets.columnsDialog.reset')}
          </Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            {t('common.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
