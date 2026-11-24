'use client';

import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { PersonPicker, type PersonRef } from '@/components/registry/person-picker';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/i18n';
import {
  importKeys,
  importsApi,
  type ImportJob,
  type ImportOptions,
  type ImportRefKind,
  type ImportValue,
  type ImportValueEntry,
  type ImportValueMap,
} from '@/lib/imports/api';
import { importErrorText, type ImportErrorText } from '@/lib/imports/error-text';
import {
  canCreate,
  createAllMissing,
  entryFor,
  entryKind,
  mappedRefKinds,
  needsDecision,
  normValue,
  policyOf,
  withEntry,
} from '@/lib/imports/helpers';
import { useLookups } from '@/lib/registry/queries';
import { useDebounced } from '@/lib/use-debounced';
import { routes } from '@/lib/routes';

const AUTO = 'auto';

type Policies = NonNullable<ImportOptions['references']>;

/** The existing records of one kind, as select options (people use the type-ahead picker instead). */
function useExistingOptions(kind: ImportRefKind) {
  const lookups = useLookups();
  return useMemo(() => {
    const live = <T extends { archived_at?: string | null }>(list: T[]) =>
      list.filter((item) => !item.archived_at);
    switch (kind) {
      case 'category':
        return live(lookups.categories).map((c) => ({ value: c.id, label: c.name }));
      case 'manufacturer':
        return live(lookups.manufacturers).map((c) => ({ value: c.id, label: c.name }));
      case 'model':
        return live(lookups.models).map((c) => ({ value: c.id, label: c.name }));
      case 'location':
        return live(lookups.locations).map((c) => ({
          value: c.id,
          label: lookups.locationLabel(c.id),
        }));
      case 'department':
        return live(lookups.departments).map((c) => ({ value: c.id, label: c.name }));
      case 'vendor':
        return live(lookups.vendors).map((c) => ({ value: c.id, label: c.name }));
      case 'status':
        return live(lookups.statuses).map((c) => ({ value: c.id, label: c.name }));
      default:
        return [];
    }
  }, [kind, lookups]);
}

/**
 * Step "Match values" (WEB-14, M2-IMP-03): for every reference column (category, model, location,
 * person ...) the distinct values of the file with how many rows carry each, the record each one
 * matches by name, and a decision: use the match, use another record, create it, or leave the field
 * empty. A kind has a policy for what matches nothing (create it, or report an error). "Create all
 * that are missing" decides the lot for everything the importer may create. The decisions are the
 * job's value map (keyed by the normalised value); saving them returns a reviewed dry run to
 * `mapped`, so the dry run is requested again.
 */
export function StepValues({ job, etag }: { job: ImportJob; etag: string | undefined }) {
  const { t } = useI18n();
  const router = useRouter();
  const client = useQueryClient();
  const kinds = useMemo(() => mappedRefKinds(job.entity_type, job.mapping), [job]);
  const lists = useQueries({
    queries: kinds.map((kind) => ({
      queryKey: importKeys.values(job.id, kind),
      queryFn: () => importsApi.values(job.id, kind, { limit: 200 }),
    })),
  });
  const [valueMap, setValueMap] = useState<ImportValueMap>(() => job.value_map ?? {});
  const [policies, setPolicies] = useState<Policies>(() => ({ ...job.options.references }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ImportErrorText | null>(null);
  const latestEtag = useRef(etag);

  const options = useMemo(() => ({ references: policies }), [policies]);
  const loading = lists.some((list) => list.isPending);
  const failed = lists.find((list) => list.isError);
  const groups = kinds.map((kind, i) => ({ kind, values: lists[i]?.data?.data ?? [] }));
  const open = groups.reduce(
    (sum, group) =>
      sum + group.values.filter((v) => needsDecision(v, group.kind, options, valueMap)).length,
    0,
  );
  const matched = groups.reduce(
    (sum, group) => sum + group.values.filter((v) => v.suggestion).length,
    0,
  );

  const choose = (kind: ImportRefKind, value: string, entry: ImportValueEntry | null) =>
    setValueMap((current) => withEntry(current, kind, value, entry));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const value_map: ImportValueMap = {};
      for (const kind of kinds) value_map[kind] = valueMap[kind] ?? {};
      const updated = await importsApi.update(
        job.id,
        { value_map, options: { references: policies } },
        latestEtag.current,
      );
      latestEtag.current = updated.etag;
      await importsApi.startDryRun(job.id);
      await client.invalidateQueries({ queryKey: importKeys.job(job.id) });
      router.replace(routes.importJob(job.id));
    } catch (err) {
      setError(importErrorText(t, err, t('importValues.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  if (failed) {
    return (
      <Banner
        tone="danger"
        action={<Button onClick={() => void failed.refetch()}>{t('common.retry')}</Button>}
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

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {open === 0 ? (
            <Banner tone="success">{t('importValues.allMatched')}</Banner>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setValueMap(createAllMissing(groups, valueMap))}>
                {t('importValues.createAll')}
              </Button>
              <p className="text-sm text-muted" role="status" data-testid="import-values-open">
                {t('importValues.open', { count: open })}
                {matched > 0 ? ` ${t('importValues.matched', { count: matched })}` : null}
              </p>
            </div>
          )}
          {groups.map((group, i) => (
            <ValueGroup
              key={group.kind}
              job={job}
              kind={group.kind}
              values={group.values}
              distinct={lists[i]?.data?.distinct ?? 0}
              column={lists[i]?.data?.column ?? null}
              valueMap={valueMap}
              policies={policies}
              onPolicy={(kind, policy) =>
                setPolicies((current) => ({ ...current, [kind]: policy }))
              }
              onChoose={choose}
            />
          ))}
        </>
      )}

      {error ? (
        <FormError message={error.message} requestId={error.requestId} details={error.details} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link href={routes.importJob(job.id, 'mapping')}>{t('imports.back')}</Link>
        </Button>
        <Button variant="primary" loading={saving} disabled={loading} onClick={() => void submit()}>
          {t('importValues.continue')}
          <ArrowRight aria-hidden className="size-4" />
        </Button>
      </div>
    </section>
  );
}

function ValueGroup({
  job,
  kind,
  values,
  distinct,
  column,
  valueMap,
  policies,
  onPolicy,
  onChoose,
}: {
  job: ImportJob;
  kind: ImportRefKind;
  values: ImportValue[];
  distinct: number;
  column: string | null;
  valueMap: ImportValueMap;
  policies: Policies;
  onPolicy: (kind: ImportRefKind, policy: 'create' | 'must_exist') => void;
  onChoose: (kind: ImportRefKind, value: string, entry: ImportValueEntry | null) => void;
}) {
  const { t, formatNumber } = useI18n();
  const existing = useExistingOptions(kind);
  const refName = t(`importValues.refs.${kind}`);
  const creatable = canCreate(kind);
  const policy = policyOf({ references: policies }, kind);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  /** Values that were set to "use an existing one" and wait for the record to be picked. */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  /** Names of the people picked here, to show them again (the decision itself keeps only the id). */
  const [names, setNames] = useState<Record<string, string>>({});
  const found = useQuery({
    queryKey: [...importKeys.values(job.id, kind), 'q', q],
    queryFn: () => importsApi.values(job.id, kind, { limit: 200, q }),
    enabled: q !== '',
  });
  const shown = q !== '' ? (found.data?.data ?? []) : values;

  const actionOf = (row: ImportValue): string => {
    const kindOfEntry = entryKind(entryFor(valueMap, kind, row.value));
    if (kindOfEntry) return kindOfEntry;
    return pending.has(normValue(row.value)) ? 'use' : AUTO;
  };

  const columns: DataTableColumn<ImportValue>[] = [
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
      cell: (row) => formatNumber(row.count),
    },
    {
      id: 'status',
      header: t('importValues.columns.status'),
      cell: (row) => {
        if (actionOf(row) !== AUTO) return <Badge>{t('importValues.status.decided')}</Badge>;
        if (row.suggestion) {
          return (
            <Badge tone="success">
              {t('importValues.status.matches', { name: row.suggestion.name })}
            </Badge>
          );
        }
        return policy === 'create' && creatable ? (
          <Badge tone="info">{t('importValues.status.willCreate')}</Badge>
        ) : (
          <Badge tone="danger">{t('importValues.status.notFound')}</Badge>
        );
      },
    },
    {
      id: 'action',
      header: t('importValues.columns.action'),
      cell: (row) => (
        <Select
          size="sm"
          variant="ghost"
          className="-ml-2 min-w-44"
          aria-label={t('importValues.choose', { value: row.value })}
          value={actionOf(row)}
          options={[
            { value: AUTO, label: t('importValues.actions.auto') },
            { value: 'use', label: t('importValues.actions.use') },
            ...(creatable ? [{ value: 'create', label: t('importValues.actions.create') }] : []),
            { value: 'skip', label: t('importValues.actions.skip') },
          ]}
          onValueChange={(action) => {
            const key = normValue(row.value);
            setPending((current) => {
              const next = new Set(current);
              if (action === 'use' && !row.suggestion) next.add(key);
              else next.delete(key);
              return next;
            });
            if (action === AUTO) onChoose(kind, row.value, null);
            else if (action === 'create') onChoose(kind, row.value, { create: true });
            else if (action === 'skip') onChoose(kind, row.value, { skip: true });
            else if (row.suggestion) onChoose(kind, row.value, { id: row.suggestion.id });
            else onChoose(kind, row.value, null);
          }}
        />
      ),
    },
    {
      id: 'existing',
      header: t('importValues.columns.existing'),
      cell: (row) => {
        if (actionOf(row) !== 'use') return '-';
        const entry = entryFor(valueMap, kind, row.value);
        const id = entry && 'id' in entry ? entry.id : undefined;
        return kind === 'person' ? (
          <PersonPicker
            aria-label={t('importValues.pickExisting', { value: row.value })}
            value={
              id
                ? ({
                    id,
                    display_name:
                      names[row.value] ??
                      (row.suggestion?.id === id
                        ? row.suggestion.name
                        : t('importValues.savedChoice')),
                  } as PersonRef)
                : null
            }
            onChange={(person) => {
              if (person) setNames((current) => ({ ...current, [row.value]: person.display_name }));
              onChoose(kind, row.value, person ? { id: person.id } : null);
            }}
          />
        ) : (
          <Select
            size="sm"
            variant="ghost"
            className="-ml-2 min-w-44"
            aria-label={t('importValues.pickExisting', { value: row.value })}
            placeholder={t('importValues.pickPlaceholder')}
            value={id}
            options={existing}
            onValueChange={(next) => onChoose(kind, row.value, { id: next })}
          />
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-text">
            {t('importValues.fieldHeading', { field: refName })}
          </h3>
          {column ? (
            <p className="text-sm text-muted">{t('importValues.column', { name: column })}</p>
          ) : null}
        </div>
        {creatable ? (
          <Field
            label={t('importValues.policyFor', { field: refName.toLowerCase() })}
            className="w-60"
          >
            {(control) => (
              <Select
                {...control}
                value={policy}
                onValueChange={(value) => onPolicy(kind, value as 'create' | 'must_exist')}
                options={(['create', 'must_exist'] as const).map((value) => ({
                  value,
                  label: t(`importValues.policyOptions.${value}`),
                }))}
              />
            )}
          </Field>
        ) : null}
      </div>
      {!creatable ? <p className="text-sm text-muted">{t('importValues.neverCreated')}</p> : null}
      {distinct > values.length || q !== '' ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={t('importValues.search', { field: refName.toLowerCase() })}
            className="w-72"
          >
            {(control) => (
              <Input
                {...control}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            )}
          </Field>
          {distinct > values.length && q === '' ? (
            <p className="pb-2 text-sm text-muted">
              {t('importValues.more', {
                shown: formatNumber(values.length),
                total: formatNumber(distinct),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      <DataTable
        label={t('importValues.tableLabel', { field: refName })}
        columns={columns}
        rows={shown}
        getRowId={(row) => row.value}
        getRowLabel={(row) => row.value}
        loading={q !== '' && found.isPending}
        empty={<p className="px-4 py-6 text-base text-muted">{t('importValues.noMatches')}</p>}
      />
    </div>
  );
}
