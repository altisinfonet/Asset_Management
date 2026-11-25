'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { FormDialog, type FormFieldSpec, type FormValues } from '@/components/registry/form-dialog';
import { LocationPicker } from '@/components/registry/location-picker';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { useLookups } from '@/lib/registry/queries';
import {
  accessoriesApi,
  consumablesApi,
  type Accessory,
  type Consumable,
  type StockKind,
} from '@/lib/stock/api';
import { parseCount } from '@/lib/stock/helpers';
import { useStockCategories } from './stock-parts';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export type StockItem =
  | { kind: 'accessory'; value: Accessory; etag: string | undefined }
  | { kind: 'consumable'; value: Consumable; etag: string | undefined };

/**
 * Create or edit an accessory or a consumable (M2-ACC-04). A new consumable can start with a
 * quantity on hand (recorded as the first "receive" of its history); the quantity of an existing
 * one changes only through stock movements, and an accessory's total only through its form.
 */
export function StockFormDialog({
  open,
  onOpenChange,
  kind,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: StockKind;
  /** The item being edited; none creates a new one. */
  item?: StockItem;
  onSaved?: (id: string) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const lookups = useLookups();
  const categories = useStockCategories(kind);
  const editing = !!item;
  const current = item?.value;
  const scoped = !!useAuth().locationScope;

  const fields = useMemo<FormFieldSpec[]>(() => {
    const list: FormFieldSpec[] = [
      { name: 'name', label: t('stockForm.name'), kind: 'text', required: true },
      {
        name: 'category_id',
        label: t('stockForm.category'),
        kind: 'select',
        required: true,
        hint:
          categories.data && categories.data.length === 0
            ? t('stockForm.noCategories')
            : t('stockForm.categoryHint'),
        options: (categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
      },
    ];
    if (kind === 'accessory') {
      list.push({
        name: 'qty_total',
        label: t('stockForm.qtyTotal'),
        kind: 'number',
        required: true,
        min: 0,
        hint: t('stockForm.qtyTotalHint'),
      });
    } else {
      if (!editing) {
        list.push({
          name: 'initial_qty',
          label: t('stockForm.initialQty'),
          kind: 'number',
          min: 0,
          hint: t('stockForm.initialQtyHint'),
        });
      }
      list.push({
        name: 'unit',
        label: t('stockForm.unit'),
        kind: 'text',
        hint: t('stockForm.unitHint'),
      });
    }
    list.push(
      {
        name: 'min_qty',
        label: t('stockForm.minQty'),
        kind: 'number',
        min: 0,
        hint: t('stockForm.minQtyHint'),
      },
      {
        name: 'location_id',
        label: t('stockForm.location'),
        kind: 'custom',
        // M2-LOC-03: a location-scoped user keeps stock inside the scope (the API refuses none)
        required: scoped,
        hint: scoped ? t('locationScope.requiredHint') : undefined,
        render: ({ control, value, set, invalid }) => (
          <LocationPicker
            {...control}
            invalid={invalid}
            clearable={!scoped}
            value={String(value)}
            onChange={set}
            placeholder={scoped ? undefined : t('stockForm.none')}
          />
        ),
      },
      {
        name: 'manufacturer_id',
        label: t('stockForm.manufacturer'),
        kind: 'select',
        emptyLabel: t('stockForm.none'),
        options: lookups.manufacturers.map((m) => ({ value: m.id, label: m.name })),
      },
      {
        name: 'vendor_id',
        label: t('stockForm.vendor'),
        kind: 'select',
        emptyLabel: t('stockForm.none'),
        options: lookups.vendors.map((v) => ({ value: v.id, label: v.name })),
      },
      { name: 'model_number', label: t('stockForm.modelNumber'), kind: 'text', mono: true },
    );
    if (kind === 'accessory') {
      list.push({ name: 'purchase_date', label: t('stockForm.purchaseDate'), kind: 'date' });
    }
    list.push({ name: 'notes', label: t('stockForm.notes'), kind: 'textarea' });
    return list;
  }, [t, kind, editing, categories.data, lookups.manufacturers, lookups.vendors, scoped]);

  const initial = useMemo<FormValues>(
    () => ({
      name: current?.name ?? '',
      category_id: current?.category_id ?? '',
      qty_total:
        kind === 'accessory' ? String((current as Accessory | undefined)?.qty_total ?? 0) : '',
      initial_qty: '0',
      unit: kind === 'consumable' ? ((current as Consumable | undefined)?.unit ?? 'each') : '',
      min_qty: String(current?.min_qty ?? 0),
      location_id: current?.location_id ?? '',
      manufacturer_id: current?.manufacturer_id ?? '',
      vendor_id: current?.vendor_id ?? '',
      model_number: current?.model_number ?? '',
      purchase_date:
        kind === 'accessory' ? ((current as Accessory | undefined)?.purchase_date ?? '') : '',
      notes: current?.notes ?? '',
    }),
    [current, kind],
  );

  const submit = async (values: FormValues) => {
    const name = text(values.name);
    const count = (key: string) => parseCount(String(values[key] ?? '')) ?? 0;
    const common = {
      name,
      category_id: String(values.category_id),
      min_qty: count('min_qty'),
      location_id: text(values.location_id) || null,
      manufacturer_id: text(values.manufacturer_id) || null,
      vendor_id: text(values.vendor_id) || null,
      model_number: text(values.model_number) || null,
      notes: text(values.notes) || null,
    };
    let id: string;
    if (kind === 'accessory') {
      const body = {
        ...common,
        qty_total: count('qty_total'),
        purchase_date: text(values.purchase_date) || null,
      };
      const saved = item
        ? await accessoriesApi.update(item.value.id, body, item.etag)
        : await accessoriesApi.create(body);
      id = saved.value.id;
    } else {
      const unit = text(values.unit) || 'each';
      const saved = item
        ? await consumablesApi.update(item.value.id, { ...common, unit }, item.etag)
        : await consumablesApi.create({ ...common, unit, initial_qty: count('initial_qty') });
      id = saved.value.id;
    }
    await client.invalidateQueries({ queryKey: ['stock'] });
    toast({
      variant: 'success',
      title: editing ? t('stockForm.saved', { name }) : t('stockForm.created', { name }),
    });
    onSaved?.(id);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={
        editing
          ? t('stockForm.editTitle', { name: current?.name ?? '' })
          : kind === 'accessory'
            ? t('stockForm.createTitle.accessory')
            : t('stockForm.createTitle.consumable')
      }
      fields={fields}
      initial={initial}
      submitLabel={editing ? t('stockForm.save') : t('stockForm.create')}
      onSubmit={submit}
    />
  );
}
