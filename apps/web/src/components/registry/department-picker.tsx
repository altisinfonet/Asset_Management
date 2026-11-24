'use client';

import { useMemo } from 'react';
import { Combobox } from '@/components/ui/combobox';
import { useT } from '@/i18n';
import { useDepartments } from '@/lib/registry/queries';

export interface DepartmentPickerProps {
  /** The chosen department id, or '' for none. */
  value: string;
  onChange: (id: string) => void;
  /** Accessible name when the picker has no visible `<label htmlFor>` (filters, table cells). */
  'aria-label'?: string;
  'aria-describedby'?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  /** Offer a clear button; leave off where a department is required. */
  clearable?: boolean;
  /** Name to show when the chosen department is not in the live list (an archived one). */
  selectedLabel?: string;
  /** A department that cannot be chosen (the one being merged away). */
  excludeId?: string;
  className?: string;
}

/**
 * Department picker (ED-17), reused by the person form, the asset form, the bulk edit, the list
 * filters and the merge dialog: type-ahead over name and code (the code and the manager sit on the
 * second line), keyboard selection. Backed by the shared departments lookup, so a department is
 * chosen from the managed list and never typed.
 */
export function DepartmentPicker({
  value,
  onChange,
  clearable = false,
  excludeId,
  selectedLabel,
  placeholder,
  ...rest
}: DepartmentPickerProps) {
  const t = useT();
  const departments = useDepartments();

  const options = useMemo(
    () =>
      (departments.data ?? [])
        .filter((d) => d.id !== excludeId)
        .map((d) => ({
          value: d.id,
          label: d.name,
          description: [d.code, d.manager_name].filter(Boolean).join(' - ') || undefined,
        })),
    [departments.data, excludeId],
  );

  return (
    <Combobox
      {...rest}
      options={options}
      value={value || null}
      selectedLabel={selectedLabel}
      loading={departments.isLoading}
      placeholder={placeholder ?? t('picker.departmentPlaceholder')}
      emptyText={t('picker.noDepartments')}
      loadingText={t('common.loading')}
      clearLabel={clearable ? t('picker.clearDepartment') : undefined}
      onValueChange={(next) => onChange(next ?? '')}
    />
  );
}
