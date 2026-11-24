'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { DepartmentPicker } from '@/components/registry/department-picker';
import { FormDialog, type FormFieldSpec } from '@/components/registry/form-dialog';
import { PersonPicker, type PersonRef } from '@/components/registry/person-picker';
import { SectionHeader } from '@/components/registry/section-header';
import { useEditor } from '@/components/registry/use-runner';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { uiErrorText, usageSummary } from '@/lib/error-text';
import { departmentsApi, fetchAll } from '@/lib/registry/api';
import { useDepartments, useInvalidateLookups } from '@/lib/registry/queries';
import type { Department } from '@/lib/registry/types';
import { routes } from '@/lib/routes';

const str = (value: unknown): string => String(value ?? '').trim();

/**
 * Settings -> Departments (ED-17): the managed list people and assets are assigned to. Everybody who can
 * read departments sees the list (with how many people and assets each has); `department:manage` adds
 * create, edit, archive and merge. Archiving a department that is still used answers `409` with the
 * counts; the dialog then offers to move them all to another department, which merges the two.
 */
export function DepartmentsScreen() {
  const t = useT();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const invalidate = useInvalidateLookups();
  const manage = can('department:manage');
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<Department | null>(null);
  const editor = useEditor<Department>(departmentsApi.get);
  const editing = editor.target?.kind === 'edit' ? editor.target.versioned : undefined;
  // names of the people chosen as manager in the open dialog (the picker shows a name, the form keeps an id)
  const [managerNames, setManagerNames] = useState<Record<string, string>>({});

  const list = useQuery({
    queryKey: ['lookup', 'departments-table', showArchived],
    queryFn: () =>
      fetchAll<Department>((cursor) =>
        departmentsApi.list({
          limit: 200,
          cursor,
          sort: ['name'],
          archived: showArchived ? 'include' : 'exclude',
        }),
      ),
  });
  const rows = useMemo(() => list.data ?? [], [list.data]);

  const refresh = async () => {
    await Promise.all([
      invalidate(),
      client.invalidateQueries({ queryKey: ['people'] }),
      client.invalidateQueries({ queryKey: ['assets'] }),
    ]);
  };

  const columns = useMemo<DataTableColumn<Department>[]>(
    () => [
      {
        id: 'name',
        header: t('departments.columns.name'),
        sticky: true,
        cell: (row) => (
          <span className={row.archived_at ? 'text-muted' : undefined}>
            {row.name}
            {row.archived_at ? ` (${t('common.archived')})` : ''}
          </span>
        ),
      },
      { id: 'code', header: t('departments.columns.code'), mono: true, cell: (r) => r.code ?? '' },
      {
        id: 'manager',
        header: t('departments.columns.manager'),
        cell: (row) => row.manager_name ?? '',
      },
      {
        id: 'people',
        header: t('departments.columns.people'),
        align: 'end',
        cell: (row) =>
          (row.person_count ?? 0) > 0 ? (
            <Link
              href={routes.peopleInDepartment(row.id)}
              className="rounded-sm text-primary-text underline underline-offset-2"
            >
              {row.person_count}
            </Link>
          ) : (
            (row.person_count ?? 0)
          ),
      },
      {
        id: 'assets',
        header: t('departments.columns.assets'),
        align: 'end',
        cell: (row) =>
          (row.asset_count ?? 0) > 0 ? (
            <Link
              href={routes.assetsFiltered({ department: row.id })}
              className="rounded-sm text-primary-text underline underline-offset-2"
            >
              {row.asset_count}
            </Link>
          ) : (
            (row.asset_count ?? 0)
          ),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        srOnlyHeader: true,
        align: 'end',
        cell: (row) =>
          manage && !row.archived_at ? (
            <span className="inline-flex flex-wrap justify-end gap-1">
              <Button
                size="sm"
                onClick={() => void editor.openEdit(row.id)}
                aria-label={t('common.editNamed', { name: row.name })}
              >
                {t('common.edit')}
              </Button>
              <Button
                size="sm"
                onClick={() => setArchiving(row)}
                aria-label={t('common.archiveNamed', { name: row.name })}
              >
                {t('common.archive')}
              </Button>
            </span>
          ) : null,
      },
    ],
    [t, manage, editor],
  );

  const fields: FormFieldSpec[] = [
    {
      name: 'name',
      label: t('departments.form.name'),
      kind: 'text',
      required: true,
      hint: t('departments.form.nameHint'),
      maxLength: 200,
    },
    {
      name: 'code',
      label: t('departments.form.code'),
      kind: 'text',
      hint: t('departments.form.codeHint'),
      mono: true,
      maxLength: 50,
    },
    {
      name: 'description',
      label: t('departments.form.description'),
      kind: 'textarea',
      maxLength: 2000,
    },
    {
      name: 'manager_person_id',
      label: t('departments.form.manager'),
      kind: 'custom',
      render: ({ control, value, set, invalid }) => (
        <PersonPicker
          {...control}
          invalid={invalid}
          clearable
          includeInactive
          placeholder={t('departments.form.noManager')}
          value={
            value
              ? {
                  id: String(value),
                  display_name:
                    managerNames[String(value)] ??
                    (editing?.value.manager_person_id === value
                      ? (editing.value.manager_name ?? '')
                      : ''),
                }
              : null
          }
          onChange={(person: PersonRef | null) => {
            if (person)
              setManagerNames((names) => ({ ...names, [person.id]: person.display_name }));
            set(person?.id ?? '');
          }}
        />
      ),
    },
  ];

  return (
    <>
      <SectionHeader
        section="departments"
        title={t('departments.title')}
        description={t('departments.description')}
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
                {t('departments.add')}
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
          {t('departments.loadFailed')}
        </Banner>
      ) : (
        <DataTable
          label={t('departments.tableLabel')}
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={list.isLoading}
          empty={
            <EmptyState
              icon={Users}
              title={t('departments.emptyTitle')}
              description={t('departments.emptyDescription')}
              actions={
                manage ? (
                  <Button variant="primary" onClick={editor.openNew}>
                    <Plus aria-hidden className="size-4" />
                    {t('departments.addFirst')}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <FormDialog
        // a reloaded version (new ETag) starts the form over with its values
        key={editing ? `${editing.value.id}:${editing.etag ?? ''}` : 'department'}
        open={editor.target !== null}
        onOpenChange={(open) => !open && editor.close()}
        title={
          editing
            ? t('departments.form.editTitle', { name: editing.value.name })
            : t('departments.form.createTitle')
        }
        submitLabel={editing ? t('common.save') : t('departments.form.create')}
        fields={fields}
        initial={{
          name: editing?.value.name ?? '',
          code: editing?.value.code ?? '',
          description: editing?.value.description ?? '',
          manager_person_id: editing?.value.manager_person_id ?? '',
        }}
        onReload={editing ? () => editor.openEdit(editing.value.id) : undefined}
        onSubmit={async (values) => {
          const body = {
            name: str(values.name),
            code: str(values.code) || null,
            description: str(values.description) || null,
            manager_person_id: str(values.manager_person_id) || null,
          };
          if (editing) {
            await departmentsApi.update(editing.value.id, body, editing.etag);
            toast({ variant: 'success', title: t('departments.updated', { name: body.name }) });
          } else {
            await departmentsApi.create(body);
            toast({ variant: 'success', title: t('departments.created', { name: body.name }) });
          }
          await refresh();
        }}
      />

      <ArchiveDepartmentDialog
        department={archiving}
        onClose={() => setArchiving(null)}
        onDone={async (message) => {
          await refresh();
          toast({ variant: 'success', title: message });
        }}
      />
    </>
  );
}

/**
 * "Archive X?" - and, when the API says the department is still used (`409` with the counts), the same
 * dialog turns into "X is still in use": it names the counts and asks where to move them, then archives
 * with `reassign_to` (a merge).
 */
function ArchiveDepartmentDialog({
  department,
  onClose,
  onDone,
}: {
  department: Department | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const t = useT();
  const [usage, setUsage] = useState<UiError['usage']>(undefined);
  const [target, setTarget] = useState('');
  const departments = useDepartments();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const inUse = usage !== undefined;

  const close = () => {
    setUsage(undefined);
    setTarget('');
    setError(null);
    onClose();
  };

  const confirm = async () => {
    if (!department) return;
    setBusy(true);
    setError(null);
    try {
      await departmentsApi.archive(department.id, inUse ? { reassignTo: target } : {});
      await onDone(
        inUse
          ? t('departments.merged', {
              name: departments.data?.find((d) => d.id === target)?.name ?? '',
            })
          : t('departments.archived'),
      );
      close();
    } catch (err) {
      const ui = getApi().toUiError(err);
      if (ui.status === 409 && ui.usage && !inUse) setUsage(ui.usage);
      else setError(ui);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={department !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {inUse
              ? t('departments.archive.inUseTitle', { name: department?.name ?? '' })
              : t('departments.archive.title', { name: department?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {inUse
              ? t('departments.archive.inUseDescription')
              : t('departments.archive.description')}
          </DialogDescription>
        </DialogHeader>
        {inUse ? (
          <>
            <Banner tone="warning">
              {t('departments.archive.inUse', { usage: usageSummary(t, usage) })}
            </Banner>
            <Field
              label={t('departments.archive.mergeInto')}
              hint={t('departments.archive.mergeHint', { name: department?.name ?? '' })}
              required
            >
              {(control) => (
                <DepartmentPicker
                  {...control}
                  value={target}
                  excludeId={department?.id}
                  onChange={setTarget}
                />
              )}
            </Field>
          </>
        ) : null}
        {error ? <FormError message={uiErrorText(t, error)} requestId={error.requestId} /> : null}
        <DialogFooter>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={inUse && !target}
            onClick={() => void confirm()}
          >
            {inUse ? t('departments.archive.merge') : t('departments.archive.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
