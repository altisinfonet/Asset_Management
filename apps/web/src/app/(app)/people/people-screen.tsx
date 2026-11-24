'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, KeyRound, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { DepartmentPicker } from '@/components/registry/department-picker';
import { ExportButton } from '@/components/exports/export-button';
import { PageTitle } from '@/components/page-title';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn, type SortState } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { peopleApi, type PeopleQuery } from '@/lib/registry/api';
import { useLookups } from '@/lib/registry/queries';
import { PERSON_KINDS, type Person } from '@/lib/registry/types';
import { routes } from '@/lib/routes';
import { useDebounced } from '@/lib/use-debounced';
import { PersonFormDialog } from './person-form';

const ALL = '__all__';
const PAGE_SIZE = 50;

interface ListState {
  q: string;
  status: string;
  kind: string;
  login: string;
  /** A department id (`?department=` of the department's people count and the person page). */
  department_id: string;
  sort: string;
}

const DEFAULT_STATE: ListState = {
  q: '',
  status: 'active',
  kind: '',
  login: '',
  department_id: '',
  sort: '',
};

const SORT_BY_COLUMN: Record<string, string> = {
  name: 'display_name',
  employee_ref: 'employee_ref',
};

function toQuery(state: ListState, cursor: string | undefined): PeopleQuery {
  const query: PeopleQuery = { limit: PAGE_SIZE, include_total: true };
  if (cursor) query.cursor = cursor;
  if (state.q.trim()) query.q = state.q.trim();
  if (state.status) query.status = state.status as 'active' | 'inactive';
  if (state.kind) query.kind = [state.kind as (typeof PERSON_KINDS)[number]];
  if (state.login) query.has_login = state.login === 'with';
  if (state.department_id) query.department_id = state.department_id;
  if (state.sort) query.sort = [state.sort as NonNullable<PeopleQuery['sort']>[number]];
  return query;
}

/**
 * People (M2-USR-02): everyone who can be handed an asset, with or without a login. Server-side
 * search, filters (status, kind, login) and sort with cursor pagination; a row opens the person's
 * page with what they hold. Writes need `person:manage`.
 */
export function PeopleScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const lookups = useLookups();
  const manage = can('person:manage');

  const params = useSearchParams();
  const [state, setState] = useState<ListState>(() => ({
    ...DEFAULT_STATE,
    department_id: params.get('department') ?? '',
  }));
  const [searchText, setSearchText] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const update = (patch: Partial<ListState>) => {
    setState((current) => ({ ...current, ...patch }));
    setCursors([]);
  };
  const debounced = useDebounced(searchText, 300);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- debounced text drives the query
    setState((current) => (current.q === debounced ? current : { ...current, q: debounced }));
    setCursors([]);
  }, [debounced]);

  const cursor = cursors[cursors.length - 1];
  const query = toQuery(state, cursor);
  const list = useQuery({
    queryKey: ['people', 'list', query],
    queryFn: () => peopleApi.list(query),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => list.data?.data ?? [], [list.data]);
  const total = list.data?.page.total;
  const pageStart = cursors.length * PAGE_SIZE;

  const filtered = !!(
    state.q ||
    state.kind ||
    state.login ||
    state.department_id ||
    state.status !== 'active'
  );

  const columns = useMemo<DataTableColumn<Person>[]>(
    () => [
      {
        id: 'name',
        header: t('people.columns.name'),
        sortable: true,
        sticky: true,
        cell: (row) => (
          <Link
            href={routes.personView(row.id)}
            onClick={(event) => event.stopPropagation()}
            className="rounded-sm text-primary-text underline underline-offset-2"
          >
            {row.display_name}
          </Link>
        ),
      },
      { id: 'email', header: t('people.columns.email'), cell: (row) => row.email ?? '' },
      {
        id: 'kind',
        header: t('people.columns.kind'),
        cell: (row) => t(`people.kinds.${row.kind ?? 'employee'}`),
      },
      {
        id: 'department',
        header: t('people.columns.department'),
        cell: (row) => row.department ?? '',
      },
      {
        id: 'employee_ref',
        header: t('people.columns.employeeRef'),
        mono: true,
        sortable: true,
        cell: (row) => row.employee_ref ?? '',
      },
      {
        id: 'location',
        header: t('people.columns.location'),
        cell: (row) => lookups.locationLabel(row.location_id),
      },
      {
        id: 'login',
        header: t('people.columns.login'),
        cell: (row) =>
          row.user_id ? (
            <Badge tone="primary" icon={KeyRound}>
              {t('people.login.linked')}
            </Badge>
          ) : (
            <span className="text-muted">{t('people.login.none')}</span>
          ),
      },
      {
        id: 'status',
        header: t('people.columns.status'),
        cell: (row) => (
          <Badge tone={row.status === 'inactive' ? 'neutral' : 'success'}>
            {t(`people.status.${row.status ?? 'active'}`)}
          </Badge>
        ),
      },
    ],
    [t, lookups],
  );

  const sort: SortState | null = state.sort
    ? {
        columnId:
          Object.entries(SORT_BY_COLUMN).find(
            ([, key]) => key === state.sort.replace(/^-/, ''),
          )?.[0] ?? '',
        direction: state.sort.startsWith('-') ? 'desc' : 'asc',
      }
    : null;

  return (
    <>
      <PageTitle title={t('people.title')} />
      <PageHeader
        title={t('people.title')}
        description={t('people.description')}
        actions={
          <>
            <ExportButton resource="people" query={query} />
            {manage ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus aria-hidden className="size-4" />
                {t('people.add')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-medium">
            {t('people.search')}
            <Input
              type="search"
              value={searchText}
              placeholder={t('people.searchPlaceholder')}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </label>
          <label className="flex min-w-40 flex-col gap-1.5 text-sm font-medium">
            {t('people.filters.status')}
            <Select
              aria-label={t('people.filters.status')}
              value={state.status || ALL}
              onValueChange={(v) => update({ status: v === ALL ? '' : v })}
              options={[
                { value: 'active', label: t('people.status.active') },
                { value: 'inactive', label: t('people.status.inactive') },
                { value: ALL, label: t('people.filters.anyStatus') },
              ]}
            />
          </label>
          <label className="flex min-w-40 flex-col gap-1.5 text-sm font-medium">
            {t('people.filters.kind')}
            <Select
              aria-label={t('people.filters.kind')}
              value={state.kind || ALL}
              onValueChange={(v) => update({ kind: v === ALL ? '' : v })}
              options={[
                { value: ALL, label: t('people.filters.anyKind') },
                ...PERSON_KINDS.map((kind) => ({ value: kind, label: t(`people.kinds.${kind}`) })),
              ]}
            />
          </label>
          <label className="flex min-w-44 flex-col gap-1.5 text-sm font-medium">
            {t('people.filters.login')}
            <Select
              aria-label={t('people.filters.login')}
              value={state.login || ALL}
              onValueChange={(v) => update({ login: v === ALL ? '' : v })}
              options={[
                { value: ALL, label: t('people.filters.anyLogin') },
                { value: 'with', label: t('people.filters.withLogin') },
                { value: 'without', label: t('people.filters.withoutLogin') },
              ]}
            />
          </label>
          <div className="flex min-w-52 flex-col gap-1.5 text-sm font-medium">
            <label htmlFor="filter-department">{t('people.filters.department')}</label>
            <DepartmentPicker
              id="filter-department"
              clearable
              value={state.department_id}
              placeholder={t('people.filters.anyDepartment')}
              onChange={(id) => update({ department_id: id })}
            />
          </div>
          {filtered ? (
            <Button
              variant="link"
              onClick={() => {
                setSearchText('');
                setState(DEFAULT_STATE);
                setCursors([]);
              }}
            >
              {t('people.filters.clear')}
            </Button>
          ) : null}
        </div>

        {list.error && !list.data ? (
          <Banner
            tone="danger"
            action={<Button onClick={() => void list.refetch()}>{t('common.retry')}</Button>}
          >
            {t('people.loadFailed')}
          </Banner>
        ) : null}

        <DataTable
          label={t('people.tableLabel')}
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          getRowLabel={(row) => row.display_name}
          onRowClick={(row) => router.push(routes.personView(row.id))}
          onRowOpen={(row) => router.push(routes.personView(row.id))}
          sort={sort}
          onSortChange={(next) =>
            update({
              sort: next
                ? `${next.direction === 'desc' ? '-' : ''}${SORT_BY_COLUMN[next.columnId] ?? ''}`
                : '',
            })
          }
          loading={list.isLoading}
          className={list.isPlaceholderData ? 'opacity-60' : undefined}
          empty={
            filtered ? (
              <EmptyState
                icon={Users}
                title={t('people.noMatchTitle')}
                description={t('people.noMatchDescription')}
                actions={
                  <Button
                    onClick={() => {
                      setSearchText('');
                      setState(DEFAULT_STATE);
                    }}
                  >
                    {t('people.filters.clear')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Users}
                title={t('people.emptyTitle')}
                description={t('people.emptyDescription')}
                actions={
                  manage ? (
                    <Button variant="primary" onClick={() => setCreating(true)}>
                      <Plus aria-hidden className="size-4" />
                      {t('people.addFirst')}
                    </Button>
                  ) : undefined
                }
              />
            )
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-muted"
            data-testid="people-range"
          >
            {rows.length === 0
              ? ''
              : total !== undefined && total !== null
                ? t('people.range', { from: pageStart + 1, to: pageStart + rows.length, total })
                : t('people.rangeNoTotal', { from: pageStart + 1, to: pageStart + rows.length })}
          </p>
          <nav aria-label={t('people.pagination')} className="flex gap-2">
            <Button
              size="sm"
              disabled={cursors.length === 0}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              <ChevronLeft aria-hidden className="size-4" />
              {t('assets.previousPage')}
            </Button>
            <Button
              size="sm"
              disabled={!list.data?.page.has_more || !list.data.page.next_cursor}
              onClick={() => {
                const next = list.data?.page.next_cursor;
                if (next) setCursors((c) => [...c, next]);
              }}
            >
              {t('assets.nextPage')}
              <ChevronRight aria-hidden className="size-4" />
            </Button>
          </nav>
        </div>
      </div>

      <PersonFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={async (person) => {
          await client.invalidateQueries({ queryKey: ['people'] });
          toast({ variant: 'success', title: t('people.created', { name: person.display_name }) });
        }}
      />
    </>
  );
}
