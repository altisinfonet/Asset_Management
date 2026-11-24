'use client';

import Link from 'next/link';
import { DepartmentPicker } from '@/components/registry/department-picker';
import { FormDialog, type FormFieldSpec } from '@/components/registry/form-dialog';
import { LocationPicker } from '@/components/registry/location-picker';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { peopleApi } from '@/lib/registry/api';
import { PERSON_KINDS, type Person, type PersonKind } from '@/lib/registry/types';
import { routes } from '@/lib/routes';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export interface PersonFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The person being edited (loaded fresh, with its ETag); undefined creates a new one. */
  person?: { value: Person; etag: string | undefined };
  onSaved: (person: Person, created: boolean) => Promise<void> | void;
}

/**
 * Create / edit dialog of a person (M2-USR-02). E-mail and employee number are unique per tenant:
 * the API's `409`/`422` answer is mapped back onto the field by `FormDialog`.
 */
export function PersonFormDialog({ open, onOpenChange, person, onSaved }: PersonFormDialogProps) {
  const t = useT();
  const { can } = useAuth();
  const editing = person?.value;

  const fields: FormFieldSpec[] = [
    { name: 'display_name', label: t('people.form.displayName'), kind: 'text', required: true },
    { name: 'first_name', label: t('people.form.firstName'), kind: 'text' },
    { name: 'last_name', label: t('people.form.lastName'), kind: 'text' },
    {
      name: 'kind',
      label: t('people.form.kind'),
      kind: 'select',
      required: true,
      options: PERSON_KINDS.map((kind) => ({ value: kind, label: t(`people.kinds.${kind}`) })),
    },
    {
      name: 'email',
      label: t('people.form.email'),
      kind: 'email',
      hint: t('people.form.emailHint'),
    },
    { name: 'phone', label: t('people.form.phone'), kind: 'text' },
    {
      name: 'employee_ref',
      label: t('people.form.employeeRef'),
      kind: 'text',
      hint: t('people.form.employeeRefHint'),
      mono: true,
    },
    {
      name: 'department_id',
      label: t('people.form.department'),
      kind: 'custom',
      hint: can('department:manage') ? (
        <>
          {t('people.form.departmentHint')}{' '}
          <Link
            href={routes.settings('departments')}
            className="rounded-sm text-primary-text underline underline-offset-2"
          >
            {t('departments.manage')}
          </Link>
        </>
      ) : (
        t('people.form.departmentHint')
      ),
      render: ({ control, value, set, invalid }) => (
        <DepartmentPicker
          {...control}
          invalid={invalid}
          clearable
          value={String(value)}
          selectedLabel={editing?.department ?? undefined}
          onChange={set}
          placeholder={t('people.form.noDepartment')}
        />
      ),
    },
    { name: 'job_title', label: t('people.form.jobTitle'), kind: 'text' },
    {
      name: 'location_id',
      label: t('people.form.location'),
      kind: 'custom',
      hint: t('people.form.locationHint'),
      render: ({ control, value, set, invalid }) => (
        <LocationPicker
          {...control}
          invalid={invalid}
          clearable
          value={String(value)}
          onChange={set}
          placeholder={t('people.form.noLocation')}
        />
      ),
    },
    ...(editing
      ? ([
          {
            name: 'status',
            label: t('people.form.status'),
            kind: 'select',
            required: true,
            hint: t('people.form.statusHint'),
            options: [
              { value: 'active', label: t('people.status.active') },
              { value: 'inactive', label: t('people.status.inactive') },
            ],
          },
        ] satisfies FormFieldSpec[])
      : []),
    { name: 'notes', label: t('people.form.notes'), kind: 'textarea' },
  ];

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={
        editing
          ? t('people.form.editTitle', { name: editing.display_name })
          : t('people.form.createTitle')
      }
      description={editing ? undefined : t('people.form.createDescription')}
      submitLabel={editing ? t('common.save') : t('people.form.create')}
      fields={fields}
      initial={{
        display_name: editing?.display_name ?? '',
        first_name: editing?.first_name ?? '',
        last_name: editing?.last_name ?? '',
        kind: editing?.kind ?? 'employee',
        email: editing?.email ?? '',
        phone: editing?.phone ?? '',
        employee_ref: editing?.employee_ref ?? '',
        department_id: editing?.department_id ?? '',
        job_title: editing?.job_title ?? '',
        location_id: editing?.location_id ?? '',
        status: editing?.status ?? 'active',
        notes: editing?.notes ?? '',
      }}
      onSubmit={async (values) => {
        const optional = (key: string) => text(values[key]) || null;
        if (editing && person) {
          const saved = await peopleApi.update(
            editing.id,
            {
              display_name: text(values.display_name),
              first_name: optional('first_name'),
              last_name: optional('last_name'),
              kind: values.kind as PersonKind,
              email: optional('email'),
              phone: optional('phone'),
              employee_ref: optional('employee_ref'),
              department_id: optional('department_id'),
              job_title: optional('job_title'),
              location_id: optional('location_id'),
              status: values.status as 'active' | 'inactive',
              notes: optional('notes'),
            },
            person.etag,
          );
          await onSaved(saved.value, false);
          return;
        }
        const created = await peopleApi.create({
          display_name: text(values.display_name),
          kind: values.kind as PersonKind,
          ...(text(values.first_name) ? { first_name: text(values.first_name) } : {}),
          ...(text(values.last_name) ? { last_name: text(values.last_name) } : {}),
          ...(text(values.email) ? { email: text(values.email) } : {}),
          ...(text(values.phone) ? { phone: text(values.phone) } : {}),
          ...(text(values.employee_ref) ? { employee_ref: text(values.employee_ref) } : {}),
          ...(text(values.department_id) ? { department_id: text(values.department_id) } : {}),
          ...(text(values.job_title) ? { job_title: text(values.job_title) } : {}),
          ...(text(values.location_id) ? { location_id: text(values.location_id) } : {}),
          ...(text(values.notes) ? { notes: text(values.notes) } : {}),
        });
        await onSaved(created.value, true);
      }}
    />
  );
}
