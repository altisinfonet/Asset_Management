'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { PersonPicker, type PersonRef } from '@/components/registry/person-picker';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import {
  importsApi,
  type ImportJob,
  type ImportLookup,
  type ImportLookupValue,
  type ImportReference,
  type ValueMap,
} from '@/lib/imports/api';
import {
  canCreateMissing,
  createAllMissing,
  openValueCount,
  unmatchedValues,
} from '@/lib/imports/helpers';
import { useLookups } from '@/lib/registry/queries';
import { routes } from '@/lib/routes';

const OPEN = '__open__';

/** The existing records of one kind, as select options (people use the type-ahead picker instead). */
function useExistingOptions(reference: ImportReference) {
  const lookups = useLookups();
  return useMemo(() => {
    switch (reference) {
      case 'category':
        return lookups.categories
          .filter((c) => !c.archived_at)
          .map((c) => ({ value: c.id, label: c.name }));
      case 'manufacturer':
        return lookups.manufacturers
          .filter((c) => !c.archived_at)
          .map((c) => ({ value: c.id, label: c.name }));
      case 'asset_model':
        return lookups.models
          .filter((c) => !c.archived_at)
          .map((c) => ({ value: c.id, label: c.name }));
      case 'location':
        return lookups.locations
          .filter((c) => !c.archived_at)
          .map((c) => ({ value: c.id, label: lookups.locationLabel(c.id) }));
      case 'department':
        return lookups.departments
          .filter((c) => !c.archived_at)
          .map((c) => ({ value: c.id, label: c.name }));
      case 'vendor':
        return lookups.vendors
          .filter((c) => !c.archived_at)
          .map((c) => ({ value: c.id, label: c.name }));
      case 'status_label':
        return lookups.statuses
          .filter((c) => !c.archived_at)
          .map((c) => ({ value: c.id, label: c.name }));
      default:
        return [];
    }
  }, [reference, lookups]);
}

/**
 * Step "Match values" (WEB-14, M2-IMP-03): for every reference column (category, model, location,
 * person ...) the values of the file that match no record yet, each with how many rows carry it and
 * a decision: create it, use an existing record, or leave the field empty. "Create all that are
 * missing" decides the lot for everything the importer may create. Matched values need nothing.
 */
export function StepValues({ job }: { job: ImportJob }) {
  const { t } = useI18n();
  const router = useRouter();
  const client = useQueryClient();
  const lookups = useQuery({
    queryKey: ['import', job.id, 'lookups'],
    queryFn: () => importsApi.lookups(job.id),
  });
  const [valueMap, setValueMap] = useState<ValueMap>(
    () => (job.options?.value_map as ValueMap | undefined) ?? {},
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const data = lookups.data ?? [];
  const missing = unmatchedValues(data);
  const open = openValueCount(data, valueMap);
  const matchedCount = data.reduce(
    (sum, lookup) => sum + lookup.values.filter((v) => v.match !== null).length,
    0,
  );

  const choose = (field: string, value: string, choice: ValueMap[string][string] | null) =>
    setValueMap((current) => {
      const next: ValueMap = { ...current, [field]: { ...(current[field] ?? {}) } };
      if (choice) next[field]![value] = choice;
      else delete next[field]![value];
      return next;
    });

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await importsApi.update(job.id, { options: { value_map: valueMap } });
      await importsApi.startDryRun(job.id);
      await client.invalidateQueries({ queryKey: ['import', job.id] });
      router.replace(routes.importJob(job.id));
    } catch (err) {
      setError(getApi().toUiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (lookups.isError) {
    return (
      <Banner
        tone="danger"
        action={<Button onClick={() => void lookups.refetch()}>{t('common.retry')}</Button>}
      >
        {t('importValues.loadFailed')}
      </Banner>
    );
  }

  return (
    <section aria-labelledby="import-values-heading" className="flex flex-col gap-5">
      <div>
        <h2 id="import-values-heading" className="text-lg font-semibold text-text">
          {t('importValues.heading')}
        </h2>
        <p className="text-base text-muted">{t('importValues.description')}</p>
      </div>

      {lookups.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : missing.length === 0 ? (
        <Banner tone="success">{t('importValues.allMatched')}</Banner>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setValueMap(createAllMissing(data, valueMap))}>
              {t('importValues.createAll')}
            </Button>
            <p className="text-sm text-muted" role="status" data-testid="import-values-open">
              {open > 0 ? t('importValues.open', { count: open }) : null}
              {matchedCount > 0
                ? `${open > 0 ? ' ' : ''}${t('importValues.matched', { count: matchedCount })}`
                : null}
            </p>
          </div>
          {missing.map((lookup) => (
            <LookupTable key={lookup.field} lookup={lookup} valueMap={valueMap} onChoose={choose} />
          ))}
        </>
      )}

      {error ? (
        <FormError
          message={`${t('importValues.saveFailed')} ${uiErrorText(t, error)}`}
          requestId={error.requestId}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link href={routes.importJob(job.id, 'mapping')}>{t('imports.back')}</Link>
        </Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={lookups.isPending}
          onClick={() => void submit()}
        >
          {t('importValues.continue')}
          <ArrowRight aria-hidden className="size-4" />
        </Button>
      </div>
    </section>
  );
}

function LookupTable({
  lookup,
  valueMap,
  onChoose,
}: {
  lookup: ImportLookup;
  valueMap: ValueMap;
  onChoose: (field: string, value: string, choice: ValueMap[string][string] | null) => void;
}) {
  const { t, formatNumber } = useI18n();
  const existing = useExistingOptions(lookup.reference);
  const refName = t(`importValues.refs.${lookup.reference}`);
  const create = canCreateMissing(lookup.reference);
  /** Names of the people picked here, to show them again (the decision itself keeps only the id). */
  const [names, setNames] = useState<Record<string, string>>({});

  const columns: DataTableColumn<ImportLookupValue>[] = [
    {
      id: 'value',
      header: t('importValues.columns.value'),
      sticky: true,
      cell: (row) => <span className="font-medium text-text">{row.value}</span>,
    },
    {
      id: 'rows',
      header: t('importValues.columns.rows'),
      align: 'end',
      cell: (row) => formatNumber(row.rows),
    },
    {
      id: 'action',
      header: t('importValues.columns.action'),
      cell: (row) => {
        const choice = valueMap[lookup.field]?.[row.value];
        return (
          <Select
            size="sm"
            variant="ghost"
            className="-ml-2 min-w-44"
            aria-label={t('importValues.choose', { value: row.value })}
            value={choice?.action ?? OPEN}
            onValueChange={(action) =>
              onChoose(
                lookup.field,
                row.value,
                action === OPEN ? null : { action: action as 'create' | 'map' | 'skip' },
              )
            }
            options={[
              { value: OPEN, label: t('importValues.actions.open') },
              ...(create ? [{ value: 'create', label: t('importValues.actions.create') }] : []),
              { value: 'map', label: t('importValues.actions.map') },
              { value: 'skip', label: t('importValues.actions.skip') },
            ]}
          />
        );
      },
    },
    {
      id: 'existing',
      header: t('importValues.columns.existing'),
      cell: (row) => {
        const choice = valueMap[lookup.field]?.[row.value];
        if (choice?.action !== 'map') return '-';
        return lookup.reference === 'person' ? (
          <PersonPicker
            aria-label={t('importValues.pickExisting', { value: row.value })}
            value={
              choice.id
                ? ({
                    id: choice.id,
                    display_name: names[row.value] ?? t('importValues.savedChoice'),
                  } as PersonRef)
                : null
            }
            onChange={(person) => {
              if (person) setNames((current) => ({ ...current, [row.value]: person.display_name }));
              onChoose(lookup.field, row.value, {
                action: 'map',
                ...(person ? { id: person.id } : {}),
              });
            }}
          />
        ) : (
          <Select
            size="sm"
            variant="ghost"
            className="-ml-2 min-w-44"
            aria-label={t('importValues.pickExisting', { value: row.value })}
            placeholder={t('importValues.pickPlaceholder')}
            value={choice.id}
            options={existing}
            onValueChange={(id) => onChoose(lookup.field, row.value, { action: 'map', id })}
          />
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-text">
        {t('importValues.fieldHeading', { field: refName })}
      </h3>
      {!create ? <p className="text-sm text-muted">{t('importValues.neverCreated')}</p> : null}
      <DataTable
        label={t('importValues.tableLabel', { field: refName })}
        columns={columns}
        rows={lookup.values}
        getRowId={(row) => row.value}
        getRowLabel={(row) => row.value}
      />
    </div>
  );
}
