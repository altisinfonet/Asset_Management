'use client';

import { Plus, type LucideIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { useInvalidateLookups } from '@/lib/registry/queries';
import type { Versioned } from '@/lib/registry/types';
import { ConfirmDialog } from './confirm-dialog';
import { FormDialog, type FormFieldSpec, type FormValues } from './form-dialog';
import { SectionHeader } from './section-header';
import { useEditor } from './use-runner';

export interface CatalogConfig<T extends { id: string; archived_at?: string | null }> {
  section: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tableLabel: string;
  newLabel: string;
  editTitle: string;
  createLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  rows: T[] | undefined;
  loading: boolean;
  error: unknown;
  columns: DataTableColumn<T>[];
  fields: FormFieldSpec[];
  rowName: (row: T) => string;
  toInitial: (row?: T) => FormValues;
  get: (id: string) => Promise<Versioned<T>>;
  create: (values: FormValues) => Promise<unknown>;
  update: (id: string, values: FormValues, etag: string | undefined) => Promise<unknown>;
  archive: (id: string) => Promise<void>;
  archiveTitle: (name: string) => string;
  archiveDescription: string;
  archivedToast: string;
  /** Rows can be archived only when this returns true (for example not the default label). */
  canArchive?: (row: T) => boolean;
  /** Extra row buttons (reorder, make default). */
  extraActions?: (row: T) => ReactNode;
  toolbar?: ReactNode;
  /** The archived-records toggle: `undefined` hides it. */
  showArchived?: { value: boolean; onChange: (value: boolean) => void };
  /** Extra content under the table. */
  footer?: ReactNode;
  /** Replaces the default "New" button (for example when creation needs more than a dialog). */
  hideNew?: boolean;
}

/**
 * One list-and-dialog settings screen: a table with Edit / Archive per row, a create button and
 * a form dialog. Manufacturers, models, vendors and status labels are all this screen with
 * different fields, so their behaviour (permissions, ETag-safe edits, in-use refusals) is shared.
 */
export function CatalogScreen<T extends { id: string; archived_at?: string | null }>(
  config: CatalogConfig<T>,
) {
  const t = useT();
  const { can } = useAuth();
  const manage = can('catalog:manage');
  const { toast } = useToast();
  const invalidate = useInvalidateLookups();
  const editor = useEditor<T>(config.get);
  const [archiving, setArchiving] = useState<T | null>(null);
  const editing = editor.target?.kind === 'edit' ? editor.target.versioned : undefined;

  const columns = useMemo<DataTableColumn<T>[]>(
    () => [
      ...config.columns,
      {
        id: 'actions',
        header: t('common.actions'),
        srOnlyHeader: true,
        align: 'end',
        cell: (row) =>
          manage && !row.archived_at ? (
            <span className="inline-flex flex-wrap justify-end gap-1">
              {config.extraActions?.(row)}
              <Button
                size="sm"
                onClick={() => void editor.openEdit(row.id)}
                aria-label={t('common.editNamed', { name: config.rowName(row) })}
              >
                {t('common.edit')}
              </Button>
              {config.canArchive?.(row) === false ? null : (
                <Button
                  size="sm"
                  onClick={() => setArchiving(row)}
                  aria-label={t('common.archiveNamed', { name: config.rowName(row) })}
                >
                  {t('common.archive')}
                </Button>
              )}
            </span>
          ) : null,
      },
    ],
    // `config` is rebuilt every render; its callbacks only read current data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.columns, config.extraActions, config.canArchive, manage, t, editor],
  );

  return (
    <>
      <SectionHeader
        section={config.section}
        title={config.title}
        description={config.description}
        actions={
          <>
            {config.showArchived ? (
              <Checkbox
                label={t('common.showArchived')}
                checked={config.showArchived.value}
                onCheckedChange={(v) => config.showArchived?.onChange(v === true)}
              />
            ) : null}
            {manage && !config.hideNew ? (
              <Button variant="primary" onClick={editor.openNew}>
                <Plus aria-hidden className="size-4" />
                {config.newLabel}
              </Button>
            ) : null}
          </>
        }
      />
      {config.toolbar}
      {config.error ? (
        <Banner tone="danger">{t('common.loadFailed')}</Banner>
      ) : (
        <DataTable
          label={config.tableLabel}
          columns={columns}
          rows={config.rows ?? []}
          getRowId={(row) => row.id}
          loading={config.loading}
          empty={
            <EmptyState
              icon={config.icon}
              title={config.emptyTitle}
              description={config.emptyDescription}
            />
          }
        />
      )}
      {config.footer}

      <FormDialog
        open={editor.target !== null}
        onOpenChange={(open) => !open && editor.close()}
        title={editing ? config.editTitle : config.newLabel}
        fields={config.fields.map((f) =>
          editing && f.name === 'state_type' ? { ...f, disabled: true } : f,
        )}
        initial={config.toInitial(editing?.value)}
        submitLabel={editing ? t('common.save') : config.createLabel}
        onSubmit={async (values) => {
          if (editing) await config.update(editing.value.id, values, editing.etag);
          else await config.create(values);
          await invalidate();
        }}
      />

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={config.archiveTitle(archiving ? config.rowName(archiving) : '')}
        description={config.archiveDescription}
        confirmLabel={t('common.archive')}
        destructive
        onConfirm={async () => {
          if (!archiving) return;
          // Failures stay in the dialog: a 409 names what still uses the record.
          await config.archive(archiving.id);
          await invalidate();
          toast({ variant: 'success', title: config.archivedToast });
        }}
      />
    </>
  );
}
