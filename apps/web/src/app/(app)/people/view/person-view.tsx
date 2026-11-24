'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, KeyRound, LogIn, Pencil, UserX } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { useCustody } from '@/components/custody/custody-provider';
import { AssetStatusBadge } from '@/components/registry/asset-details';
import { LinkLoginDialog, UnlinkDialog } from '@/components/registry/login-link-dialogs';
import { HistoryEventItem } from '@/components/registry/history-timeline';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { BulkActionBar, DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { availableActions, isOverdue } from '@/lib/custody/helpers';
import { assetsApi, peopleApi, usersApi } from '@/lib/registry/api';
import { useLookups } from '@/lib/registry/queries';
import type { Asset, Assignment, HistoryEvent, Person } from '@/lib/registry/types';
import { routes } from '@/lib/routes';
import { PersonFormDialog } from '../person-form';
import { PersonArchiveDialog } from './person-archive-dialog';

const TABS = ['overview', 'assets', 'history'] as const;
type Tab = (typeof TABS)[number];

/**
 * A person (M2-USR-02), on the query-string route `/people/view?id=<uuid>`: details, the assets
 * they hold right now (check one or all in from here) and every custody period they had. Tabs are
 * URL-addressable (`?tab=assets`).
 */
export function PersonView() {
  const { t } = useI18n();
  const params = useSearchParams();
  const id = params.get('id');
  if (!id) {
    return (
      <>
        <PageTitle title={t('personView.title')} />
        <EmptyState
          headingLevel="h1"
          icon={UserX}
          title={t('personView.noneSelected')}
          description={t('personView.noneSelectedHint')}
          actions={
            <Button asChild variant="primary">
              <Link href={routes.people}>{t('personView.backToList')}</Link>
            </Button>
          }
        />
      </>
    );
  }
  return <PersonById id={id} />;
}

function PersonById({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const lookups = useLookups();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const tabParam = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as Tab)
    : 'overview';

  const person = useQuery({
    queryKey: ['person', id],
    queryFn: () => peopleApi.get(id),
    retry: false,
  });
  const loginUserId = person.data?.value.user_id ?? null;
  const loginUser = useQuery({
    queryKey: ['users', 'one', loginUserId],
    queryFn: () => usersApi.get(loginUserId!),
    enabled: loginUserId !== null && can('user:read'),
    retry: false,
  });
  const loginEmail = loginUser.data?.value.email;
  const held = useQuery({
    queryKey: ['person-held', id],
    queryFn: () =>
      assetsApi.list({
        assigned_person_id: id,
        limit: 100,
        sort: ['asset_tag'],
        include_total: true,
      }),
    enabled: person.isSuccess,
  });

  if (person.isLoading) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <PageTitle title={t('personView.title')} />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full max-w-3xl" />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }
  if (person.error || !person.data) {
    const ui = getApi().toUiError(person.error);
    const missing = ui.kind === 'not_found' || ui.kind === 'forbidden';
    return missing ? (
      <>
        <PageTitle title={t('personView.notFoundTitle')} />
        <EmptyState
          headingLevel="h1"
          icon={UserX}
          title={<span data-testid="person-not-found">{t('personView.notFoundTitle')}</span>}
          description={t('personView.notFoundHint')}
          actions={
            <Button asChild variant="primary">
              <Link href={routes.people}>{t('personView.backToList')}</Link>
            </Button>
          }
        />
      </>
    ) : (
      <Banner
        tone="danger"
        title={t('personView.loadFailed')}
        action={<Button onClick={() => void person.refetch()}>{t('common.retry')}</Button>}
      >
        {t(ui.messageKey)}
      </Banner>
    );
  }

  const { value, etag } = person.data;
  const manage = can('person:manage');
  const refresh = async () => {
    await Promise.all(
      ['person', 'people', 'person-held', 'person-history', 'person-returned'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
  };
  const setTab = (next: string) => {
    const query = new URLSearchParams(params.toString());
    if (next === 'overview') query.delete('tab');
    else query.set('tab', next);
    router.replace(`/people/view?${query.toString()}`);
  };
  const heldCount = held.data?.page.total ?? held.data?.data.length;
  const manageLogins = can('user:manage') && !value.archived_at;

  return (
    <>
      <PageTitle title={value.display_name} />
      <p className="sr-only">
        <span data-testid="person-id">{id}</span>
      </p>
      <PageHeader
        title={<span data-testid="person-name">{value.display_name}</span>}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t(`people.kinds.${value.kind ?? 'employee'}`)}</span>
            <Badge tone={value.status === 'inactive' ? 'neutral' : 'success'}>
              {t(`people.status.${value.status ?? 'active'}`)}
            </Badge>
            {value.user_id ? (
              <Badge tone="primary" icon={KeyRound}>
                {t('people.login.linked')}
              </Badge>
            ) : null}
            {value.archived_at ? (
              <span className="font-medium text-warning-text">{t('personView.archivedBadge')}</span>
            ) : null}
          </span>
        }
        actions={
          manage && !value.archived_at ? (
            <>
              <Button onClick={() => setEditing(true)}>
                <Pencil aria-hidden className="size-4" />
                {t('common.edit')}
              </Button>
              <Button onClick={() => setArchiving(true)}>
                <Archive aria-hidden className="size-4" />
                {t('common.archive')}
              </Button>
            </>
          ) : null
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('personView.tabsLabel')}>
          <TabsTrigger value="overview">{t('personView.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="assets" count={heldCount}>
            {t('personView.tabs.assets')}
          </TabsTrigger>
          <TabsTrigger value="history">{t('personView.tabs.history')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview
            person={value}
            locationLabel={lookups.locationLabel(value.location_id)}
            onLink={manageLogins ? () => setLinking(true) : undefined}
            onUnlink={manageLogins ? () => setUnlinking(true) : undefined}
            loginEmail={loginEmail}
          />
        </TabsContent>
        <TabsContent value="assets">
          <HeldAssets
            personName={value.display_name}
            assets={held.data?.data ?? []}
            loading={held.isLoading}
            error={held.error}
            onRetry={() => void held.refetch()}
            onDone={refresh}
          />
          <ReturnedAssets personId={id} personName={value.display_name} />
        </TabsContent>
        <TabsContent value="history">
          <PersonHistory personId={id} />
        </TabsContent>
      </Tabs>

      <PersonFormDialog
        open={editing}
        onOpenChange={setEditing}
        person={{ value, etag }}
        onSaved={async (saved) => {
          await refresh();
          toast({ variant: 'success', title: t('people.updated', { name: saved.display_name }) });
        }}
      />
      <LinkLoginDialog
        open={linking}
        onOpenChange={setLinking}
        person={{ id, display_name: value.display_name, etag }}
        onDone={async (login) => {
          await refresh();
          toast({
            variant: 'success',
            title: t('loginLink.linked', { person: value.display_name, login: login.email }),
          });
        }}
      />
      <UnlinkDialog
        open={unlinking}
        onOpenChange={setUnlinking}
        person={{ id, display_name: value.display_name, etag }}
        loginLabel={loginEmail}
        onDone={async () => {
          await refresh();
          toast({
            variant: 'success',
            title: t('loginLink.unlinked', { person: value.display_name }),
          });
        }}
      />
      <PersonArchiveDialog
        open={archiving}
        onOpenChange={setArchiving}
        person={{ value, etag }}
        onDone={async (outcome) => {
          await refresh();
          toast({
            variant: 'success',
            title: t(outcome === 'archived' ? 'personView.archived' : 'personView.deactivated', {
              name: value.display_name,
            }),
          });
          if (outcome === 'archived') router.replace(routes.people);
        }}
      />
    </>
  );
}

function Overview({
  person,
  locationLabel,
  onLink,
  onUnlink,
  loginEmail,
}: {
  person: Person;
  locationLabel: string;
  /** Administrators only (`user:manage`): undefined hides the buttons. */
  onLink?: (() => void) | undefined;
  onUnlink?: (() => void) | undefined;
  loginEmail?: string | undefined;
}) {
  const { t } = useI18n();
  const { can } = useAuth();
  const rows: Array<[string, ReactNode]> = [
    [t('people.form.email'), person.email],
    [t('people.form.phone'), person.phone],
    [
      t('people.form.employeeRef'),
      person.employee_ref ? <span className="font-tag">{person.employee_ref}</span> : null,
    ],
    [
      t('people.form.department'),
      person.department_id && person.department ? (
        <Link
          href={routes.peopleInDepartment(person.department_id)}
          className="rounded-sm text-primary-text underline underline-offset-2"
        >
          {person.department}
        </Link>
      ) : null,
    ],
    [t('people.form.jobTitle'), person.job_title],
    [t('people.form.location'), locationLabel],
    [
      t('people.columns.login'),
      person.user_id ? (
        <span className="flex flex-wrap items-center gap-2">
          {t('people.login.canSignIn')}
          {loginEmail ? <span className="font-tag text-muted">{loginEmail}</span> : null}
          {can('user:read') ? (
            <Link
              href={routes.settings('users')}
              className="rounded-sm text-primary-text underline underline-offset-2"
            >
              {t('people.login.manage')}
            </Link>
          ) : null}
          {onUnlink ? (
            <Button size="sm" onClick={onUnlink}>
              {t('loginLink.unlink')}
            </Button>
          ) : null}
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          {t('people.login.none')}
          {onLink ? (
            <Button size="sm" onClick={onLink}>
              {t('loginLink.link')}
            </Button>
          ) : null}
        </span>
      ),
    ],
    [t('people.form.notes'), person.notes],
  ];
  return (
    <dl className="grid max-w-3xl grid-cols-[minmax(7rem,10rem)_1fr] gap-x-3 gap-y-2 text-base">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="min-w-0 break-words">
            {value || <span className="text-muted">{'-'}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function HeldAssets({
  personName,
  assets,
  loading,
  error,
  onRetry,
  onDone,
}: {
  personName: string;
  assets: Asset[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onDone: () => Promise<void>;
}) {
  const { t, formatDate } = useI18n();
  const { can } = useAuth();
  const custody = useCustody();
  const lookups = useLookups();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const columns = useMemo<DataTableColumn<Asset>[]>(
    () => [
      {
        id: 'tag',
        header: t('assets.columns.tag'),
        mono: true,
        sticky: true,
        cell: (row) => (
          <Link
            href={routes.assetView(row.id)}
            onClick={(event) => event.stopPropagation()}
            className="rounded-sm text-primary-text underline underline-offset-2"
          >
            {row.asset_tag}
          </Link>
        ),
      },
      { id: 'name', header: t('assets.columns.name'), cell: (row) => row.name ?? '' },
      {
        id: 'status',
        header: t('assets.columns.status'),
        cell: (row) => <AssetStatusBadge asset={row} lookups={lookups} />,
      },
      {
        id: 'due',
        header: t('assets.columns.due'),
        cell: (row) => {
          const due = row.current_assignment?.expected_return;
          return (
            <span className="inline-flex items-center gap-2">
              {due ? formatDate(`${due}T00:00:00Z`, { timeZone: 'UTC' }) : ''}
              {isOverdue(row.current_assignment) ? <StatusBadge type="overdue" /> : null}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: t('common.actions'),
        srOnlyHeader: true,
        cell: (row) =>
          availableActions(row, can).includes('checkin') ? (
            <Button
              size="sm"
              aria-label={t('personView.checkInNamed', { tag: row.asset_tag })}
              onClick={() => custody.open({ assets: [row], action: 'checkin', onDone })}
            >
              <LogIn aria-hidden className="size-4" />
              {t('custody.tabs.checkin')}
            </Button>
          ) : null,
      },
    ],
    [t, formatDate, lookups, can, custody, onDone],
  );

  if (error && assets.length === 0) {
    return (
      <Banner tone="danger" action={<Button onClick={onRetry}>{t('common.retry')}</Button>}>
        {t('common.loadFailed')}
      </Banner>
    );
  }
  const selectedAssets = assets.filter((asset) => selected.has(asset.id));
  return (
    <div className="flex flex-col gap-3">
      <DataTable
        label={t('personView.heldLabel', { name: personName })}
        columns={columns}
        rows={assets}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.asset_tag}
        selectable={can('asset:checkin')}
        selectedIds={selected}
        onSelectedIdsChange={setSelected}
        loading={loading}
        empty={<EmptyState title={t('personView.holdsNothing', { name: personName })} />}
      />
      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button
          size="sm"
          onClick={() =>
            custody.open({
              assets: selectedAssets,
              action: 'checkin',
              onDone: async () => {
                setSelected(new Set());
                await onDone();
              },
            })
          }
        >
          <LogIn aria-hidden className="size-4" />
          {t('assets.bulk.checkIn', { count: selectedAssets.length })}
        </Button>
      </BulkActionBar>
    </div>
  );
}

/**
 * What the person handed back: the closed custody periods (`GET /v1/people/{id}/assignments?state=closed`).
 * The rows carry the asset's tag and name, the condition it came back in and the check-in note, so
 * no asset is fetched per row.
 */
function ReturnedAssets({ personId, personName }: { personId: string; personName: string }) {
  const { t, formatDateTime } = useI18n();
  const returned = useInfiniteQuery({
    queryKey: ['person-returned', personId],
    queryFn: ({ pageParam }) =>
      peopleApi.assignments(personId, { state: 'closed', cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.has_more ? (last.page.next_cursor ?? undefined) : undefined,
  });
  const rows: Assignment[] = returned.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <section
      aria-labelledby="person-returned-heading"
      className="mt-6 flex max-w-3xl flex-col gap-2"
    >
      <h2 id="person-returned-heading" className="text-lg font-semibold">
        {t('personView.returnedSection')}
      </h2>
      {returned.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : returned.error ? (
        <Banner
          tone="danger"
          action={<Button onClick={() => void returned.refetch()}>{t('common.retry')}</Button>}
        >
          {t('common.loadFailed')}
        </Banner>
      ) : rows.length === 0 ? (
        <p className="text-base text-muted">{t('personView.noReturned')}</p>
      ) : (
        <ul
          aria-label={t('personView.returnedLabel', { name: personName })}
          className="flex flex-col divide-y divide-border"
        >
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-0.5 py-3">
              <p className="flex flex-wrap items-baseline gap-x-2 text-base">
                {row.asset_id ? (
                  <>
                    <Link
                      href={routes.assetView(row.asset_id)}
                      className="rounded-sm font-tag text-primary-text underline underline-offset-2"
                    >
                      {row.asset_tag ?? row.asset_id.slice(0, 8)}
                    </Link>
                    <span>{row.asset_name ?? ''}</span>
                  </>
                ) : (
                  t('personView.accessory', { count: row.quantity })
                )}
              </p>
              <p className="text-sm text-muted">
                {t('personView.returnedRow', {
                  out: formatDateTime(row.checked_out_at),
                  back: row.checked_in_at ? formatDateTime(row.checked_in_at) : '',
                })}
              </p>
              {row.checkin_condition ? (
                <p className="text-sm text-muted">
                  {t('personView.conditionNote', {
                    condition: t(`custody.conditions.${row.checkin_condition}`),
                  })}
                </p>
              ) : null}
              {row.checkin_note ? (
                <p className="break-words text-sm text-muted">{`“${row.checkin_note}”`}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {returned.hasNextPage ? (
        <div>
          <Button
            loading={returned.isFetchingNextPage}
            onClick={() => void returned.fetchNextPage()}
          >
            {t('assetView.loadMore')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Everything that happened to what this person held (`GET /v1/people/{id}/history`), newest first. */
function PersonHistory({ personId }: { personId: string }) {
  const { t } = useI18n();
  const history = useInfiniteQuery({
    queryKey: ['person-history', personId],
    queryFn: ({ pageParam }) => peopleApi.history(personId, { cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.has_more ? (last.page.next_cursor ?? undefined) : undefined,
  });
  const events: HistoryEvent[] = history.data?.pages.flatMap((page) => page.data) ?? [];

  if (history.isLoading) return <Skeleton className="h-24 w-full max-w-3xl" />;
  if (history.error) {
    return (
      <Banner
        tone="danger"
        action={<Button onClick={() => void history.refetch()}>{t('common.retry')}</Button>}
      >
        {t('common.loadFailed')}
      </Banner>
    );
  }
  if (events.length === 0) {
    return <p className="text-base text-muted">{t('personView.noHistory')}</p>;
  }
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <ol
        aria-label={t('personView.tabs.history')}
        className="flex flex-col divide-y divide-border"
      >
        {events.map((event) => (
          <HistoryEventItem key={event.id} event={event} showAsset />
        ))}
      </ol>
      {history.hasNextPage ? (
        <div>
          <Button loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
            {t('assetView.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
