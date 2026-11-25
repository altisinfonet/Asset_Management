'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, MapPin, Pencil, Plus, Archive } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AssetStatusBadge } from '@/components/registry/asset-details';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { FormDialog, type FormFieldSpec, type FormValues } from '@/components/registry/form-dialog';
import { LocationPicker } from '@/components/registry/location-picker';
import { LocationTree } from '@/components/registry/location-tree';
import { ExportButton } from '@/components/exports/export-button';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { uiErrorText } from '@/lib/error-text';
import { assetsApi, fetchAll, locationsApi } from '@/lib/registry/api';
import { buildTree, locationPathText, pruneTree, searchMatches } from '@/lib/registry/locations';
import { useLookups } from '@/lib/registry/queries';
import { LOCATION_KINDS, type Location, type LocationKind } from '@/lib/registry/types';
import { routes } from '@/lib/routes';

const LOCATIONS_KEY = ['locations', 'all'] as const;

type Dialog =
  | { kind: 'create'; parentId: string }
  | { kind: 'edit'; location: Location; etag: string | undefined }
  | { kind: 'move'; location: Location; etag: string | undefined }
  | { kind: 'archive'; location: Location };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** ISO 3166-1 alpha-2, what the API accepts for `address.country` (it stores it upper-case). */
const COUNTRY_CODE = /^[A-Za-z]{2}$/;

/**
 * Locations admin (WEB-12, M2-LOC-04): the hierarchy as a keyboard-operable tree with the asset
 * count of every node (including sublocations), a detail panel with add / rename / move / archive
 * and a link into the filtered asset list. Writes need `location:manage`; the API enforces it too.
 */
export function LocationsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const manage = can('location:manage');

  const [selectedId, setSelectedId] = useState<string | null>(params.get('id'));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const list = useQuery({
    queryKey: LOCATIONS_KEY,
    queryFn: () =>
      fetchAll<Location>((cursor) =>
        locationsApi.list({ limit: 200, cursor, sort: ['depth', 'name'] }),
      ),
  });
  const locations = useMemo(() => list.data ?? [], [list.data]);

  const filter = useMemo(() => searchMatches(locations, search), [locations, search]);
  const roots = useMemo(() => {
    const tree = buildTree(locations);
    return filter ? pruneTree(tree, filter.keep) : tree;
  }, [locations, filter]);
  // While searching, everything that leads to a match is open.
  const shownExpanded = useMemo<ReadonlySet<string>>(
    () => (filter ? filter.keep : expanded),
    [filter, expanded],
  );

  const selected = locations.find((l) => l.id === selectedId) ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    router.replace(routes.locations(id));
  };

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['locations'] }),
      client.invalidateQueries({ queryKey: ['lookup'] }),
      client.invalidateQueries({ queryKey: ['assets'] }),
    ]);
  };

  const openEdit = async (location: Location) => {
    try {
      const fresh = await locationsApi.get(location.id);
      setDialog({ kind: 'edit', location: fresh.value, etag: fresh.etag });
    } catch (err) {
      const ui = getApi().toUiError(err);
      toast({ variant: 'danger', title: uiErrorText(t, ui), requestId: ui.requestId });
    }
  };
  const openMove = async (location: Location) => {
    try {
      const fresh = await locationsApi.get(location.id);
      setDialog({ kind: 'move', location: fresh.value, etag: fresh.etag });
    } catch (err) {
      const ui = getApi().toUiError(err);
      toast({ variant: 'danger', title: uiErrorText(t, ui), requestId: ui.requestId });
    }
  };

  const add = (parentId: string) => setDialog({ kind: 'create', parentId });

  return (
    <>
      <PageTitle title={t('locations.title')} />
      <PageHeader
        title={t('locations.title')}
        description={t('locations.description')}
        actions={
          <>
            <ExportButton resource="locations" query={{}} />
            {manage ? (
              <Button variant="primary" onClick={() => add(selectedId ?? '')}>
                <Plus aria-hidden className="size-4" />
                {t('locations.add')}
              </Button>
            ) : null}
          </>
        }
      />

      {list.error && !list.data ? (
        <Banner
          tone="danger"
          action={<Button onClick={() => void list.refetch()}>{t('common.retry')}</Button>}
        >
          {t('locations.loadFailed')}
        </Banner>
      ) : list.isLoading ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-56" />
          <span className="sr-only">{t('common.loading')}</span>
        </div>
      ) : locations.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title={t('locations.emptyTitle')}
          description={t('locations.emptyDescription')}
          actions={
            manage ? (
              <Button variant="primary" onClick={() => add('')}>
                <Plus aria-hidden className="size-4" />
                {t('locations.addFirst')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
          <section aria-label={t('locations.treeSection')} className="flex min-w-0 flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t('locations.search')}
              <Input
                type="search"
                value={search}
                placeholder={t('locations.searchPlaceholder')}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {filter ? (
              <p role="status" aria-live="polite" className="text-sm text-muted">
                {filter.matches.size === 0
                  ? t('locations.noMatch', { query: search.trim() })
                  : t('locations.matches', { count: filter.matches.size })}
              </p>
            ) : (
              <p className="text-sm text-muted">{t('locations.keyboardHint')}</p>
            )}
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface p-1">
              <LocationTree
                label={t('locations.tree')}
                roots={roots}
                selectedId={selectedId}
                onSelect={select}
                expanded={shownExpanded}
                onExpandedChange={setExpanded}
                onRename={
                  manage
                    ? (id) => {
                        const target = locations.find((l) => l.id === id);
                        if (target) void openEdit(target);
                      }
                    : undefined
                }
                highlight={filter?.matches}
              />
            </div>
          </section>

          <section aria-label={t('locations.detailSection')} className="min-w-0">
            {selected ? (
              <LocationDetail
                location={selected}
                locations={locations}
                manage={manage}
                onAdd={() => add(selected.id)}
                onEdit={() => void openEdit(selected)}
                onMove={() => void openMove(selected)}
                onArchive={() => setDialog({ kind: 'archive', location: selected })}
                onSelect={select}
              />
            ) : (
              <p className="rounded-lg border border-dashed border-border p-6 text-base text-muted">
                {t('locations.selectHint')}
              </p>
            )}
          </section>
        </div>
      )}

      <LocationFormDialogs
        dialog={dialog}
        locations={locations}
        onClose={() => setDialog(null)}
        onReload={(location, as) => (as === 'move' ? openMove(location) : openEdit(location))}
        onDone={async (message, selectId) => {
          await refresh();
          if (selectId) {
            setSelectedId(selectId);
            router.replace(routes.locations(selectId));
          }
          toast({ variant: 'success', title: message });
        }}
        onArchived={async () => {
          await refresh();
          setSelectedId(null);
          router.replace(routes.locations());
          toast({ variant: 'success', title: t('locations.archived') });
        }}
      />
    </>
  );
}

// ---- detail -----------------------------------------------------------------------------------------

function LocationDetail({
  location,
  locations,
  manage,
  onAdd,
  onEdit,
  onMove,
  onArchive,
  onSelect,
}: {
  location: Location;
  locations: Location[];
  manage: boolean;
  onAdd: () => void;
  onEdit: () => void;
  onMove: () => void;
  onArchive: () => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const lookups = useLookups();
  const children = locations.filter((l) => l.parent_id === location.id);
  const parent = locations.find((l) => l.id === location.parent_id);
  const path = locationPathText(locations, location.id);
  const count = location.asset_count ?? 0;

  const here = useQuery({
    queryKey: ['assets', 'at-location', location.id],
    queryFn: () =>
      assetsApi.list({
        location_id: location.id,
        include_sublocations: true,
        limit: 8,
        sort: ['asset_tag'],
        include_total: true,
      }),
  });
  const total = here.data?.page.total ?? count;
  const address = [
    location.address?.line1,
    location.address?.line2,
    [location.address?.postal_code, location.address?.city].filter(Boolean).join(' '),
    location.address?.region,
    location.address?.country,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text" data-testid="location-name">
            {location.name}
          </h2>
          <p className="mt-1 text-base text-muted">{path}</p>
        </div>
        <Badge tone="neutral">{t(`locations.kinds.${location.kind ?? 'other'}`)}</Badge>
      </div>

      {manage ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onAdd}>
            <Plus aria-hidden className="size-4" />
            {t('locations.addChild')}
          </Button>
          <Button onClick={onEdit}>
            <Pencil aria-hidden className="size-4" />
            {t('locations.rename')}
          </Button>
          <Button onClick={onMove}>
            <ArrowRightLeft aria-hidden className="size-4" />
            {t('locations.move')}
          </Button>
          <Button onClick={onArchive}>
            <Archive aria-hidden className="size-4" />
            {t('common.archive')}
          </Button>
        </div>
      ) : null}

      <dl className="grid grid-cols-[minmax(7rem,9rem)_1fr] gap-x-3 gap-y-2 text-base">
        <dt className="text-muted">{t('locations.detail.type')}</dt>
        <dd>{t(`locations.kinds.${location.kind ?? 'other'}`)}</dd>
        {location.code ? (
          <>
            <dt className="text-muted">{t('locations.detail.code')}</dt>
            <dd className="font-tag">{location.code}</dd>
          </>
        ) : null}
        <dt className="text-muted">{t('locations.detail.inside')}</dt>
        <dd>{parent ? parent.name : t('locations.detail.topLevel')}</dd>
        <dt className="text-muted">{t('locations.detail.sublocations')}</dt>
        <dd>
          {children.length === 0 ? (
            t('locations.detail.none')
          ) : (
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {children.map((child) => (
                <li key={child.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(child.id)}
                    className="rounded-sm text-primary-text underline underline-offset-2"
                  >
                    {child.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </dd>
        {address ? (
          <>
            <dt className="text-muted">{t('locations.detail.address')}</dt>
            <dd>{address}</dd>
          </>
        ) : null}
        {location.notes ? (
          <>
            <dt className="text-muted">{t('locations.detail.notes')}</dt>
            <dd className="break-words">{location.notes}</dd>
          </>
        ) : null}
      </dl>

      <section aria-label={t('locations.detail.assetsHere')} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-muted">
            {t('locations.detail.assetsHereCount', { count: total })}
          </h3>
          {total > 0 ? (
            <Link
              href={routes.assetsFiltered({ location: location.id })}
              className="rounded-sm text-base text-primary-text underline underline-offset-2"
            >
              {t('locations.detail.viewInList')}
            </Link>
          ) : null}
        </div>
        {here.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : here.error ? (
          <Banner tone="danger">{t('common.loadFailed')}</Banner>
        ) : (here.data?.data ?? []).length === 0 ? (
          <p className="text-base text-muted">{t('locations.detail.noAssets')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {(here.data?.data ?? []).map((asset) => (
              <li key={asset.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <Link
                  href={routes.assetView(asset.id)}
                  className="rounded-sm font-tag text-primary-text underline underline-offset-2"
                >
                  {asset.asset_tag}
                </Link>
                <span className="min-w-0 flex-1 truncate">{asset.name ?? ''}</span>
                <AssetStatusBadge asset={asset} lookups={lookups} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---- dialogs ----------------------------------------------------------------------------------------

function LocationFormDialogs({
  dialog,
  locations,
  onClose,
  onReload,
  onDone,
  onArchived,
}: {
  dialog: Dialog | null;
  locations: Location[];
  onClose: () => void;
  /** Loads the latest version of a location and re-opens the edit dialog with it (after a 412). */
  onReload: (location: Location, dialog: 'edit' | 'move') => Promise<void>;
  onDone: (message: string, selectId?: string) => Promise<void>;
  onArchived: () => Promise<void>;
}) {
  const { t } = useI18n();
  // M2-LOC-03: a location-scoped user works below its scope roots, never at the top level
  const { locationScope } = useAuth();
  const scoped = !!locationScope;
  const onlyRoot =
    locationScope?.locations.length === 1 ? (locationScope.locations[0]?.id ?? '') : '';
  const kindOptions = LOCATION_KINDS.map((kind) => ({
    value: kind,
    label: t(`locations.kinds.${kind}`),
  }));
  const isSite = (values: FormValues) => values.kind === 'site';

  // The limits are the API's (`Location` schema); checking them here names the field and the limit
  // instead of leaving the person with a generic "the request failed validation".
  const baseFields: FormFieldSpec[] = [
    {
      name: 'name',
      label: t('locations.form.name'),
      kind: 'text',
      required: true,
      maxLength: 200,
    },
    {
      name: 'kind',
      label: t('locations.form.kind'),
      kind: 'select',
      options: kindOptions,
      required: true,
    },
    {
      name: 'code',
      label: t('locations.form.code'),
      kind: 'text',
      hint: t('locations.form.codeHint'),
      mono: true,
      maxLength: 100,
    },
    { name: 'notes', label: t('locations.form.notes'), kind: 'textarea', maxLength: 10_000 },
    {
      name: 'line1',
      label: t('locations.form.addressLine'),
      kind: 'text',
      visible: isSite,
      maxLength: 200,
      pointers: ['/address/line1'],
    },
    {
      name: 'line2',
      label: t('locations.form.addressLine2'),
      kind: 'text',
      visible: isSite,
      maxLength: 200,
      pointers: ['/address/line2'],
    },
    {
      name: 'city',
      label: t('locations.form.city'),
      kind: 'text',
      visible: isSite,
      maxLength: 100,
      pointers: ['/address/city'],
    },
    {
      name: 'region',
      label: t('locations.form.region'),
      kind: 'text',
      visible: isSite,
      maxLength: 100,
      pointers: ['/address/region'],
    },
    {
      name: 'postal_code',
      label: t('locations.form.postalCode'),
      kind: 'text',
      visible: isSite,
      maxLength: 40,
      pointers: ['/address/postal_code'],
    },
    {
      name: 'country',
      label: t('locations.form.country'),
      kind: 'text',
      hint: t('locations.form.countryHint'),
      visible: isSite,
      pointers: ['/address/country'],
      validate: (value) =>
        text(value) && !COUNTRY_CODE.test(text(value))
          ? t('locations.form.countryInvalid')
          : undefined,
    },
  ];

  /**
   * The address to send, or `undefined` to leave it as it is: only a site shows the address fields,
   * so changing a site to another type must not wipe the address it has (change it back and it is
   * still there). An address with every field emptied is cleared (`null`).
   */
  const addressOf = (values: FormValues) => {
    if (!isSite(values)) return undefined;
    const address = {
      line1: text(values.line1) || null,
      line2: text(values.line2) || null,
      city: text(values.city) || null,
      region: text(values.region) || null,
      postal_code: text(values.postal_code) || null,
      country: text(values.country).toUpperCase() || null,
    };
    return Object.values(address).some(Boolean) ? address : null;
  };

  const create = dialog?.kind === 'create' ? dialog : null;
  const edit = dialog?.kind === 'edit' ? dialog : null;
  const move = dialog?.kind === 'move' ? dialog : null;
  const archive = dialog?.kind === 'archive' ? dialog : null;

  return (
    <>
      <FormDialog
        open={!!create}
        onOpenChange={(open) => !open && onClose()}
        title={t('locations.form.createTitle')}
        description={t('locations.form.createDescription')}
        submitLabel={t('locations.form.create')}
        initial={{
          name: '',
          kind: 'room',
          code: '',
          notes: '',
          parent: create?.parentId || onlyRoot,
          line1: '',
          line2: '',
          city: '',
          region: '',
          postal_code: '',
          country: '',
        }}
        fields={[
          baseFields[0]!,
          baseFields[1]!,
          {
            name: 'parent',
            label: t('locations.form.parent'),
            kind: 'custom',
            required: scoped,
            hint: scoped ? t('locationScope.parentRequiredHint') : t('locations.form.parentHint'),
            pointers: ['/parent_id'],
            render: ({ control, value, set, invalid }) => (
              <LocationPicker
                {...control}
                invalid={invalid}
                clearable={!scoped}
                value={String(value)}
                onChange={set}
                placeholder={scoped ? undefined : t('locations.form.topLevel')}
              />
            ),
          },
          ...baseFields.slice(2),
        ]}
        onSubmit={async (values) => {
          const address = addressOf(values);
          const created = await locationsApi.create({
            // (`address` is only ever sent for a site; null means "no address")
            name: text(values.name),
            kind: values.kind as LocationKind,
            parent_id: text(values.parent) || null,
            ...(text(values.code) ? { code: text(values.code) } : {}),
            ...(text(values.notes) ? { notes: text(values.notes) } : {}),
            ...(address ? { address } : {}),
          });
          await onDone(t('locations.created', { name: created.value.name }), created.value.id);
        }}
      />

      <FormDialog
        // a reloaded version (new ETag) starts the form over with its values
        key={edit ? `${edit.location.id}:${edit.etag ?? ''}` : 'edit'}
        open={!!edit}
        onOpenChange={(open) => !open && onClose()}
        title={t('locations.form.editTitle', { name: edit?.location.name ?? '' })}
        submitLabel={t('common.save')}
        initial={{
          name: edit?.location.name ?? '',
          kind: edit?.location.kind ?? 'other',
          code: edit?.location.code ?? '',
          notes: edit?.location.notes ?? '',
          line1: edit?.location.address?.line1 ?? '',
          line2: edit?.location.address?.line2 ?? '',
          city: edit?.location.address?.city ?? '',
          region: edit?.location.address?.region ?? '',
          postal_code: edit?.location.address?.postal_code ?? '',
          country: edit?.location.address?.country ?? '',
        }}
        fields={baseFields}
        onReload={edit ? () => onReload(edit.location, 'edit') : undefined}
        onSubmit={async (values) => {
          if (!edit) return;
          const address = addressOf(values);
          await locationsApi.update(
            edit.location.id,
            {
              name: text(values.name),
              kind: values.kind as LocationKind,
              code: text(values.code) || null,
              notes: text(values.notes) || null,
              ...(address !== undefined ? { address } : {}),
            },
            edit.etag,
          );
          await onDone(t('locations.updated', { name: text(values.name) }));
        }}
      />

      <FormDialog
        key={move ? `${move.location.id}:${move.etag ?? ''}` : 'move'}
        open={!!move}
        onReload={move ? () => onReload(move.location, 'move') : undefined}
        onOpenChange={(open) => !open && onClose()}
        title={t('locations.moveForm.title', { name: move?.location.name ?? '' })}
        description={t('locations.moveForm.description')}
        submitLabel={t('locations.move')}
        initial={{ parent: move?.location.parent_id ?? '' }}
        fields={[
          {
            name: 'parent',
            label: t('locations.moveForm.newParent'),
            kind: 'custom',
            required: scoped,
            hint: scoped ? t('locationScope.parentRequiredHint') : t('locations.moveForm.hint'),
            pointers: ['/parent_id'],
            render: ({ control, value, set, invalid }) => (
              <LocationPicker
                {...control}
                invalid={invalid}
                clearable={!scoped}
                excludeSubtreeOf={move?.location.id}
                value={String(value)}
                onChange={set}
                placeholder={scoped ? undefined : t('locations.form.topLevel')}
              />
            ),
          },
        ]}
        onSubmit={async (values) => {
          if (!move) return;
          const parentId = text(values.parent) || null;
          await locationsApi.update(move.location.id, { parent_id: parentId }, move.etag);
          await onDone(t('locations.moved', { name: move.location.name }));
        }}
      />

      <ConfirmDialog
        open={!!archive}
        onOpenChange={(open) => !open && onClose()}
        title={t('locations.archiveTitle', { name: archive?.location.name ?? '' })}
        description={t('locations.archiveDescription')}
        confirmLabel={t('common.archive')}
        destructive
        onConfirm={async () => {
          if (!archive) return;
          await locationsApi.archive(archive.location.id);
          await onArchived();
        }}
      >
        {archive &&
        ((archive.location.asset_count ?? 0) > 0 ||
          locations.some((l) => l.parent_id === archive.location.id)) ? (
          <Banner tone="warning">
            {t('locations.archiveInUse', {
              assets: archive.location.asset_count ?? 0,
              children: locations.filter((l) => l.parent_id === archive.location.id).length,
            })}
          </Banner>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
