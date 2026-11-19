'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Combobox } from '@/components/ui/combobox';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { peopleApi } from '@/lib/registry/api';
import type { Person } from '@/lib/registry/types';
import { useDebounced } from '@/lib/use-debounced';

/** What a picker needs to remember about the chosen person (no extra fetch to show the name). */
export interface PersonRef {
  id: string;
  display_name: string;
}

export interface PersonPickerProps {
  value: PersonRef | null;
  onChange: (person: PersonRef | null) => void;
  'aria-label'?: string;
  'aria-describedby'?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  clearable?: boolean;
  /** Also offer inactive people (filters); assignees must be active, so check-out leaves it off. */
  includeInactive?: boolean;
  className?: string;
}

const describe = (person: Person): string =>
  [person.email, person.department, person.employee_ref].filter(Boolean).join(' - ');

/**
 * Person picker (M2-USR-02): type-ahead against `GET /v1/people?q=` (debounced, first 15 matches),
 * keyboard selection, shows e-mail / department / number under each name. Used by the check-out and
 * transfer dialogs and by the asset list's "assigned to" filter.
 */
export function PersonPicker({
  value,
  onChange,
  clearable = false,
  includeInactive = false,
  placeholder,
  ...rest
}: PersonPickerProps) {
  const t = useT();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 200);

  const people = useQuery({
    queryKey: ['people-picker', q, includeInactive],
    queryFn: ({ signal }) =>
      peopleApi.list(
        {
          limit: 15,
          sort: ['display_name'],
          ...(q ? { q } : {}),
          ...(includeInactive ? {} : { status: 'active' as const }),
        },
        signal,
      ),
    enabled: open && can('person:read'),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const options = useMemo(
    () =>
      (people.data?.data ?? []).map((person) => ({
        value: person.id,
        label: person.display_name,
        description: describe(person) || undefined,
      })),
    [people.data],
  );

  return (
    <Combobox
      {...rest}
      options={options}
      value={value?.id ?? null}
      selectedLabel={value?.display_name}
      loading={people.isFetching}
      stale={people.isPlaceholderData || query.trim() !== q}
      placeholder={placeholder ?? t('picker.personPlaceholder')}
      emptyText={q ? t('picker.noPeopleMatch', { query: q }) : t('picker.noPeople')}
      loadingText={t('common.loading')}
      clearLabel={clearable ? t('picker.clearPerson') : undefined}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      onQueryChange={setQuery}
      onValueChange={(id, option) =>
        onChange(id && option ? { id, display_name: option.label } : null)
      }
    />
  );
}
