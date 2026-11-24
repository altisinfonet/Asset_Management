'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormDialog, type FormFieldSpec, type FormValues } from '@/components/registry/form-dialog';
import { LocationPicker } from '@/components/registry/location-picker';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { loanersApi, type LoanerPool } from '@/lib/loaners/api';
import { PERSON_KINDS } from '@/lib/loaners/helpers';
import { loanKeys } from '@/lib/loaners/queries';
import { usersApi } from '@/lib/registry/api';
import type { Versioned } from '@/lib/registry/types';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** A whole number from `min` up, or null for an empty field; `NaN` marks something that is not one. */
function wholeNumber(value: string | boolean | undefined, min: number): number | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : Number.NaN;
}

/** Create or edit a loaner pool (M2-LOAN-04): name, home, default and longest loan, per-borrower limit. */
export function PoolFormDialog({
  open,
  onOpenChange,
  pool,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The pool being edited, with the version the user saw; none creates a new one. */
  pool?: Versioned<LoanerPool>;
  onSaved?: (pool: LoanerPool) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const current = pool?.value;
  const { can } = useAuth();
  // the owner is one of the organisation's users; only someone who may read users can choose one
  const users = useQuery({
    queryKey: ['loaner-owner-users'],
    queryFn: () => usersApi.list({ limit: 100 }),
    select: (page) => page.data,
    enabled: open && can('user:read'),
    staleTime: 60_000,
  });

  const fields = useMemo<FormFieldSpec[]>(
    () => [
      {
        name: 'name',
        label: t('loanerPools.form.name'),
        kind: 'text',
        required: true,
        maxLength: 200,
        validate: (value) => (text(value) ? undefined : t('loanerPools.form.errors.name')),
      },
      {
        name: 'description',
        label: t('loanerPools.form.description'),
        kind: 'textarea',
      },
      {
        name: 'home_location_id',
        label: t('loanerPools.form.home'),
        kind: 'custom',
        hint: t('loanerPools.form.homeHint'),
        render: ({ control, value, set, invalid }) => (
          <LocationPicker
            {...control}
            invalid={invalid}
            clearable
            value={String(value)}
            onChange={set}
            placeholder={t('common.none')}
          />
        ),
      },
      {
        name: 'default_loan_days',
        label: t('loanerPools.form.defaultDays'),
        kind: 'number',
        min: 1,
        hint: t('loanerPools.form.defaultHint'),
        validate: (value) =>
          Number.isNaN(wholeNumber(value, 1))
            ? t('loanerPools.form.errors.defaultDays')
            : undefined,
      },
      {
        name: 'max_loan_days',
        label: t('loanerPools.form.maxDays'),
        kind: 'number',
        min: 1,
        hint: t('loanerPools.form.maxHint'),
        validate: (value, values) => {
          const max = wholeNumber(value, 1);
          if (Number.isNaN(max)) return t('loanerPools.form.errors.maxDays');
          const days = wholeNumber(values.default_loan_days, 1);
          return max !== null && days !== null && !Number.isNaN(days) && max < days
            ? t('loanerPools.form.errors.maxBelowDefault')
            : undefined;
        },
      },
      {
        name: 'max_loans_per_person',
        label: t('loanerPools.form.maxLoans'),
        kind: 'number',
        min: 1,
        hint: t('loanerPools.form.maxLoansHint'),
        validate: (value) =>
          Number.isNaN(wholeNumber(value, 1)) ? t('loanerPools.form.errors.maxLoans') : undefined,
      },
      {
        name: 'eligible_person_kinds',
        label: t('loanerPools.form.kinds'),
        kind: 'custom',
        hint: t('loanerPools.form.kindsHint'),
        render: ({ value, set }) => {
          const chosen = String(value).split(',').filter(Boolean);
          return (
            <div
              role="group"
              aria-label={t('loanerPools.form.kinds')}
              className="flex flex-wrap gap-x-5 gap-y-2"
            >
              {PERSON_KINDS.map((kind) => (
                <Checkbox
                  key={kind}
                  label={t(`loanerPools.form.kindNames.${kind}`)}
                  checked={chosen.includes(kind)}
                  onCheckedChange={(on) =>
                    set(
                      PERSON_KINDS.filter((k) =>
                        k === kind ? on === true : chosen.includes(k),
                      ).join(','),
                    )
                  }
                />
              ))}
            </div>
          );
        },
      },
      ...(users.data
        ? [
            {
              name: 'owner_user_id',
              label: t('loanerPools.form.owner'),
              kind: 'select' as const,
              hint: t('loanerPools.form.ownerHint'),
              emptyLabel: t('loanerPools.form.ownerNone'),
              options: users.data.map((user) => ({
                value: user.id,
                label: user.display_name ?? user.email,
              })),
            },
          ]
        : []),
      {
        name: 'email_borrowers_without_login',
        label: t('loanerPools.form.emailLogin'),
        kind: 'select',
        hint: t('loanerPools.form.emailLoginHint'),
        options: [
          { value: 'auto', label: t('loanerPools.form.emailAuto') },
          { value: 'always', label: t('loanerPools.form.emailAlways') },
          { value: 'never', label: t('loanerPools.form.emailNever') },
        ],
      },
      { name: 'is_active', label: t('loanerPools.form.active'), kind: 'checkbox' },
    ],
    [t, users.data],
  );

  const initial = useMemo<FormValues>(
    () => ({
      name: current?.name ?? '',
      description: current?.description ?? '',
      home_location_id: current?.home_location_id ?? '',
      default_loan_days: current?.default_loan_days ? String(current.default_loan_days) : '',
      email_borrowers_without_login:
        current?.email_borrowers_without_login === true
          ? 'always'
          : current?.email_borrowers_without_login === false
            ? 'never'
            : 'auto',
      max_loan_days: current?.max_loan_days ? String(current.max_loan_days) : '',
      max_loans_per_person: current?.max_loans_per_person
        ? String(current.max_loans_per_person)
        : '',
      eligible_person_kinds: (current?.eligible_person_kinds ?? []).join(','),
      owner_user_id: current?.owner_user_id ?? '',
      is_active: current?.is_active ?? true,
    }),
    [current],
  );

  const submit = async (values: FormValues) => {
    const kinds = PERSON_KINDS.filter((kind) =>
      text(values.eligible_person_kinds).split(',').includes(kind),
    );
    const body = {
      name: text(values.name),
      description: text(values.description) || null,
      home_location_id: text(values.home_location_id) || null,
      default_loan_days: wholeNumber(values.default_loan_days, 1),
      email_borrowers_without_login:
        values.email_borrowers_without_login === 'always'
          ? true
          : values.email_borrowers_without_login === 'never'
            ? false
            : null,
      max_loan_days: wholeNumber(values.max_loan_days, 1),
      max_loans_per_person: wholeNumber(values.max_loans_per_person, 1),
      eligible_person_kinds: kinds.length > 0 ? kinds : null,
      owner_user_id: text(values.owner_user_id) || null,
      is_active: values.is_active === true,
    };
    const saved = pool
      ? await loanersApi.updatePool(pool.value.id, body, pool.etag)
      : await loanersApi.createPool(body);
    await client.invalidateQueries({ queryKey: loanKeys.all });
    toast({
      variant: 'success',
      title: pool
        ? t('loanerPools.form.saved', { name: body.name })
        : t('loanerPools.form.created', { name: body.name }),
    });
    onSaved?.(saved.value);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        pool
          ? t('loanerPools.form.editTitle', { name: current!.name })
          : t('loanerPools.form.createTitle')
      }
      fields={fields}
      initial={initial}
      submitLabel={pool ? t('loanerPools.form.save') : t('loanerPools.form.create')}
      onSubmit={submit}
    />
  );
}
