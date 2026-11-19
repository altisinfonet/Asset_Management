'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Combobox } from '@/components/ui/combobox';
import { useT } from '@/i18n';
import { assetsApi } from '@/lib/registry/api';
import { useDebounced } from '@/lib/use-debounced';

export interface AssetRef {
  id: string;
  label: string;
}

export interface AssetPickerProps {
  value: AssetRef | null;
  onChange: (asset: AssetRef | null) => void;
  /** An asset that cannot be chosen (the one being handed over). */
  excludeId?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Type-ahead over assets by tag, serial or name (the target of "check out to another asset"). */
export function AssetPicker({ value, onChange, excludeId, ...rest }: AssetPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 200);

  const assets = useQuery({
    queryKey: ['asset-picker', q],
    queryFn: () => assetsApi.list({ limit: 15, ...(q ? { q } : {}), sort: ['asset_tag'] }),
    enabled: open,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const options = useMemo(
    () =>
      (assets.data?.data ?? [])
        .filter((asset) => asset.id !== excludeId)
        .map((asset) => ({
          value: asset.id,
          label: asset.name ? `${asset.asset_tag} - ${asset.name}` : asset.asset_tag,
        })),
    [assets.data, excludeId],
  );

  return (
    <Combobox
      {...rest}
      options={options}
      value={value?.id ?? null}
      selectedLabel={value?.label}
      loading={assets.isFetching}
      stale={assets.isPlaceholderData || query.trim() !== q}
      placeholder={t('picker.assetPlaceholder')}
      emptyText={t('picker.noAssets')}
      loadingText={t('common.loading')}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      onQueryChange={setQuery}
      onValueChange={(id, option) => onChange(id && option ? { id, label: option.label } : null)}
    />
  );
}
