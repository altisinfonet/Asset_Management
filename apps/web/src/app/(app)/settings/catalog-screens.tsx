'use client';

import { ArrowDown, ArrowUp, Building2, Cpu, Factory, Hash, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CatalogScreen } from '@/components/registry/catalog-screen';
import { FormDialog, type FormFieldSpec } from '@/components/registry/form-dialog';
import { SectionHeader } from '@/components/registry/section-header';
import { useEditor, useRunner } from '@/components/registry/use-runner';
import { StatusBadge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useQueries } from '@tanstack/react-query';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import {
  assetsApi,
  categoriesApi,
  manufacturersApi,
  modelsApi,
  statusApi,
  vendorsApi,
} from '@/lib/registry/api';
import {
  useCategories,
  useInvalidateLookups,
  useManufacturers,
  useModels,
  useStatusLabels,
  useVendors,
} from '@/lib/registry/queries';
import {
  STATE_TYPES,
  type AssetModel,
  type Category,
  type Manufacturer,
  type StatusLabel,
  type Vendor,
} from '@/lib/registry/types';
import { formatTag } from '@/lib/registry/tags';

const str = (value: unknown): string => String(value ?? '').trim();
const orNull = (value: unknown): string | null => str(value) || null;

// ---- manufacturers ----------------------------------------------------------------------------

export function ManufacturersScreen() {
  const t = useT();
  const list = useManufacturers();
  const fields: FormFieldSpec[] = [
    { name: 'name', label: t('manufacturers.form.name'), kind: 'text', required: true },
    { name: 'url', label: t('manufacturers.form.url'), kind: 'url' },
    { name: 'support_email', label: t('manufacturers.form.supportEmail'), kind: 'email' },
    { name: 'support_phone', label: t('manufacturers.form.supportPhone'), kind: 'text' },
    { name: 'notes', label: t('manufacturers.form.notes'), kind: 'textarea' },
  ];
  const body = (v: Record<string, unknown>) => ({
    name: str(v.name),
    url: orNull(v.url),
    support_email: orNull(v.support_email),
    support_phone: orNull(v.support_phone),
    notes: orNull(v.notes),
  });
  return (
    <CatalogScreen<Manufacturer>
      section="manufacturers"
      title={t('settings.sections.manufacturers')}
      description={t('manufacturers.description')}
      icon={Factory}
      tableLabel={t('manufacturers.tableLabel')}
      newLabel={t('manufacturers.new')}
      editTitle={t('manufacturers.editTitle')}
      createLabel={t('manufacturers.create')}
      emptyTitle={t('manufacturers.emptyTitle')}
      emptyDescription={t('manufacturers.emptyDescription')}
      rows={list.data}
      loading={list.isLoading}
      error={list.error}
      columns={[
        { id: 'name', header: t('manufacturers.columns.name'), cell: (r) => r.name },
        { id: 'url', header: t('manufacturers.columns.url'), cell: (r) => r.url ?? '' },
        {
          id: 'email',
          header: t('manufacturers.columns.support'),
          cell: (r) => r.support_email ?? '',
        },
      ]}
      fields={fields}
      rowName={(r) => r.name}
      toInitial={(r) => ({
        name: r?.name ?? '',
        url: r?.url ?? '',
        support_email: r?.support_email ?? '',
        support_phone: r?.support_phone ?? '',
        notes: r?.notes ?? '',
      })}
      get={manufacturersApi.get}
      create={(v) => manufacturersApi.create(body(v))}
      update={(id, v, etag) => manufacturersApi.update(id, body(v), etag)}
      archive={(id) => manufacturersApi.archive(id)}
      archiveTitle={(name) => t('manufacturers.archiveTitle', { name })}
      archiveDescription={t('manufacturers.archiveDescription')}
      archivedToast={t('manufacturers.archived')}
    />
  );
}

// ---- vendors ------------------------------------------------------------------------------------

export function VendorsScreen() {
  const t = useT();
  const list = useVendors();
  const fields: FormFieldSpec[] = [
    { name: 'name', label: t('vendors.form.name'), kind: 'text', required: true },
    { name: 'contact_name', label: t('vendors.form.contactName'), kind: 'text' },
    { name: 'contact_email', label: t('vendors.form.contactEmail'), kind: 'email' },
    { name: 'phone', label: t('vendors.form.phone'), kind: 'text' },
    { name: 'url', label: t('vendors.form.url'), kind: 'url' },
    { name: 'notes', label: t('vendors.form.notes'), kind: 'textarea' },
  ];
  const body = (v: Record<string, unknown>) => ({
    name: str(v.name),
    contact_name: orNull(v.contact_name),
    contact_email: orNull(v.contact_email),
    phone: orNull(v.phone),
    url: orNull(v.url),
    notes: orNull(v.notes),
  });
  return (
    <CatalogScreen<Vendor>
      section="vendors"
      title={t('settings.sections.vendors')}
      description={t('vendors.description')}
      icon={Building2}
      tableLabel={t('vendors.tableLabel')}
      newLabel={t('vendors.new')}
      editTitle={t('vendors.editTitle')}
      createLabel={t('vendors.create')}
      emptyTitle={t('vendors.emptyTitle')}
      emptyDescription={t('vendors.emptyDescription')}
      rows={list.data}
      loading={list.isLoading}
      error={list.error}
      columns={[
        { id: 'name', header: t('vendors.columns.name'), cell: (r) => r.name },
        { id: 'contact', header: t('vendors.columns.contact'), cell: (r) => r.contact_name ?? '' },
        { id: 'email', header: t('vendors.columns.email'), cell: (r) => r.contact_email ?? '' },
        { id: 'phone', header: t('vendors.columns.phone'), cell: (r) => r.phone ?? '' },
      ]}
      fields={fields}
      rowName={(r) => r.name}
      toInitial={(r) => ({
        name: r?.name ?? '',
        contact_name: r?.contact_name ?? '',
        contact_email: r?.contact_email ?? '',
        phone: r?.phone ?? '',
        url: r?.url ?? '',
        notes: r?.notes ?? '',
      })}
      get={vendorsApi.get}
      create={(v) => vendorsApi.create(body(v))}
      update={(id, v, etag) => vendorsApi.update(id, body(v), etag)}
      archive={(id) => vendorsApi.archive(id)}
      archiveTitle={(name) => t('vendors.archiveTitle', { name })}
      archiveDescription={t('vendors.archiveDescription')}
      archivedToast={t('vendors.archived')}
    />
  );
}

// ---- models -------------------------------------------------------------------------------------------

export function ModelsScreen() {
  const t = useT();
  const models = useModels();
  const manufacturers = useManufacturers();
  const categories = useCategories();
  const [search, setSearch] = useState('');
  const [manufacturer, setManufacturer] = useState('all');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (models.data ?? []).filter(
      (m) =>
        (manufacturer === 'all' || m.manufacturer_id === manufacturer) &&
        (!q || `${m.name} ${m.model_number ?? ''}`.toLowerCase().includes(q)),
    );
  }, [models.data, search, manufacturer]);

  const mName = (id?: string | null) => manufacturers.data?.find((m) => m.id === id)?.name ?? '';
  const cName = (id?: string | null) => categories.data?.find((c) => c.id === id)?.name ?? '';

  const fields: FormFieldSpec[] = [
    { name: 'name', label: t('models.form.name'), kind: 'text', required: true },
    {
      name: 'category_id',
      label: t('models.form.category'),
      kind: 'select',
      required: true,
      placeholder: t('common.choose'),
      options: (categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
    {
      name: 'manufacturer_id',
      label: t('models.form.manufacturer'),
      kind: 'select',
      emptyLabel: t('common.none'),
      options: (manufacturers.data ?? []).map((m) => ({ value: m.id, label: m.name })),
    },
    { name: 'model_number', label: t('models.form.modelNumber'), kind: 'text', mono: true },
    {
      name: 'default_depreciation_months',
      label: t('models.form.depreciation'),
      kind: 'number',
      min: 0,
    },
    { name: 'eol_date', label: t('models.form.eol'), kind: 'date' },
  ];
  const body = (v: Record<string, unknown>) => ({
    name: str(v.name),
    category_id: str(v.category_id),
    manufacturer_id: orNull(v.manufacturer_id),
    model_number: orNull(v.model_number),
    default_depreciation_months: str(v.default_depreciation_months)
      ? Number(v.default_depreciation_months)
      : null,
    eol_date: orNull(v.eol_date),
  });

  return (
    <CatalogScreen<AssetModel>
      section="models"
      title={t('settings.sections.models')}
      description={t('models.description')}
      icon={Cpu}
      tableLabel={t('models.tableLabel')}
      newLabel={t('models.new')}
      editTitle={t('models.editTitle')}
      createLabel={t('models.create')}
      emptyTitle={t('models.emptyTitle')}
      emptyDescription={t('models.emptyDescription')}
      rows={rows}
      loading={models.isLoading}
      error={models.error}
      toolbar={
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="flex min-w-56 flex-col gap-1.5 text-sm font-medium">
            {t('common.search')}
            <Input
              type="search"
              value={search}
              placeholder={t('models.searchPlaceholder')}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="flex min-w-56 flex-col gap-1.5 text-sm font-medium">
            {t('models.form.manufacturer')}
            <Select
              aria-label={t('models.form.manufacturer')}
              value={manufacturer}
              onValueChange={setManufacturer}
              options={[
                { value: 'all', label: t('common.all') },
                ...(manufacturers.data ?? []).map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
          </label>
        </div>
      }
      columns={[
        {
          id: 'manufacturer',
          header: t('models.columns.manufacturer'),
          cell: (r) => mName(r.manufacturer_id),
        },
        { id: 'name', header: t('models.columns.name'), cell: (r) => r.name },
        {
          id: 'number',
          header: t('models.columns.number'),
          mono: true,
          cell: (r) => r.model_number ?? '',
        },
        { id: 'category', header: t('models.columns.category'), cell: (r) => cName(r.category_id) },
        { id: 'eol', header: t('models.columns.eol'), cell: (r) => r.eol_date ?? '' },
        {
          id: 'depr',
          header: t('models.columns.depreciation'),
          align: 'end',
          cell: (r) =>
            r.default_depreciation_months == null
              ? ''
              : t('models.months', { count: r.default_depreciation_months }),
        },
      ]}
      fields={fields}
      rowName={(r) => r.name}
      toInitial={(r) => ({
        name: r?.name ?? '',
        category_id: r?.category_id ?? '',
        manufacturer_id: r?.manufacturer_id ?? '',
        model_number: r?.model_number ?? '',
        default_depreciation_months: r?.default_depreciation_months?.toString() ?? '',
        eol_date: r?.eol_date ?? '',
      })}
      get={modelsApi.get}
      create={(v) => modelsApi.create(body(v))}
      update={(id, v, etag) => modelsApi.update(id, body(v), etag)}
      archive={(id) => modelsApi.archive(id)}
      archiveTitle={(name) => t('models.archiveTitle', { name })}
      archiveDescription={t('models.archiveDescription')}
      archivedToast={t('models.archived')}
    />
  );
}

// ---- status labels ------------------------------------------------------------------------------------------

export function StatusLabelsScreen() {
  const t = useT();
  const labels = useStatusLabels();
  const run = useRunner();
  const rows = useMemo(
    () => [...(labels.data ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [labels.data],
  );
  // How many assets carry each label (one count query per label; the list is short).
  const counts = useQueries({
    queries: rows.map((label) => ({
      queryKey: ['status-usage', label.id],
      queryFn: () => assetsApi.list({ status_id: [label.id], limit: 1, include_total: true }),
      staleTime: 30_000,
    })),
  });
  const countOf = (id: string) => {
    const index = rows.findIndex((r) => r.id === id);
    return counts[index]?.data?.page.total;
  };

  const move = (row: StatusLabel, delta: -1 | 1) => {
    const index = rows.findIndex((r) => r.id === row.id);
    const other = rows[index + delta];
    if (!other) return;
    // Swap the two positions (a position is just an ordering key).
    void run(async () => {
      await statusApi.update(row.id, { position: other.position ?? 0 });
      await statusApi.update(other.id, { position: row.position ?? 0 });
    }, t('statusLabels.reordered'));
  };

  const fields: FormFieldSpec[] = [
    { name: 'name', label: t('statusLabels.form.name'), kind: 'text', required: true },
    {
      name: 'state_type',
      label: t('statusLabels.form.stateType'),
      kind: 'select',
      required: true,
      hint: t('statusLabels.form.stateTypeHint'),
      placeholder: t('common.choose'),
      options: STATE_TYPES.map((s) => ({ value: s, label: t(`status.${s}`) })),
    },
    { name: 'description', label: t('statusLabels.form.description'), kind: 'text' },
    { name: 'is_default', label: t('statusLabels.form.default'), kind: 'checkbox' },
  ];

  return (
    <CatalogScreen<StatusLabel>
      section="status"
      title={t('settings.sections.status')}
      description={t('statusLabels.description')}
      icon={Tags}
      tableLabel={t('statusLabels.tableLabel')}
      newLabel={t('statusLabels.new')}
      editTitle={t('statusLabels.editTitle')}
      createLabel={t('statusLabels.create')}
      emptyTitle={t('statusLabels.emptyTitle')}
      emptyDescription={t('statusLabels.emptyDescription')}
      rows={rows}
      loading={labels.isLoading}
      error={labels.error}
      columns={[
        { id: 'name', header: t('statusLabels.columns.name'), cell: (r) => r.name },
        {
          id: 'type',
          header: t('statusLabels.columns.stateType'),
          cell: (r) => t(`status.${r.state_type}`),
        },
        {
          id: 'preview',
          header: t('statusLabels.columns.preview'),
          cell: (r) => <StatusBadge type={r.state_type} label={r.name} />,
        },
        {
          id: 'default',
          header: t('statusLabels.columns.default'),
          cell: (r) => (r.is_default ? t('statusLabels.isDefault') : ''),
        },
        {
          id: 'assets',
          header: t('statusLabels.columns.assets'),
          align: 'end',
          cell: (r) => countOf(r.id) ?? '',
        },
      ]}
      extraActions={(row) => {
        const index = rows.findIndex((r) => r.id === row.id);
        return (
          <>
            <Button
              size="icon-sm"
              aria-label={t('common.moveUpNamed', { name: row.name })}
              disabled={index === 0}
              onClick={() => move(row, -1)}
            >
              <ArrowUp aria-hidden className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              aria-label={t('common.moveDownNamed', { name: row.name })}
              disabled={index === rows.length - 1}
              onClick={() => move(row, 1)}
            >
              <ArrowDown aria-hidden className="size-4" />
            </Button>
            {row.is_default ? null : (
              <Button
                size="sm"
                onClick={() =>
                  void run(
                    () => statusApi.update(row.id, { is_default: true }),
                    t('statusLabels.defaultChanged', { name: row.name }),
                  )
                }
              >
                {t('statusLabels.makeDefault')}
              </Button>
            )}
          </>
        );
      }}
      canArchive={(row) => !row.is_default}
      fields={fields}
      rowName={(r) => r.name}
      toInitial={(r) => ({
        name: r?.name ?? '',
        state_type: r?.state_type ?? '',
        description: r?.description ?? '',
        is_default: r?.is_default ?? false,
      })}
      get={statusApi.get}
      create={(v) =>
        statusApi.create({
          name: str(v.name),
          state_type: str(v.state_type) as StatusLabel['state_type'],
          description: orNull(v.description),
          is_default: v.is_default === true,
          position: rows.length,
        })
      }
      update={(id, v, etag) =>
        statusApi.update(
          id,
          {
            name: str(v.name),
            description: orNull(v.description),
            is_default: v.is_default === true,
          },
          etag,
        )
      }
      archive={(id) => statusApi.archive(id)}
      archiveTitle={(name) => t('statusLabels.archiveTitle', { name })}
      archiveDescription={t('statusLabels.archiveDescription')}
      archivedToast={t('statusLabels.archived')}
      footer={<p className="mt-3 text-sm text-muted">{t('statusLabels.colourNote')}</p>}
    />
  );
}

// ---- tag numbering ---------------------------------------------------------------------------------------------

/**
 * Tag numbering: assets get `<category prefix><number>` when no tag is typed. The contract only
 * has the per-category `tag_prefix` (no tenant template with a counter width), so this screen
 * edits the prefixes and shows a live example; typing a tag always overrides the template.
 */
export function TagNumberingScreen() {
  const t = useT();
  const { can } = useAuth();
  const manage = can('catalog:manage');
  const categories = useCategories();
  const invalidate = useInvalidateLookups();
  const editor = useEditor(categoriesApi.get);
  const [example, setExample] = useState('');
  const editing = editor.target?.kind === 'edit' ? editor.target.versioned : undefined;

  const columns = useMemo<DataTableColumn<Category>[]>(
    () => [
      { id: 'name', header: t('tags.columns.category'), cell: (r) => r.name },
      {
        id: 'prefix',
        header: t('tags.columns.prefix'),
        mono: true,
        cell: (r) => r.tag_prefix ?? '',
      },
      {
        id: 'example',
        header: t('tags.columns.example'),
        mono: true,
        cell: (r) => formatTag(r.tag_prefix, 42),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        srOnlyHeader: true,
        align: 'end',
        cell: (r) =>
          manage ? (
            <Button
              size="sm"
              aria-label={t('tags.editLabel', { name: r.name })}
              onClick={() => {
                setExample(formatTag(r.tag_prefix, 42));
                void editor.openEdit(r.id);
              }}
            >
              {t('common.edit')}
            </Button>
          ) : null,
      },
    ],
    [t, manage, editor],
  );

  return (
    <>
      <SectionHeader
        section="tags"
        title={t('settings.sections.tags')}
        description={t('tags.description')}
      />
      <Banner tone="info" className="mb-4">
        {t('tags.override')}
      </Banner>
      {categories.error ? (
        <Banner tone="danger">{t('common.loadFailed')}</Banner>
      ) : (
        <DataTable
          label={t('tags.tableLabel')}
          columns={columns}
          rows={categories.data ?? []}
          getRowId={(r) => r.id}
          loading={categories.isLoading}
          empty={<Hash aria-hidden className="m-6 size-6 text-muted" />}
        />
      )}
      <FormDialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && editor.close()}
        title={t('tags.editTitle', { name: editing?.value.name ?? '' })}
        description={t('tags.editDescription')}
        fields={[
          {
            name: 'tag_prefix',
            label: t('tags.form.prefix'),
            kind: 'text',
            mono: true,
            hint: t('tags.form.prefixHint'),
          },
        ]}
        initial={{ tag_prefix: editing?.value.tag_prefix ?? '' }}
        onChange={(values) => setExample(formatTag(str(values.tag_prefix), 42))}
        footerNote={
          <p className="text-base" data-testid="tag-example">
            {t('tags.example')} <span className="font-tag">{example}</span>
          </p>
        }
        submitLabel={t('common.save')}
        onSubmit={async (values) => {
          if (!editing) return;
          await categoriesApi.update(
            editing.value.id,
            { tag_prefix: orNull(values.tag_prefix) },
            editing.etag,
          );
          await invalidate();
        }}
      />
    </>
  );
}
