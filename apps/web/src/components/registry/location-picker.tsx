'use client';

import { useMemo } from 'react';
import { Combobox } from '@/components/ui/combobox';
import { useT } from '@/i18n';
import { ancestorNames, buildTree, subtreeIds, visibleRows } from '@/lib/registry/locations';
import { useLocations } from '@/lib/registry/queries';

export interface LocationPickerProps {
  /** The chosen location id, or '' for none. */
  value: string;
  onChange: (id: string) => void;
  /** Accessible name when the picker has no visible `<label htmlFor>` (filters, table cells). */
  'aria-label'?: string;
  'aria-describedby'?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Offer a clear button; leave off where a location is required. */
  clearable?: boolean;
  /** The location being moved: it and everything below it cannot be chosen (no cycles). */
  excludeSubtreeOf?: string;
  className?: string;
}

/**
 * Location picker (M2-LOC-04), reused by the asset form, the list filters, check-out / check-in and
 * the move dialog: type-ahead over name, code and path, keyboard selection, each option shows where
 * it sits ("Riverside Elementary > Main building"). Backed by the shared locations lookup.
 */
export function LocationPicker({
  value,
  onChange,
  excludeSubtreeOf,
  clearable = false,
  placeholder,
  ...rest
}: LocationPickerProps) {
  const t = useT();
  const locations = useLocations();
  const list = locations.data;

  const options = useMemo(() => {
    const all = list ?? [];
    const blocked = excludeSubtreeOf ? subtreeIds(all, excludeSubtreeOf) : new Set<string>();
    const rows = visibleRows(buildTree(all), () => true);
    return rows.map(({ node }) => {
      const location = node.location;
      const above = ancestorNames(all, location);
      return {
        value: location.id,
        label: location.code ? `${location.name} (${location.code})` : location.name,
        description: above || undefined,
        disabled: blocked.has(location.id),
      };
    });
  }, [list, excludeSubtreeOf]);

  return (
    <Combobox
      {...rest}
      options={options}
      value={value || null}
      loading={locations.isLoading}
      placeholder={placeholder ?? t('picker.locationPlaceholder')}
      emptyText={t('picker.noLocations')}
      loadingText={t('common.loading')}
      clearLabel={clearable ? t('picker.clearLocation') : undefined}
      onValueChange={(next) => onChange(next ?? '')}
    />
  );
}
