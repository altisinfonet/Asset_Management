'use client';

import { CircleCheck, CircleX, Hourglass, Wrench, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { useI18n } from '@/i18n';
import { moneyMajor, type Money } from '@/lib/money';
import { useLookups } from '@/lib/registry/queries';
import type { Repair, RepairStatus } from '@/lib/repairs/api';
import { routes } from '@/lib/routes';

const STATUS_STYLE: Record<RepairStatus, { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon }> = {
  open: { tone: 'warning', icon: Hourglass },
  in_progress: { tone: 'info', icon: Wrench },
  completed: { tone: 'success', icon: CircleCheck },
  cancelled: { tone: 'neutral', icon: CircleX },
};

/** Status of a repair: an icon and the words (colour never carries it alone). */
export function RepairStatusBadge({ status: given }: { status: RepairStatus | undefined }) {
  const { t } = useI18n();
  const status: RepairStatus = given ?? 'open';
  const { tone, icon } = STATUS_STYLE[status];
  return (
    <Badge tone={tone} icon={icon}>
      {t(`repairs.status.${status}`)}
    </Badge>
  );
}

/** A money amount formatted in its own currency. */
export function useMoneyText() {
  const { formatCurrency } = useI18n();
  return (money: Money | null | undefined): string =>
    money ? formatCurrency(moneyMajor(money), money.currency) : '';
}

/** The repairs as a table; the asset column is left out on an asset's own page. */
export function RepairTable({
  rows,
  loading,
  showAsset,
  onOpen,
  label,
  empty,
  className,
}: {
  rows: Repair[];
  loading?: boolean;
  showAsset: boolean;
  onOpen: (repair: Repair) => void;
  label: string;
  empty: React.ReactNode;
  className?: string;
}) {
  const { t, formatDate } = useI18n();
  const lookups = useLookups();
  const money = useMoneyText();

  const columns = useMemo<DataTableColumn<Repair>[]>(() => {
    const list: DataTableColumn<Repair>[] = [
      {
        id: 'reported',
        header: t('repairs.columns.reported'),
        width: '120px',
        cell: (row) => formatDate(row.reported_at ?? row.created_at ?? ''),
      },
    ];
    if (showAsset) {
      list.push({
        id: 'asset',
        header: t('repairs.columns.asset'),
        mono: true,
        cell: (row) =>
          row.asset_tag ? (
            <Link
              href={routes.assetView(row.asset_id)}
              onClick={(event) => event.stopPropagation()}
              className="rounded-sm text-primary-text underline underline-offset-2"
            >
              {row.asset_tag}
            </Link>
          ) : (
            ''
          ),
      });
    }
    list.push(
      {
        id: 'title',
        header: t('repairs.columns.title'),
        sticky: !showAsset,
        cell: (row) => (
          <button
            type="button"
            aria-label={t('repairs.openRepair', { title: row.title })}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(row);
            }}
            className="rounded-sm text-left text-primary-text underline underline-offset-2"
          >
            {row.title}
          </button>
        ),
      },
      {
        id: 'kind',
        header: t('repairs.columns.kind'),
        cell: (row) => t(`repairs.kinds.${row.kind ?? 'repair'}`),
      },
      {
        id: 'vendor',
        header: t('repairs.columns.vendor'),
        cell: (row) => lookups.vendorById.get(row.vendor_id ?? '')?.name ?? '',
      },
      { id: 'cost', header: t('repairs.columns.cost'), align: 'end', cell: (row) => money(row.cost) },
      {
        id: 'status',
        header: t('repairs.columns.status'),
        cell: (row) => <RepairStatusBadge status={row.status} />,
      },
    );
    return list;
    // `money` is stable per render of `useI18n`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, formatDate, lookups, showAsset, onOpen]);

  return (
    <DataTable
      label={label}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      getRowLabel={(row) => row.title}
      onRowClick={onOpen}
      onRowOpen={onOpen}
      loading={loading}
      empty={empty}
      className={className}
    />
  );
}
