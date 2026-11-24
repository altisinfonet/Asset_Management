'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Repeat } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { PoolFormDialog } from '@/components/loaners/pool-form-dialog';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { FormError } from '@/components/auth/form-error';
import { Banner } from '@/components/ui/banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { uiErrorText } from '@/lib/error-text';
import { loanersApi, type LoanerPool, type LoanSettings } from '@/lib/loaners/api';
import { loanKeys, useLoanSettings, usePools } from '@/lib/loaners/queries';
import { useLookups } from '@/lib/registry/queries';
import type { Versioned } from '@/lib/registry/types';
import { routes } from '@/lib/routes';

/**
 * Loaner pools and the organisation's loan defaults (M2-LOAN-04): who manages them can create and
 * edit a pool (name, home, default and longest loan, devices per borrower) and set the length a
 * loan gets when a pool does not say; everyone with `loaner:read` sees them.
 */
export function PoolsScreen() {
  const { t } = useI18n();
  const { can } = useAuth();
  const lookups = useLookups();
  const pools = usePools();
  const [editing, setEditing] = useState<Versioned<LoanerPool> | 'new' | null>(null);
  const canManage = can('loaner:manage');

  const openEdit = async (id: string) => setEditing(await loanersApi.pool(id));

  const days = (count: number | null | undefined) =>
    count ? t('loanerPools.days', { count }) : t('loanerPools.unlimited');

  const columns: DataTableColumn<LoanerPool>[] = [
    {
      id: 'name',
      header: t('loanerPools.columns.name'),
      sticky: true,
      cell: (pool) => (
        <Link
          href={routes.loanerPool(pool.id)}
          className="rounded-sm text-primary-text underline underline-offset-2"
        >
          {pool.name}
        </Link>
      ),
    },
    {
      id: 'location',
      header: t('loanerPools.columns.location'),
      cell: (pool) => (pool.home_location_id ? lookups.locationLabel(pool.home_location_id) : '-'),
    },
    {
      id: 'defaultDays',
      header: t('loanerPools.columns.defaultDays'),
      cell: (pool) => days(pool.default_loan_days),
    },
    {
      id: 'maxDays',
      header: t('loanerPools.columns.maxDays'),
      cell: (pool) => days(pool.max_loan_days),
    },
    {
      id: 'maxLoans',
      header: t('loanerPools.columns.maxLoans'),
      align: 'end',
      cell: (pool) => pool.max_loans_per_person ?? t('loanerPools.unlimited'),
    },
    {
      id: 'devices',
      header: t('loanerPools.columns.devices'),
      align: 'end',
      cell: (pool) => pool.member_count ?? 0,
    },
    {
      id: 'status',
      header: t('loanerPools.columns.status'),
      cell: (pool) =>
        pool.is_active === false ? (
          <Badge>{t('loanerPools.off')}</Badge>
        ) : (
          <Badge tone="success">{t('loanerPools.active')}</Badge>
        ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: t('loanerPools.columns.actions'),
            srOnlyHeader: true,
            align: 'end' as const,
            cell: (pool: LoanerPool) => (
              <Button
                size="sm"
                aria-label={t('loanerPools.editNamed', { name: pool.name })}
                onClick={() => void openEdit(pool.id)}
              >
                <Pencil aria-hidden className="size-4" />
                {t('loanerPools.edit')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageTitle title={t('loanerPools.title')} />
      <PageHeader
        title={t('loanerPools.title')}
        description={t('loanerPools.description')}
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus aria-hidden className="size-4" />
              {t('loanerPools.new')}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-8">
        <LoanDefaults />
        <section aria-label={t('loanerPools.tableLabel')} className="flex flex-col gap-3">
          {pools.isError ? (
            <Banner
              tone="danger"
              action={<Button onClick={() => void pools.refetch()}>{t('common.retry')}</Button>}
            >
              {t('loanerPools.loadFailed')}
            </Banner>
          ) : null}
          {pools.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <DataTable
              label={t('loanerPools.tableLabel')}
              columns={columns}
              rows={pools.data ?? []}
              getRowId={(pool) => pool.id}
              getRowLabel={(pool) => pool.name}
              empty={
                <EmptyState
                  icon={Repeat}
                  title={t('loanerPools.empty.title')}
                  description={t('loanerPools.empty.description')}
                />
              }
            />
          )}
        </section>
      </div>
      <PoolFormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        pool={editing && editing !== 'new' ? editing : undefined}
      />
    </>
  );
}

/** The tenant defaults (`GET/PUT /v1/settings/loans`): a loan's length when the pool has none, and the longest any pool may allow. */
function LoanDefaults() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const settings = useLoanSettings();
  const loaded = settings.data;
  const canManage = can('loaner:manage');
  const [values, setValues] = useState({ days: '', max: '', reminder: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form starts from what the server has
    setValues({
      days: String(loaded.value.default_loan_days),
      max: loaded.value.max_loan_days ? String(loaded.value.max_loan_days) : '',
      reminder: String(loaded.value.reminder_lead_days),
    });
  }, [loaded]);

  const whole = (text: string, min: number): number | null | typeof Number.NaN => {
    const trimmed = text.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isInteger(n) && n >= min ? n : Number.NaN;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const days = whole(values.days, 1);
    const max = whole(values.max, 1);
    const reminder = whole(values.reminder, 0);
    const next: Record<string, string> = {};
    if (days === null || Number.isNaN(days))
      next.days = t('loanerPools.defaults.errors.defaultDays');
    if (Number.isNaN(max)) next.max = t('loanerPools.defaults.errors.maxDays');
    else if (max !== null && days !== null && !Number.isNaN(days) && max < days) {
      next.max = t('loanerPools.defaults.errors.maxBelowDefault');
    }
    if (reminder === null || Number.isNaN(reminder)) {
      next.reminder = t('loanerPools.defaults.errors.reminder');
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    setFormError(null);
    try {
      const body: LoanSettings = {
        default_loan_days: days as number,
        max_loan_days: max,
        reminder_lead_days: reminder as number,
      };
      await loanersApi.putSettings(body, loaded?.etag);
      await client.invalidateQueries({ queryKey: loanKeys.settings });
      toast({ variant: 'success', title: t('loanerPools.defaults.saved') });
    } catch (err) {
      const ui = getApi().toUiError(err);
      const byField: Record<string, string> = {};
      for (const fe of ui.fieldErrors) {
        const key = {
          default_loan_days: 'days',
          max_loan_days: 'max',
          reminder_lead_days: 'reminder',
        }[fe.pointer.replace(/^\//, '')];
        if (key) byField[key] = fe.message;
      }
      setErrors(byField);
      setFormError(
        Object.keys(byField).length === ui.fieldErrors.length && ui.fieldErrors.length > 0
          ? null
          : ui,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="loan-defaults"
      className="flex max-w-2xl flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div>
        <h2 id="loan-defaults" className="text-lg font-semibold text-text">
          {t('loanerPools.defaults.heading')}
        </h2>
        <p className="text-base text-muted">{t('loanerPools.defaults.description')}</p>
      </div>
      {settings.isError ? (
        <Banner tone="danger">{t('loanerPools.defaults.loadFailed')}</Banner>
      ) : settings.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
          {formError ? (
            <FormError message={uiErrorText(t, formError)} requestId={formError.requestId} />
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t('loanerPools.defaults.defaultDays')} error={errors.days}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={values.days}
                  readOnly={!canManage}
                  invalid={!!errors.days}
                  onChange={(event) => setValues({ ...values, days: event.target.value })}
                />
              )}
            </Field>
            <Field
              label={t('loanerPools.defaults.maxDays')}
              hint={t('loanerPools.defaults.maxHint')}
              error={errors.max}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={values.max}
                  readOnly={!canManage}
                  invalid={!!errors.max}
                  onChange={(event) => setValues({ ...values, max: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('loanerPools.defaults.reminder')} error={errors.reminder}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={values.reminder}
                  readOnly={!canManage}
                  invalid={!!errors.reminder}
                  onChange={(event) => setValues({ ...values, reminder: event.target.value })}
                />
              )}
            </Field>
          </div>
          {canManage ? (
            <div>
              <Button type="submit" variant="primary" loading={saving}>
                {t('loanerPools.defaults.save')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted">{t('loanerPools.defaults.readOnly')}</p>
          )}
        </form>
      )}
    </section>
  );
}
