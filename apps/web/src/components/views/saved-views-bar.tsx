'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { FormDialog, type FormFieldSpec } from '@/components/registry/form-dialog';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { getApi } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import { defaultViewState, type AssetViewState } from '@/lib/registry/asset-view';
import type { Lookups } from '@/lib/registry/queries';
import { savedViewsApi, SHARE_PERMISSION, type SavedView } from '@/lib/views/api';
import {
  applyWarnings,
  degradeState,
  fromDefinition,
  migrateLocalViews,
  pendingLocalViews,
  toDefinition,
  type DroppedPart,
} from '@/lib/views/convert';

const DEFAULT_VIEW = '__default__';
export const SAVED_VIEWS_KEY = ['saved-views'] as const;

/**
 * Saved views of the asset list on the server (M2-REG-01): personal ones and those shared with the
 * organisation. Applies a view to the list, saves the current state as a new one, updates, renames
 * (and shares) or deletes one. A view that refers to a status, category, location or custom field
 * that no longer exists still applies, without that part and with a warning. Views kept in this
 * browser by the earlier version are moved to the account once, on first load.
 */
export function SavedViewsBar({
  current,
  lookups,
  onApply,
}: {
  current: AssetViewState;
  lookups: Lookups;
  onApply: (state: AssetViewState) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { me, can } = useAuth();
  const client = useQueryClient();
  const [activeId, setActiveId] = useState(DEFAULT_VIEW);
  const [saveOpen, setSaveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dropped, setDropped] = useState<{ name: string; parts: DroppedPart[] } | null>(null);
  const migrated = useRef(false);
  const userId = me?.user.id ?? '';
  const canShare = can(SHARE_PERMISSION);

  const views = useQuery({
    queryKey: SAVED_VIEWS_KEY,
    queryFn: () => savedViewsApi.list(),
    retry: false,
    staleTime: 30_000,
  });
  // The API lists by name; the user's own views come first.
  const list = useMemo(() => {
    const all = views.data ?? [];
    return [...all.filter((view) => view.is_owner), ...all.filter((view) => !view.is_owner)];
  }, [views.data]);
  const active = list.find((view) => view.id === activeId);

  // Views from this browser (the earlier version) move to the account the first time the list loads.
  useEffect(() => {
    if (!views.isSuccess || !userId || migrated.current) return;
    migrated.current = true;
    const local = pendingLocalViews();
    if (local.length === 0) return;
    void migrateLocalViews(local, views.data, (view) => savedViewsApi.create(view)).then(
      (result) => {
        if (result.moved > 0) {
          toast({ variant: 'success', title: t('savedViews.migrated', { count: result.moved }) });
        }
        if (result.failed > 0) toast({ variant: 'danger', title: t('savedViews.migrateFailed') });
        if (result.moved > 0) void client.invalidateQueries({ queryKey: SAVED_VIEWS_KEY });
      },
    );
  }, [views.isSuccess, views.data, userId, client, toast, t]);

  const refs = useMemo(
    () => ({
      statusIds: new Set(lookups.statuses.map((s) => s.id)),
      categoryIds: new Set(lookups.categories.map((c) => c.id)),
      locationIds: new Set(lookups.locations.map((l) => l.id)),
      fieldKeys: new Set(lookups.fields.map((f) => f.key)),
      ready: !lookups.loading,
    }),
    [lookups],
  );

  const apply = (id: string) => {
    setActiveId(id);
    setDropped(null);
    if (id === DEFAULT_VIEW) {
      onApply(defaultViewState());
      return;
    }
    const view = list.find((candidate) => candidate.id === id);
    if (!view) return;
    // what the server could not resolve, then what the catalogue here no longer has
    const warned = applyWarnings(fromDefinition(view), view.warnings);
    const result = degradeState(warned.state, refs);
    const parts = [...new Set([...warned.dropped, ...result.dropped])];
    if (parts.length > 0) setDropped({ name: view.name, parts });
    onApply(result.state);
  };

  const refresh = () => client.invalidateQueries({ queryKey: SAVED_VIEWS_KEY });
  // Only the owner changes or deletes a view; everybody else can use it or save a copy.
  const mayChange = (view: SavedView) => view.is_owner;

  const label = (view: SavedView) =>
    view.is_shared ? t('savedViews.sharedOption', { name: view.name }) : view.name;

  const nameField: FormFieldSpec = {
    name: 'name',
    label: t('assets.views.name'),
    kind: 'text',
    required: true,
  };
  const shareField: FormFieldSpec = {
    name: 'shared',
    label: t('savedViews.share'),
    kind: 'checkbox',
    hint: t('savedViews.shareHint'),
  };
  const fields = canShare ? [nameField, shareField] : [nameField];

  return (
    <>
      <label className="flex items-center gap-2 text-sm font-medium">
        {t('assets.views.label')}
        <Select
          aria-label={t('assets.views.label')}
          value={active ? active.id : DEFAULT_VIEW}
          onValueChange={apply}
          className="w-56"
          options={[
            { value: DEFAULT_VIEW, label: t('assets.views.all') },
            ...list.map((view) => ({ value: view.id, label: label(view) })),
          ]}
        />
      </label>
      <Button size="sm" onClick={() => setSaveOpen(true)}>
        <Save aria-hidden className="size-4" />
        {t('assets.views.save')}
      </Button>
      {active && mayChange(active) ? (
        <>
          <Button
            size="sm"
            onClick={() => {
              void savedViewsApi
                .update(active.id, toDefinition(current))
                .then(() => {
                  toast({
                    variant: 'success',
                    title: t('savedViews.updateDone', { name: active.name }),
                  });
                  return refresh();
                })
                .catch((err: unknown) => {
                  const ui = getApi().toUiError(err);
                  toast({
                    variant: 'danger',
                    title: t('savedViews.updateFailed'),
                    description: uiErrorText(t, ui),
                    requestId: ui.requestId,
                  });
                });
            }}
          >
            <RefreshCw aria-hidden className="size-4" />
            {t('savedViews.update')}
          </Button>
          <Button size="sm" onClick={() => setEditOpen(true)}>
            <Pencil aria-hidden className="size-4" />
            {t('savedViews.edit')}
          </Button>
          <Button size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 aria-hidden className="size-4" />
            {t('assets.views.delete')}
          </Button>
        </>
      ) : null}
      {views.error ? (
        <span role="status" className="text-sm text-danger-text">
          {t('savedViews.loadFailed')}
        </span>
      ) : null}
      {active && !active.is_owner ? (
        <span className="text-sm text-muted">
          {t('savedViews.sharedBy', { name: active.owner.display_name })}
        </span>
      ) : null}

      {dropped ? (
        <div className="basis-full">
          <Banner tone="warning" title={t('savedViews.droppedTitle', { name: dropped.name })}>
            {t('savedViews.droppedBody', {
              parts: dropped.parts.map((part) => t(`savedViews.dropped.${part}`)).join(', '),
            })}
          </Banner>
        </div>
      ) : null}

      <FormDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title={t('assets.views.saveTitle')}
        description={t('assets.views.saveDescription')}
        fields={fields}
        initial={{ name: '', shared: false }}
        submitLabel={t('assets.views.save')}
        onSubmit={async (values) => {
          const name = String(values.name).trim();
          const created = await savedViewsApi.create({ name, ...toDefinition(current) });
          // A view is private until it is shared: a second call that needs the view:share permission.
          if (canShare && values.shared === true) {
            try {
              await savedViewsApi.share(created.id, true);
            } catch (err) {
              await refresh();
              setActiveId(created.id);
              const ui = getApi().toUiError(err);
              toast({
                variant: 'warning',
                title: t('savedViews.shareFailed', { name }),
                description: uiErrorText(t, ui),
                requestId: ui.requestId,
              });
              return;
            }
          }
          await refresh();
          setActiveId(created.id);
          setDropped(null);
          toast({ variant: 'success', title: t('savedViews.saved', { name }) });
        }}
      />
      <FormDialog
        open={editOpen && !!active}
        onOpenChange={setEditOpen}
        title={t('savedViews.editTitle', { name: active?.name ?? '' })}
        description={t('savedViews.editDescription')}
        fields={fields}
        initial={{ name: active?.name ?? '', shared: active?.is_shared ?? false }}
        submitLabel={t('common.save')}
        onSubmit={async (values) => {
          if (!active) return;
          const name = String(values.name).trim();
          if (name !== active.name) await savedViewsApi.update(active.id, { name });
          if (canShare && (values.shared === true) !== active.is_shared) {
            await savedViewsApi.share(active.id, values.shared === true);
          }
          await refresh();
          toast({ variant: 'success', title: t('savedViews.renamed', { name }) });
        }}
      />
      <ConfirmDialog
        open={deleteOpen && !!active}
        onOpenChange={setDeleteOpen}
        title={t('savedViews.deleteTitle', { name: active?.name ?? '' })}
        description={t('savedViews.deleteDescription')}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={async () => {
          if (!active) return;
          await savedViewsApi.remove(active.id);
          setActiveId(DEFAULT_VIEW);
          await refresh();
          toast({ variant: 'success', title: t('savedViews.deleted') });
        }}
      />
    </>
  );
}
