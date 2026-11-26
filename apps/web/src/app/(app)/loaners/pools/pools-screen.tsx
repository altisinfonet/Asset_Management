'use client';

import { Pencil, Plus, Repeat } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PoolFormDialog } from '@/components/loaners/pool-form-dialog';
import { CustodyDefaults } from '@/components/settings/custody-defaults';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Banner } from '@/components/ui/banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { loanersApi, type LoanerPool } from '@/lib/loaners/api';
import { usePools } from '@/lib/loaners/queries';
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
      cell: (pool) =>
        pool.default_loan_days
          ? days(pool.default_loan_days)
          : pool.effective_default_loan_days === 1
            ? t('loanerPools.inheritedOne')
            : t('loanerPools.inherited', { count: pool.effective_default_loan_days }),
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
        <CustodyDefaults />
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
