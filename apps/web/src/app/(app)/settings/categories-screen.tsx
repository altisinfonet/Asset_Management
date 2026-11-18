'use client';

import { useQuery } from '@tanstack/react-query';
import { Layers, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { FormDialog, type FormFieldSpec } from '@/components/registry/form-dialog';
import { SectionHeader } from '@/components/registry/section-header';
import { useEditor } from '@/components/registry/use-runner';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { assetsApi, categoriesApi } from '@/lib/registry/api';
import { useCategories, useCustomFields, useInvalidateLookups } from '@/lib/registry/queries';
import type { Category } from '@/lib/registry/types';
import { routes } from '@/lib/routes';

/** Categories (WEB-08): create, rename, tag prefix, archive with the impact stated first. */
export function CategoriesScreen() {
  const t = useT();
  const { can } = useAuth();
  const manage = can('catalog:manage');
  const { toast } = useToast();
  const invalidate = useInvalidateLookups();
  const [showArchived, setShowArchived] = useState(false);
  const categories = useCategories({ includeArchived: showArchived });
  const fields = useCustomFields();
  const editor = useEditor(categoriesApi.get);
  const [archiving, setArchiving] = useState<Category | null>(null);

  const fieldCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const field of fields.data ?? []) {
      if (field.category_id)
        counts.set(field.category_id, (counts.get(field.category_id) ?? 0) + 1);
    }
    return counts;
  }, [fields.data]);
  const sharedFields = (fields.data ?? []).filter((f) => !f.category_id).length;

  const columns = useMemo<DataTableColumn<Category>[]>(
    () => [
      {
        id: 'name',
        header: t('categories.columns.name'),
        cell: (row) => (
          <span className={row.archived_at ? 'text-muted' : undefined}>
            {row.name}
            {row.archived_at ? ` (${t('common.archived')})` : ''}
          </span>
        ),
      },
      {
        id: 'prefix',
        header: t('categories.columns.prefix'),
        mono: true,
        cell: (row) => row.tag_prefix ?? '',
      },
      {
        id: 'fields',
        header: t('categories.columns.fields'),
        align: 'end',
        cell: (row) => (
          <Link
            href={`${routes.settings('fields')}?category=${row.id}`}
            className="rounded-sm text-primary-text underline underline-offset-2"
          >
            {fieldCounts.get(row.id) ?? 0}
          </Link>
        ),
      },
      {
        id: 'description',
        header: t('categories.columns.description'),
        cell: (row) => row.description ?? '',
      },
      {
        id: 'actions',
        header: t('common.actions'),
        srOnlyHeader: true,
        align: 'end',
        cell: (row) =>
          manage && !row.archived_at ? (
            <span className="inline-flex gap-1">
              <Button
                size="sm"
                onClick={() => void editor.openEdit(row.id)}
                aria-label={t('categories.editLabel', { name: row.name })}
              >
                {t('common.edit')}
              </Button>
              <Button
                size="sm"
                onClick={() => setArchiving(row)}
                aria-label={t('categories.archiveLabel', { name: row.name })}
              >
                {t('common.archive')}
              </Button>
            </span>
          ) : null,
      },
    ],
    [t, manage, fieldCounts, editor],
  );

  const formFields: FormFieldSpec[] = [
    { name: 'name', label: t('categories.form.name'), kind: 'text', required: true },
    {
      name: 'tag_prefix',
      label: t('categories.form.prefix'),
      kind: 'text',
      hint: t('categories.form.prefixHint'),
      mono: true,
    },
    { name: 'description', label: t('categories.form.description'), kind: 'textarea' },
  ];

  const editing = editor.target?.kind === 'edit' ? editor.target.versioned : undefined;

  return (
    <>
      <SectionHeader
        section="categories"
        title={t('settings.sections.categories')}
        description={t('categories.description')}
        actions={
          <>
            <Checkbox
              label={t('common.showArchived')}
              checked={showArchived}
              onCheckedChange={(v) => setShowArchived(v === true)}
            />
            {manage ? (
              <Button variant="primary" onClick={editor.openNew}>
                <Plus aria-hidden className="size-4" />
                {t('categories.new')}
              </Button>
            ) : null}
          </>
        }
      />
      {categories.error ? (
        <Banner tone="danger">{t('common.loadFailed')}</Banner>
      ) : (
        <DataTable
          label={t('categories.tableLabel')}
          columns={columns}
          rows={categories.data ?? []}
          getRowId={(row) => row.id}
          loading={categories.isLoading}
          empty={
            <EmptyState
              icon={Layers}
              title={t('categories.emptyTitle')}
              description={t('categories.emptyDescription')}
            />
          }
        />
      )}
      {sharedFields > 0 ? (
        <p className="mt-3 text-sm text-muted">
          {t('categories.sharedFields', { count: sharedFields })}
        </p>
      ) : null}

      <FormDialog
        open={editor.target !== null}
        onOpenChange={(open) => !open && editor.close()}
        title={editing ? t('categories.editTitle') : t('categories.new')}
        fields={formFields}
        initial={{
          name: editing?.value.name ?? '',
          tag_prefix: editing?.value.tag_prefix ?? '',
          description: editing?.value.description ?? '',
        }}
        submitLabel={editing ? t('common.save') : t('categories.create')}
        onSubmit={async (values) => {
          const body = {
            name: String(values.name).trim(),
            tag_prefix: String(values.tag_prefix).trim() || null,
            description: String(values.description).trim() || null,
          };
          if (editing) await categoriesApi.update(editing.value.id, body, editing.etag);
          else await categoriesApi.create({ ...body, kind: 'asset' });
          await invalidate();
        }}
      />

      <ArchiveCategoryDialog
        category={archiving}
        onClose={() => setArchiving(null)}
        onArchive={async (category) => {
          // Errors stay in the dialog: a 409 says which records still use the category.
          await categoriesApi.archive(category.id);
          await invalidate();
          toast({ variant: 'success', title: t('categories.archived') });
        }}
      />
    </>
  );
}

/** Says how many assets use the category before archiving; the API refuses while any do. */
function ArchiveCategoryDialog({
  category,
  onClose,
  onArchive,
}: {
  category: Category | null;
  onClose: () => void;
  onArchive: (category: Category) => Promise<void>;
}) {
  const t = useT();
  const usage = useQuery({
    queryKey: ['category-usage', category?.id],
    queryFn: () => assetsApi.list({ category_id: [category!.id], limit: 1, include_total: true }),
    enabled: !!category,
  });
  const count = usage.data?.page.total ?? 0;
  return (
    <ConfirmDialog
      open={category !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('categories.archiveTitle', { name: category?.name ?? '' })}
      description={t('categories.archiveDescription')}
      confirmLabel={t('common.archive')}
      destructive
      onConfirm={async () => {
        if (category) await onArchive(category);
      }}
    >
      <p role="status" className="rounded-md bg-sunken p-3 text-base">
        {usage.isLoading
          ? t('common.loading')
          : count > 0
            ? t('categories.impactInUse', { count })
            : t('categories.impactUnused')}
      </p>
    </ConfirmDialog>
  );
}
