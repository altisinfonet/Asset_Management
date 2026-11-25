'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Combobox } from '@/components/ui/combobox';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { usersApi } from '@/lib/registry/api';
import { useRoles } from '@/lib/registry/queries';
import { useDebounced } from '@/lib/use-debounced';

/** What a picker needs to remember about the chosen login account. */
export interface UserRef {
  id: string;
  display_name: string;
  email: string;
}

export interface UserPickerProps {
  value: UserRef | null;
  onChange: (user: UserRef | null) => void;
  'aria-label'?: string;
  'aria-describedby'?: string;
  id?: string;
  autoFocus?: boolean;
  invalid?: boolean;
  disabled?: boolean;
}

/**
 * Login-account picker (M2-USR-03): type-ahead against `GET /v1/users?q=` (debounced, first 15; the
 * search matches the name and the e-mail). The second line is what tells two accounts of the same name
 * apart: the e-mail, the role names, and "pending invitation" for accounts that have not signed in yet.
 */
export function UserPicker({ value, onChange, ...rest }: UserPickerProps) {
  const t = useT();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 200);

  const users = useQuery({
    queryKey: ['user-picker', q],
    queryFn: () => usersApi.list({ limit: 15, sort: ['display_name'], ...(q ? { q } : {}) }),
    enabled: open && can('user:read'),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const roles = useRoles();
  const roleName = useMemo(
    () => new Map((roles.data ?? []).map((r) => [r.id, r.name])),
    [roles.data],
  );

  const byId = useMemo(() => new Map((users.data?.data ?? []).map((u) => [u.id, u])), [users.data]);
  const options = useMemo(
    () =>
      (users.data?.data ?? []).map((u) => {
        const names = [
          ...new Set(u.role_assignments.map((a) => roleName.get(a.role_id)).filter(Boolean)),
        ].join(', ');
        const pending = u.status === 'invited' ? `(${t('loginLink.invited')})` : '';
        return {
          value: u.id,
          label: u.display_name,
          description: [u.email, names, pending].filter(Boolean).join(' - '),
        };
      }),
    [users.data, roleName, t],
  );

  return (
    <Combobox
      {...rest}
      options={options}
      value={value?.id ?? null}
      selectedLabel={value ? `${value.display_name} (${value.email})` : undefined}
      loading={users.isFetching}
      stale={users.isPlaceholderData || query.trim() !== q}
      placeholder={t('loginLink.loginPlaceholder')}
      emptyText={t('loginLink.noLogin')}
      loadingText={t('common.loading')}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      onQueryChange={setQuery}
      onValueChange={(id) => {
        const user = id ? byId.get(id) : undefined;
        onChange(user ? { id: user.id, display_name: user.display_name, email: user.email } : null);
      }}
    />
  );
}
