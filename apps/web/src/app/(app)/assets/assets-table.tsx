'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BulkActionBar, DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { useT } from '@/i18n';
import { routes } from '@/lib/routes';
import { SAMPLE_ASSETS, type SampleAsset } from '@/lib/sample-assets';
import { Package } from 'lucide-react';

/**
 * Assets list shell (WEB-04): row click opens the 480px quick-view drawer, Enter opens the full
 * page, Space selects. The registry story replaces the sample rows with API data and adds
 * filtering, saved views, virtualisation and the column picker.
 */
export function AssetsTable({ empty = false }: { empty?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<SampleAsset | null>(null);
  const rows = empty ? [] : SAMPLE_ASSETS;

  const columns = useMemo<DataTableColumn<SampleAsset>[]>(
    () => [
      {
        id: 'tag',
        header: t('assets.columns.tag'),
        mono: true,
        sticky: true,
        width: '120px',
        sortable: true,
        cell: (row) => (
          <Link
            href={routes.assetView(row.id)}
            onClick={(e) => e.stopPropagation()}
            className="rounded-sm text-primary-text underline underline-offset-2"
          >
            {row.tag}
          </Link>
        ),
      },
      { id: 'name', header: t('assets.columns.name'), cell: (row) => row.name, sortable: true },
      { id: 'model', header: t('assets.columns.model'), cell: (row) => row.model },
      {
        id: 'status',
        header: t('assets.columns.status'),
        cell: (row) => <StatusBadge type={row.state} label={row.statusLabel} />,
      },
      { id: 'location', header: t('assets.columns.location'), cell: (row) => row.location },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Select
          aria-label={t('table.density')}
          value={density}
          onValueChange={(v) => setDensity(v as typeof density)}
          options={[
            { value: 'comfortable', label: t('table.comfortable') },
            { value: 'compact', label: t('table.compact') },
          ]}
          className="w-44"
        />
      </div>
      <DataTable
        label={t('assets.tableLabel')}
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.tag}
        density={density}
        selectable
        selectedIds={selected}
        onSelectedIdsChange={setSelected}
        onRowClick={setOpen}
        onRowOpen={(row) => router.push(routes.assetView(row.id))}
        empty={
          <EmptyState
            icon={Package}
            title={t('assets.emptyTitle')}
            description={t('assets.emptyDescription')}
          />
        }
      />
      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())} />

      <Drawer open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="font-tag">{open?.tag}</DrawerTitle>
            <DrawerDescription>{open?.name}</DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            {open ? (
              <dl className="grid grid-cols-[8rem_1fr] gap-y-3 text-base">
                <dt className="text-muted">{t('assets.columns.model')}</dt>
                <dd>{open.model}</dd>
                <dt className="text-muted">{t('assets.columns.status')}</dt>
                <dd>
                  <StatusBadge type={open.state} label={open.statusLabel} />
                </dd>
                <dt className="text-muted">{t('assets.columns.location')}</dt>
                <dd>{open.location}</dd>
              </dl>
            ) : null}
          </DrawerBody>
          <DrawerFooter>
            {open ? (
              <Button asChild variant="primary">
                <Link href={routes.assetView(open.id)}>{t('common.openFullPage')}</Link>
              </Button>
            ) : null}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
