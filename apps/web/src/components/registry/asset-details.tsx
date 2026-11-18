'use client';

import type { ReactNode } from 'react';
import { StatusBadge, type StateType as BadgeStateType } from '@/components/ui/badge';
import { useI18n } from '@/i18n';
import { formatValue } from '@/lib/registry/custom-fields';
import type { Lookups } from '@/lib/registry/queries';
import type { Asset } from '@/lib/registry/types';

/** The status of an asset as a badge: admin-chosen name, colour and icon from the state type. */
export function AssetStatusBadge({ asset, lookups }: { asset: Asset; lookups: Lookups }) {
  const label = lookups.statusById.get(asset.status_id);
  const name = label?.name ?? asset.status?.name;
  const type = (label?.state_type ?? asset.status?.state_type) as BadgeStateType | undefined;
  return type ? <StatusBadge type={type} label={name} /> : <span>{name ?? ''}</span>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted">{'-'}</span>}</dd>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-muted">{title}</h3>
      <dl className="grid grid-cols-[minmax(7rem,9rem)_1fr] gap-x-3 gap-y-2 text-base">
        {children}
      </dl>
    </section>
  );
}

/**
 * Read-only view of an asset's fields in the sections of the wireframe (WEB-05): details,
 * purchase and the custom fields of its category. Used by the detail page and the quick-view drawer.
 */
export function AssetDetails({ asset, lookups }: { asset: Asset; lookups: Lookups }) {
  const i18n = useI18n();
  const { t, formatDate, formatCurrency } = i18n;
  const model = lookups.modelById.get(asset.model_id ?? '');
  const manufacturer = model?.manufacturer_id
    ? lookups.manufacturerById.get(model.manufacturer_id)
    : undefined;
  const customFields = lookups.fieldsFor(asset.category_id);
  const date = (value?: string | null) =>
    value ? formatDate(`${value}T00:00:00Z`, { timeZone: 'UTC' }) : '';
  const cost = asset.purchase_cost
    ? formatCurrency(asset.purchase_cost.amount_minor / 100, asset.purchase_cost.currency)
    : '';

  return (
    <div className="flex flex-col gap-6">
      <Section title={t('assetView.sections.details')}>
        <Row label={t('assets.columns.category')}>
          {lookups.categoryById.get(asset.category_id)?.name}
        </Row>
        <Row label={t('assets.columns.model')}>
          {model ? `${manufacturer ? `${manufacturer.name} ` : ''}${model.name}` : ''}
        </Row>
        <Row label={t('assets.columns.status')}>
          <AssetStatusBadge asset={asset} lookups={lookups} />
        </Row>
        <Row label={t('assets.columns.serial')}>
          {asset.serial ? <span className="font-tag">{asset.serial}</span> : ''}
        </Row>
        <Row label={t('assets.columns.location')}>{lookups.locationLabel(asset.location_id)}</Row>
        <Row label={t('assetForm.notes')}>{asset.notes}</Row>
      </Section>
      <Section title={t('assetView.sections.purchase')}>
        <Row label={t('assetForm.purchaseDate')}>{date(asset.purchase_date)}</Row>
        <Row label={t('assetForm.cost')}>{cost}</Row>
        <Row label={t('assetForm.vendor')}>
          {lookups.vendorById.get(asset.vendor_id ?? '')?.name}
        </Row>
        <Row label={t('assetForm.orderNumber')}>{asset.order_number}</Row>
        <Row label={t('assetForm.warrantyEnd')}>{date(asset.warranty_end)}</Row>
      </Section>
      {customFields.length > 0 ? (
        <Section
          title={t('assetView.sections.customFields', {
            category: lookups.categoryById.get(asset.category_id)?.name ?? '',
          })}
        >
          {customFields.map((def) => (
            <Row key={def.id} label={def.label}>
              {formatValue(def, asset.custom_data?.[def.key], i18n)}
            </Row>
          ))}
        </Section>
      ) : null}
    </div>
  );
}
