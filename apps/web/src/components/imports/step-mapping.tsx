'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import {
  importKeys,
  importsApi,
  importTemplatesApi,
  type ImportColumnProfile,
  type ImportDateFormat,
  type ImportJob,
  type ImportMapping,
  type ImportOptions,
  type ImportTemplate,
} from '@/lib/imports/api';
import { importErrorText, type ImportErrorText } from '@/lib/imports/error-text';
import {
  columnsOf,
  hasDateTarget,
  hasNumberTarget,
  mappedCount,
  mappedRefKinds,
  mappingProblems,
  needsDecision,
  needsDateFormat,
  targetOfColumn,
  targetOptionsFor,
  withDateFormat,
  withTarget,
  type MappingProblem,
} from '@/lib/imports/helpers';
import { useCustomFields, useLookups } from '@/lib/registry/queries';
import { routes } from '@/lib/routes';

const NONE = '__none__';
const JOB_FORMAT = '__job__';
const SAVED_NONE = '__none_saved__';
const PREVIEW_ROWS = 5;

type Defaults = NonNullable<ImportOptions['defaults']>;
type DefaultKey = keyof Defaults;

/** The options this step edits (the rest of the job's options, such as the reference policies, are left alone). */
interface EditableOptions {
  match_on: NonNullable<ImportOptions['match_on']>;
  on_match: NonNullable<ImportOptions['on_match']>;
  blank_cells: NonNullable<ImportOptions['blank_cells']>;
  date_format: NonNullable<ImportOptions['date_format']>;
  number_format: NonNullable<ImportOptions['number_format']>;
  default_currency: string;
  assign: boolean;
  detect_changes: boolean;
  location_kind: NonNullable<ImportOptions['location_kind']>;
  defaults: Defaults;
}

const editableOf = (options: ImportOptions): EditableOptions => ({
  match_on: options.match_on ?? 'auto',
  on_match: options.on_match ?? 'skip',
  blank_cells: options.blank_cells ?? 'ignore',
  date_format: options.date_format ?? 'auto',
  number_format: options.number_format ?? 'auto',
  default_currency: options.default_currency ?? '',
  assign: options.assign ?? true,
  detect_changes: options.detect_changes ?? true,
  location_kind: options.location_kind ?? 'other',
  defaults: { ...options.defaults },
});

/** The request body of the options: only what is valid (a currency is three capital letters). */
function optionsPatch(edit: EditableOptions, entity: ImportJob['entity_type']): ImportOptions {
  const currency = edit.default_currency.trim().toUpperCase();
  return {
    on_match: edit.on_match,
    ...(entity === 'asset'
      ? { match_on: edit.match_on, assign: edit.assign, number_format: edit.number_format }
      : {}),
    ...(entity === 'location' ? { location_kind: edit.location_kind } : {}),
    blank_cells: edit.blank_cells,
    detect_changes: edit.detect_changes,
    date_format: edit.date_format,
    ...(/^[A-Z]{3}$/.test(currency) ? { default_currency: currency } : {}),
    defaults: edit.defaults,
  };
}

/** The reference defaults offered per entity (the ids the API checks: category, status, location, department, vendor). */
const DEFAULT_FIELDS: Record<ImportJob['entity_type'], readonly DefaultKey[]> = {
  asset: ['category', 'status', 'location', 'department', 'vendor'],
  person: ['department', 'location'],
  location: [],
  department: [],
};

interface ColumnRow {
  index: number;
  header: string;
  profile: ImportColumnProfile | undefined;
}

/**
 * Step "Match columns" (WEB-14 step 2): the file as the analysis read it (the profile of every column:
 * what it looks like, how full it is, examples), the field every column goes to with the suggestion
 * filled in, the options for existing records, dates, numbers and defaults, and saved mappings to
 * reuse. The dry run needs the essentials the API checks (a category, something that tells rows
 * apart, a name). While the worker is still reading the file, a progress message stands in.
 */
export function StepMapping({
  job,
  etag,
  canRun,
}: {
  job: ImportJob;
  etag: string | undefined;
  canRun: boolean;
}) {
  const { t, formatNumber } = useI18n();
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();
  const lookups = useLookups();
  const customFields = useCustomFields();
  const presets = useQuery({
    queryKey: importKeys.presets(),
    queryFn: () => importsApi.presets(),
    staleTime: 5 * 60_000,
  });
  const saved = useQuery({
    queryKey: importKeys.templates(job.entity_type),
    queryFn: () => importTemplatesApi.list(job.entity_type),
    enabled: canRun,
  });

  const headers = useMemo(() => job.headers ?? [], [job.headers]);
  const [mapping, setMapping] = useState<ImportMapping>(() => ({
    ...job.mapping,
    columns: headers.map((_, index) => ({
      index,
      target: targetOfColumn(job.mapping, index),
      ...(columnsOf(job.mapping).find((c) => c.index === index)?.date_format
        ? { date_format: columnsOf(job.mapping).find((c) => c.index === index)!.date_format }
        : {}),
    })),
  }));
  const [edit, setEdit] = useState<EditableOptions>(() => editableOf(job.options));
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ImportErrorText | null>(null);
  const [mappingName, setMappingName] = useState('');
  const [nameError, setNameError] = useState('');
  const [chosenSaved, setChosenSaved] = useState('');
  const latestEtag = useRef(etag);

  const entity = job.entity_type;
  const used = useMemo(
    () => columnsOf(mapping).flatMap((c) => (c.target ? [c.target] : [])),
    [mapping],
  );
  const targets = useMemo(
    () =>
      targetOptionsFor(
        entity,
        presets.data ?? [],
        (customFields.data ?? []).map((field) => ({
          key: field.key,
          label: field.label,
          category: field.category_id
            ? (lookups.categoryById.get(field.category_id)?.name ?? null)
            : null,
        })),
        used,
      ),
    [entity, presets.data, customFields.data, lookups.categoryById, used],
  );
  const problems = useMemo(
    () => mappingProblems(entity, mapping, edit.defaults),
    [entity, mapping, edit.defaults],
  );
  const labelOf = (key: string) => targets.find((target) => target.key === key)?.label ?? key;
  const profileOf = (index: number) => job.profile?.find((p) => p.index === index);
  const hasContent = (job.profile ?? []).some((p) => p.samples.length > 0);
  const showDates = hasDateTarget(mapping, job.profile);

  const setTarget = (index: number, target: string | null) => {
    setMapping((current) => withTarget(current, headers.length, index, target));
    setChosen((current) => new Set(current).add(index));
  };

  const rows: ColumnRow[] = headers.map((header, index) => ({
    index,
    header,
    profile: profileOf(index),
  }));

  const targetSelectOptions = useMemo(
    () => [
      { value: NONE, label: t('importMapping.doNotImport') },
      ...targets.map((target) => ({
        value: target.key,
        label: target.required ? `${target.label} ${t('common.required')}` : target.label,
      })),
    ],
    [targets, t],
  );

  const columnDefs: DataTableColumn<ColumnRow>[] = [
    {
      id: 'column',
      header: t('importMapping.columns.yours'),
      sticky: true,
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-text">{row.header}</span>
          {row.profile ? (
            <span className="text-xs text-muted">
              {t('importMapping.detectedCounts', {
                filled: formatNumber(row.profile.non_blank),
                blank: formatNumber(row.profile.blank),
                distinct: `${formatNumber(row.profile.distinct)}${row.profile.distinct_capped ? '+' : ''}`,
              })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'field',
      header: t('importMapping.columns.field'),
      cell: (row) => (
        <Select
          size="sm"
          variant="ghost"
          className="-ml-2 min-w-48"
          aria-label={t('importMapping.chooseFor', { name: row.header })}
          value={targetOfColumn(mapping, row.index) || NONE}
          options={targetSelectOptions}
          onValueChange={(value) => setTarget(row.index, value === NONE ? null : value)}
        />
      ),
    },
    {
      id: 'match',
      header: t('importMapping.columns.match'),
      cell: (row) => {
        if (!targetOfColumn(mapping, row.index)) return null;
        const confidence = job.confidence?.[String(row.index)] ?? 0;
        if (chosen.has(row.index)) return <Badge>{t('importMapping.match.chosen')}</Badge>;
        return (
          <Badge tone={confidence >= 1 ? 'success' : 'info'}>
            {confidence >= 1 ? t('importMapping.match.exact') : t('importMapping.match.suggested')}
          </Badge>
        );
      },
    },
    {
      id: 'samples',
      header: t('importMapping.columns.samples'),
      cell: (row) =>
        row.profile && row.profile.samples.length > 0 ? (
          <span className="block max-w-72 truncate" title={row.profile.samples.join(', ')}>
            {row.profile.samples.slice(0, 3).join(', ')}
          </span>
        ) : (
          <span className="text-muted">
            {hasContent || !canRun ? t('importMapping.empty') : t('importMapping.noExamples')}
          </span>
        ),
    },
    {
      id: 'kind',
      header: t('importMapping.columns.kind'),
      cell: (row) => {
        const target = targetOfColumn(mapping, row.index);
        const askDate = !!target && (needsDateFormat(row.profile) || row.profile?.type === 'date');
        const column = columnsOf(mapping).find((c) => c.index === row.index);
        return (
          <span className="flex flex-wrap items-center gap-2">
            {row.profile ? <Badge>{t(`importMapping.detected.${row.profile.type}`)}</Badge> : null}
            {askDate ? (
              <Select
                size="sm"
                variant="ghost"
                aria-label={t('importMapping.dateFormatFor', { name: row.header })}
                value={column?.date_format ?? JOB_FORMAT}
                options={[
                  { value: JOB_FORMAT, label: t('importMapping.dateOptions.job') },
                  ...(['auto', 'iso', 'dmy', 'mdy'] as const).map((value) => ({
                    value,
                    label: t(`importMapping.dateOptions.${value}`),
                  })),
                ]}
                onValueChange={(value) =>
                  setMapping((current) =>
                    withDateFormat(
                      current,
                      row.index,
                      value === JOB_FORMAT ? null : (value as ImportDateFormat),
                    ),
                  )
                }
              />
            ) : null}
          </span>
        );
      },
    },
  ];

  /** Saves the mapping and the options; the response is the job as it stands (its ETag for the next write). */
  const persist = async () => {
    const updated = await importsApi.update(
      job.id,
      { mapping, options: optionsPatch(edit, entity) },
      latestEtag.current,
    );
    latestEtag.current = updated.etag;
    return updated.value;
  };

  const next = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await persist();
      // values that match no record, and that the dry run would reject, are decided in the next step
      const kinds = mappedRefKinds(entity, mapping);
      const lists = await Promise.all(kinds.map((kind) => importsApi.values(job.id, kind)));
      const open = lists.some((list, i) =>
        list.data.some((value) =>
          needsDecision(value, kinds[i]!, updated.options, updated.value_map ?? {}),
        ),
      );
      if (open) {
        await client.invalidateQueries({ queryKey: importKeys.job(job.id) });
        router.push(routes.importJob(job.id, 'values'));
        return;
      }
      await importsApi.startDryRun(job.id);
      await client.invalidateQueries({ queryKey: importKeys.job(job.id) });
      router.replace(routes.importJob(job.id));
    } catch (err) {
      setError(importErrorText(t, err, t('importMapping.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const saveTemplate = async () => {
    const name = mappingName.trim();
    if (!name) {
      setNameError(t('importMapping.saved.nameRequired'));
      return;
    }
    setNameError('');
    try {
      // a template copies the saved mapping of the import, so the current one is saved first
      await persist();
      await importTemplatesApi.createFromImport(name, job.id);
      setMappingName('');
      await Promise.all([
        saved.refetch(),
        client.invalidateQueries({ queryKey: importKeys.job(job.id) }),
      ]);
      toast({ variant: 'success', title: t('importMapping.saved.savedOk', { name }) });
    } catch (err) {
      const text = importErrorText(t, err, t('importMapping.saved.saveFailed'));
      setNameError(
        text.code === 'conflict'
          ? t('importMapping.saved.nameTaken')
          : (text.details[0] ?? text.message),
      );
    }
  };

  const applyTemplate = async (template: ImportTemplate) => {
    setError(null);
    try {
      await importsApi.applyTemplate(job.id, template.id);
      await client.invalidateQueries({ queryKey: importKeys.job(job.id) });
      toast({
        variant: 'success',
        title: t('importMapping.saved.applied', { name: template.name }),
      });
    } catch (err) {
      setError(importErrorText(t, err, t('importMapping.saved.applyFailed')));
    }
  };

  const removeTemplate = async () => {
    const template = saved.data?.find((candidate) => candidate.id === chosenSaved);
    if (!template) return;
    try {
      await importTemplatesApi.remove(template.id);
      setChosenSaved('');
      await saved.refetch();
      toast({
        variant: 'success',
        title: t('importMapping.saved.deleted', { name: template.name }),
      });
    } catch (err) {
      setError(importErrorText(t, err, t('importMapping.saved.deleteFailed')));
    }
  };

  // ---- the file is not read yet ---------------------------------------------------------------------------

  if (job.state === 'analyzing' || !job.headers) {
    return (
      <section aria-labelledby="import-mapping-heading" aria-busy className="flex flex-col gap-3">
        <h2 id="import-mapping-heading" className="text-lg font-semibold text-text">
          {t('importMapping.heading')}
        </h2>
        <p role="status" className="text-base text-muted">
          {t('importMapping.analysing')}
        </p>
        <p className="text-sm text-muted">{t('importMapping.scanWait')}</p>
        <progress className="h-2 w-full max-w-xl" aria-label={t('importMapping.analysingLabel')} />
        <Skeleton className="h-40 w-full" />
      </section>
    );
  }

  const problemLine = (problem: MappingProblem): string => {
    switch (problem.kind) {
      case 'category':
        return t('importMapping.problems.category');
      case 'identity':
        return t('importMapping.problems.identity');
      case 'duplicate':
        return t('importMapping.problems.duplicate', { field: labelOf(problem.field) });
      case 'name':
        return entity === 'person'
          ? t('importMapping.problems.personName')
          : entity === 'location'
            ? t('importMapping.problems.locationName')
            : t('importMapping.problems.departmentName');
    }
  };

  const constants = Object.entries(job.mapping.constants ?? {});
  const defaultFields = DEFAULT_FIELDS[entity];
  const updating = edit.on_match === 'update';
  const previewRows = (job.samples ?? [])
    .slice(0, PREVIEW_ROWS)
    .map((cells, position) => ({ position, cells }));
  const previewColumns: DataTableColumn<{ position: number; cells: string[] }>[] = headers.map(
    (header, index) => ({
      id: String(index),
      header,
      cell: (row) => row.cells[index] ?? '',
    }),
  );
  const defaultOptions = (key: DefaultKey) => {
    const none = { value: NONE, label: t('importMapping.defaults.none') };
    const list: Array<{ value: string; label: string }> =
      key === 'category'
        ? lookups.categories.map((c) => ({ value: c.id, label: c.name }))
        : key === 'status'
          ? lookups.statuses
              .filter((c) => !c.archived_at)
              .map((c) => ({ value: c.id, label: c.name }))
          : key === 'location'
            ? lookups.locations.map((c) => ({ value: c.id, label: lookups.locationLabel(c.id) }))
            : key === 'department'
              ? lookups.departments.map((c) => ({ value: c.id, label: c.name }))
              : lookups.vendors.map((c) => ({ value: c.id, label: c.name }));
    // the API merges defaults by key, so one that was saved can be changed but not removed
    return job.options.defaults?.[key] ? list : [none, ...list];
  };

  return (
    <section aria-labelledby="import-mapping-heading" className="flex flex-col gap-5">
      <div>
        <h2 id="import-mapping-heading" className="text-lg font-semibold text-text">
          {t('importMapping.heading')}
        </h2>
        <p className="text-base text-muted">{t('importMapping.description')}</p>
        <p className="mt-1 text-sm text-muted" data-testid="import-file-summary">
          {t('importMapping.file', {
            name: job.filename ?? '',
            count: formatNumber(job.rows_total),
          })}
        </p>
      </div>

      {job.state === 'analyzed' ? (
        <Banner tone="info">
          {mappedCount(job.mapping) > 0
            ? t('importMapping.autoNote', { count: mappedCount(job.mapping) })
            : t('importMapping.autoNoneNote')}
        </Banner>
      ) : null}
      {constants.length > 0 ? (
        <Banner tone="info" title={t('importMapping.constantsHeading')}>
          {t('importMapping.constantsNote', {
            pairs: constants.map(([field, value]) => `${labelOf(field)} = ${value}`).join(', '),
          })}
        </Banner>
      ) : null}

      <DataTable
        label={t('importMapping.tableLabel')}
        columns={columnDefs}
        rows={rows}
        getRowId={(row) => String(row.index)}
        getRowLabel={(row) => row.header}
        loading={presets.isPending}
      />

      {previewRows.length > 0 ? (
        <details className="rounded-lg border border-border bg-surface p-3">
          <summary className="cursor-pointer text-base font-semibold text-text">
            {t('importMapping.preview.heading')}
          </summary>
          <div className="mt-3">
            <DataTable
              label={t('importMapping.preview.label')}
              columns={previewColumns}
              rows={previewRows}
              getRowId={(row) => String(row.position)}
              density="compact"
            />
          </div>
        </details>
      ) : !hasContent ? (
        <p className="text-sm text-muted">{t('importMapping.preview.hidden')}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <legend className="px-1 text-base font-semibold text-text">
            {t('importMapping.options.heading')}
          </legend>
          {entity === 'asset' ? (
            <Field
              label={t('importMapping.options.matchOn')}
              hint={
                edit.match_on === 'auto' ? t('importMapping.options.matchOnAutoHint') : undefined
              }
            >
              {(control) => (
                <Select
                  {...control}
                  value={edit.match_on}
                  onValueChange={(value) =>
                    setEdit({ ...edit, match_on: value as EditableOptions['match_on'] })
                  }
                  options={(['auto', 'asset_tag', 'serial', 'external_id'] as const).map(
                    (value) => ({
                      value,
                      label: t(`importMapping.options.matchOptions.${value}`),
                    }),
                  )}
                />
              )}
            </Field>
          ) : null}
          <Field label={t('importMapping.options.onMatch')}>
            {(control) => (
              <Select
                {...control}
                value={edit.on_match}
                onValueChange={(value) =>
                  setEdit({ ...edit, on_match: value as EditableOptions['on_match'] })
                }
                options={(['skip', 'update', 'error'] as const).map((value) => ({
                  value,
                  label: t(`importMapping.options.onMatchOptions.${value}`),
                }))}
              />
            )}
          </Field>
          {updating ? (
            <Field label={t('importMapping.options.blankCells')}>
              {(control) => (
                <Select
                  {...control}
                  value={edit.blank_cells}
                  onValueChange={(value) =>
                    setEdit({ ...edit, blank_cells: value as EditableOptions['blank_cells'] })
                  }
                  options={(['ignore', 'clear'] as const).map((value) => ({
                    value,
                    label: t(`importMapping.options.blankOptions.${value}`),
                  }))}
                />
              )}
            </Field>
          ) : null}
          {updating ? (
            <Checkbox
              label={t('importMapping.options.detectChanges')}
              checked={edit.detect_changes}
              onCheckedChange={(value) => setEdit({ ...edit, detect_changes: value === true })}
            />
          ) : null}
          {showDates ? (
            <Field label={t('importMapping.options.dateFormat')}>
              {(control) => (
                <Select
                  {...control}
                  value={edit.date_format}
                  onValueChange={(value) =>
                    setEdit({ ...edit, date_format: value as EditableOptions['date_format'] })
                  }
                  options={(['auto', 'iso', 'dmy', 'mdy'] as const).map((value) => ({
                    value,
                    label: t(`importMapping.dateOptions.${value}`),
                  }))}
                />
              )}
            </Field>
          ) : null}
          {hasNumberTarget(mapping) ? (
            <>
              <Field label={t('importMapping.options.numberFormat')}>
                {(control) => (
                  <Select
                    {...control}
                    value={edit.number_format}
                    onValueChange={(value) =>
                      setEdit({ ...edit, number_format: value as EditableOptions['number_format'] })
                    }
                    options={(['auto', 'dot', 'comma'] as const).map((value) => ({
                      value,
                      label: t(`importMapping.options.numberOptions.${value}`),
                    }))}
                  />
                )}
              </Field>
              <Field
                label={t('importMapping.options.defaultCurrency')}
                hint={t('importMapping.options.defaultCurrencyHint')}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={edit.default_currency}
                    maxLength={3}
                    className="w-28 uppercase"
                    onChange={(event) =>
                      setEdit({ ...edit, default_currency: event.target.value.toUpperCase() })
                    }
                  />
                )}
              </Field>
            </>
          ) : null}
          {entity === 'asset' && used.includes('assigned_to') ? (
            <Checkbox
              label={t('importMapping.options.assign')}
              checked={edit.assign}
              onCheckedChange={(value) => setEdit({ ...edit, assign: value === true })}
            />
          ) : null}
          {entity === 'location' ? (
            <Field label={t('importMapping.options.locationKind')}>
              {(control) => (
                <Select
                  {...control}
                  value={edit.location_kind}
                  onValueChange={(value) =>
                    setEdit({ ...edit, location_kind: value as EditableOptions['location_kind'] })
                  }
                  options={(
                    ['site', 'building', 'floor', 'room', 'storage', 'vehicle', 'other'] as const
                  ).map((value) => ({
                    value,
                    label: t(`importMapping.options.kindOptions.${value}`),
                  }))}
                />
              )}
            </Field>
          ) : null}
        </fieldset>

        {defaultFields.length > 0 ? (
          <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <legend className="px-1 text-base font-semibold text-text">
              {t('importMapping.defaults.heading')}
            </legend>
            <p className="text-sm text-muted">{t('importMapping.defaults.note')}</p>
            {defaultFields.map((key) => (
              <Field key={key} label={t(`importMapping.defaults.${key}`)}>
                {(control) => (
                  <Select
                    {...control}
                    value={edit.defaults[key] ?? NONE}
                    onValueChange={(value) => {
                      const next = { ...edit.defaults };
                      if (value === NONE) delete next[key];
                      else next[key] = value;
                      setEdit({ ...edit, defaults: next });
                    }}
                    options={defaultOptions(key)}
                  />
                )}
              </Field>
            ))}
          </fieldset>
        ) : null}

        {canRun ? (
          <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <legend className="px-1 text-base font-semibold text-text">
              {t('importMapping.saved.heading')}
            </legend>
            {saved.data && saved.data.length > 0 ? (
              <div className="flex items-end gap-2">
                <Field label={t('importMapping.saved.apply')} className="flex-1">
                  {(control) => (
                    <Select
                      {...control}
                      value={chosenSaved || SAVED_NONE}
                      placeholder={t('importMapping.saved.placeholder')}
                      onValueChange={(value) => setChosenSaved(value === SAVED_NONE ? '' : value)}
                      options={[
                        { value: SAVED_NONE, label: t('importMapping.saved.placeholder') },
                        ...saved.data!.map((template) => ({
                          value: template.id,
                          label: template.name,
                        })),
                      ]}
                    />
                  )}
                </Field>
                <Button
                  disabled={!chosenSaved}
                  onClick={() => {
                    const template = saved.data?.find((candidate) => candidate.id === chosenSaved);
                    if (template) void applyTemplate(template);
                  }}
                >
                  {t('importMapping.saved.use')}
                </Button>
                <Button
                  aria-label={t('importMapping.saved.delete')}
                  disabled={!chosenSaved}
                  onClick={() => void removeTemplate()}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted">{t('importMapping.saved.none')}</p>
            )}
            <div className="flex items-end gap-2">
              <Field label={t('importMapping.saved.name')} error={nameError} className="flex-1">
                {(control) => (
                  <Input
                    {...control}
                    value={mappingName}
                    maxLength={100}
                    invalid={!!nameError}
                    onChange={(event) => setMappingName(event.target.value)}
                  />
                )}
              </Field>
              <Button onClick={() => void saveTemplate()}>{t('importMapping.saved.save')}</Button>
            </div>
          </fieldset>
        ) : null}
      </div>

      {problems.length > 0 ? (
        <Banner tone="warning" className="max-w-3xl">
          <ul className="list-disc pl-5">
            {problems.map((problem) => {
              const line = problemLine(problem);
              return <li key={line}>{line}</li>;
            })}
          </ul>
        </Banner>
      ) : null}
      {error ? (
        <FormError message={error.message} requestId={error.requestId} details={error.details} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link href={routes.importJob(job.id, 'file')}>{t('importMapping.uploadOther')}</Link>
        </Button>
        {canRun ? (
          <Button
            variant="primary"
            loading={saving}
            disabled={problems.length > 0 || presets.isPending}
            onClick={() => void next()}
          >
            {t('importMapping.next')}
            <ArrowRight aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>
    </section>
  );
}
