'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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
import { getApi, type UiError } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import {
  importsApi,
  type ImportColumn,
  type ImportJob,
  type ImportTargetField,
} from '@/lib/imports/api';
import {
  applicableMapping,
  mappedReferences,
  mappingProblems,
  suggestedMapping,
  unmatchedValues,
} from '@/lib/imports/helpers';
import { routes } from '@/lib/routes';

const NONE = '__none__';
const SAVED_NONE = '__none_saved__';
const POLL_MS = 1500;

/**
 * Step "Match columns" (WEB-14 step 2): what the file contains (headers, examples, what each column
 * looks like), the field every column goes to with the heuristics' suggestion filled in, the
 * options for duplicates and missing records, and saved mappings to reuse. A dry run needs the
 * required fields and the column the duplicate check uses.
 */
export function StepMapping({ job }: { job: ImportJob }) {
  const { t, formatNumber } = useI18n();
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();

  const analysis = useQuery({
    queryKey: ['import', job.id, 'analysis'],
    queryFn: () => importsApi.analysis(job.id),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? POLL_MS : false),
    retry: false,
  });
  const fields = useQuery({
    queryKey: ['import-fields', job.entity_type],
    queryFn: () => importsApi.targetFields(job.entity_type),
    staleTime: 60_000,
  });
  const saved = useQuery({
    queryKey: ['import-mappings', job.entity_type],
    queryFn: () => importsApi.mappingTemplates(job.entity_type),
  });

  const [mapping, setMapping] = useState<Record<string, string>>(job.mapping ?? {});
  const [initialised, setInitialised] = useState(Object.keys(job.mapping ?? {}).length > 0);
  const [suggestedCount, setSuggestedCount] = useState<number | null>(null);
  const [options, setOptions] = useState(() => ({
    match_on: String(job.options?.match_on ?? 'asset_tag'),
    on_duplicate: String(job.options?.on_duplicate ?? 'skip'),
    create_missing_references: job.options?.create_missing_references !== false,
    date_format: String(job.options?.date_format ?? 'YYYY-MM-DD'),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [mappingName, setMappingName] = useState('');
  const [nameError, setNameError] = useState('');
  const [chosenSaved, setChosenSaved] = useState('');

  const ready = analysis.data?.status === 'ready' ? analysis.data : null;
  const columns = ready?.columns ?? [];

  // The first time the analysis is there, start from the heuristics' suggestions.
  useEffect(() => {
    if (!ready || initialised) return;
    const suggestion = suggestedMapping(ready);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time start from the suggestions
    setMapping(suggestion);
    setSuggestedCount(Object.keys(suggestion).length);
    setInitialised(true);
  }, [ready, initialised]);

  const fieldList = useMemo(() => fields.data ?? [], [fields.data]);
  const problems = useMemo(
    () => mappingProblems(mapping, fieldList, job.entity_type, options.match_on),
    [mapping, fieldList, job.entity_type, options.match_on],
  );
  const labelOf = (key: string) => fieldList.find((f) => f.key === key)?.label ?? key;
  const isAsset = job.entity_type === 'asset';
  const hasDates = fieldList.some(
    (f) => f.type === 'date' && Object.values(mapping).includes(f.key),
  );

  const targetOptions = useMemo(
    () => [
      { value: NONE, label: t('importMapping.doNotImport') },
      ...fieldList.map((f: ImportTargetField) => ({
        value: f.key,
        label: f.required ? `${f.label} ${t('common.required')}` : f.label,
      })),
    ],
    [fieldList, t],
  );

  const columnDefs: DataTableColumn<ImportColumn>[] = [
    {
      id: 'column',
      header: t('importMapping.columns.yours'),
      sticky: true,
      cell: (column) => <span className="font-medium text-text">{column.name}</span>,
    },
    {
      id: 'field',
      header: t('importMapping.columns.field'),
      cell: (column) => (
        <Select
          size="sm"
          variant="ghost"
          className="-ml-2 min-w-48"
          aria-label={t('importMapping.chooseFor', { name: column.name })}
          value={mapping[column.name] || NONE}
          options={targetOptions}
          onValueChange={(value) =>
            setMapping((current) => {
              const next = { ...current };
              if (value === NONE) delete next[column.name];
              else next[column.name] = value;
              return next;
            })
          }
        />
      ),
    },
    {
      id: 'samples',
      header: t('importMapping.columns.samples'),
      cell: (column) =>
        column.sample_values.length > 0 ? (
          <span className="block max-w-72 truncate" title={column.sample_values.join(', ')}>
            {column.sample_values.slice(0, 3).join(', ')}
          </span>
        ) : (
          <span className="text-muted">{t('importMapping.empty')}</span>
        ),
    },
    {
      id: 'kind',
      header: t('importMapping.columns.kind'),
      cell: (column) => <Badge>{t(`importMapping.detected.${column.detected_type}`)}</Badge>,
    },
  ];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const clean = ready ? applicableMapping(mapping, ready) : mapping;
      await importsApi.update(job.id, {
        mapping: clean,
        options: {
          ...(isAsset ? { match_on: options.match_on, on_duplicate: options.on_duplicate } : {}),
          create_missing_references: options.create_missing_references,
          ...(hasDates ? { date_format: options.date_format } : {}),
        },
      });
      const lookups = mappedReferences(clean, fieldList).length
        ? await importsApi.lookups(job.id)
        : [];
      if (unmatchedValues(lookups).length > 0) {
        await client.invalidateQueries({ queryKey: ['import', job.id] });
        router.push(routes.importJob(job.id, 'values'));
        return;
      }
      await importsApi.startDryRun(job.id);
      await client.invalidateQueries({ queryKey: ['import', job.id] });
      router.replace(routes.importJob(job.id));
    } catch (err) {
      setError(getApi().toUiError(err));
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
      await importsApi.saveMappingTemplate({
        name,
        entity_type: job.entity_type,
        source: job.source,
        mapping,
        options: { match_on: options.match_on, on_duplicate: options.on_duplicate },
      });
      setMappingName('');
      await saved.refetch();
      toast({ variant: 'success', title: t('importMapping.saved.savedOk', { name }) });
    } catch (err) {
      const ui = getApi().toUiError(err);
      setNameError(ui.fieldErrors[0]?.message ?? ui.detail ?? t('importMapping.saved.saveFailed'));
    }
  };

  const applyTemplate = (id: string) => {
    setChosenSaved(id);
    const template = saved.data?.find((candidate) => candidate.id === id);
    if (!template || !ready) return;
    setMapping(applicableMapping(template.mapping, ready));
    const opts = (template.options ?? {}) as Record<string, unknown>;
    setOptions((current) => ({
      ...current,
      match_on: typeof opts.match_on === 'string' ? opts.match_on : current.match_on,
      on_duplicate:
        typeof opts.on_duplicate === 'string' ? opts.on_duplicate : current.on_duplicate,
    }));
    toast({ variant: 'success', title: t('importMapping.saved.applied', { name: template.name }) });
  };

  const removeTemplate = async () => {
    const template = saved.data?.find((candidate) => candidate.id === chosenSaved);
    if (!template) return;
    await importsApi.deleteMappingTemplate(template.id);
    setChosenSaved('');
    await saved.refetch();
    toast({ variant: 'success', title: t('importMapping.saved.deleted', { name: template.name }) });
  };

  // ---- the file is not readable yet -------------------------------------------------------------

  if (analysis.isError) {
    return (
      <Banner
        tone="danger"
        action={<Button onClick={() => void analysis.refetch()}>{t('importMapping.retry')}</Button>}
      >
        {t('imports.loadJobFailed')}
      </Banner>
    );
  }
  if (analysis.isPending || analysis.data?.status === 'pending') {
    return (
      <section aria-labelledby="import-mapping-heading" aria-busy className="flex flex-col gap-3">
        <h2 id="import-mapping-heading" className="text-lg font-semibold text-text">
          {t('importMapping.heading')}
        </h2>
        <p role="status" className="text-base text-muted">
          {analysis.isPending ? t('importMapping.analysing') : t('importMapping.scanWait')}
        </p>
        <Skeleton className="h-40 w-full" />
      </section>
    );
  }
  if (analysis.data?.status === 'failed') {
    return (
      <section aria-labelledby="import-mapping-heading" className="flex max-w-2xl flex-col gap-3">
        <h2 id="import-mapping-heading" className="text-lg font-semibold text-text">
          {t('importMapping.heading')}
        </h2>
        <Banner tone="danger" title={t('importMapping.analysisFailed')}>
          {analysis.data.error}
        </Banner>
        <div>
          <Button asChild variant="primary">
            <Link href={routes.importJob(job.id, 'file')}>{t('importMapping.uploadOther')}</Link>
          </Button>
        </div>
      </section>
    );
  }

  const problemLines: string[] = [];
  if (problems.missingRequired.length > 0) {
    problemLines.push(
      t('importMapping.problems.required', {
        fields: problems.missingRequired.map((f) => f.label).join(', '),
      }),
    );
  }
  for (const duplicate of problems.duplicates) {
    problemLines.push(t('importMapping.problems.duplicate', { field: labelOf(duplicate) }));
  }
  if (problems.missingKey) {
    problemLines.push(
      t('importMapping.problems.missingKey', { field: labelOf(problems.missingKey) }),
    );
  }

  return (
    <section aria-labelledby="import-mapping-heading" className="flex flex-col gap-5">
      <div>
        <h2 id="import-mapping-heading" className="text-lg font-semibold text-text">
          {t('importMapping.heading')}
        </h2>
        <p className="text-base text-muted">{t('importMapping.description')}</p>
        <p className="mt-1 text-sm text-muted" data-testid="import-file-summary">
          {ready?.rows_total != null
            ? t('importMapping.file', {
                name: job.original_filename ?? '',
                count: formatNumber(ready.rows_total),
              })
            : t('importMapping.fileNoCount', { name: job.original_filename ?? '' })}
        </p>
      </div>

      {suggestedCount !== null ? (
        <Banner tone="info">
          {suggestedCount > 0
            ? t('importMapping.autoNote', { count: suggestedCount })
            : t('importMapping.autoNoneNote')}
        </Banner>
      ) : null}

      <DataTable
        label={t('importMapping.tableLabel')}
        columns={columnDefs}
        rows={columns}
        getRowId={(column) => String(column.index)}
        getRowLabel={(column) => column.name}
        loading={fields.isPending}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <legend className="px-1 text-base font-semibold text-text">
            {t('importMapping.options.heading')}
          </legend>
          {isAsset ? (
            <>
              <Field label={t('importMapping.options.matchOn')}>
                {(control) => (
                  <Select
                    {...control}
                    value={options.match_on}
                    onValueChange={(value) => setOptions({ ...options, match_on: value })}
                    options={(['asset_tag', 'serial'] as const).map((value) => ({
                      value,
                      label: t(`importMapping.options.matchOptions.${value}`),
                    }))}
                  />
                )}
              </Field>
              <Field label={t('importMapping.options.onDuplicate')}>
                {(control) => (
                  <Select
                    {...control}
                    value={options.on_duplicate}
                    onValueChange={(value) => setOptions({ ...options, on_duplicate: value })}
                    options={(['skip', 'update', 'error'] as const).map((value) => ({
                      value,
                      label: t(`importMapping.options.duplicateOptions.${value}`),
                    }))}
                  />
                )}
              </Field>
            </>
          ) : null}
          <Checkbox
            label={t('importMapping.options.createMissing')}
            checked={options.create_missing_references}
            onCheckedChange={(value) =>
              setOptions({ ...options, create_missing_references: value === true })
            }
          />
          {hasDates ? (
            <Field label={t('importMapping.options.dateFormat')}>
              {(control) => (
                <Select
                  {...control}
                  value={options.date_format}
                  onValueChange={(value) => setOptions({ ...options, date_format: value })}
                  options={(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const).map((value) => ({
                    value,
                    label: t(`importMapping.options.dateOptions.${value}`),
                  }))}
                />
              )}
            </Field>
          ) : null}
        </fieldset>

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
                    onValueChange={(value) =>
                      value === SAVED_NONE ? setChosenSaved('') : applyTemplate(value)
                    }
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
                  maxLength={120}
                  invalid={!!nameError}
                  onChange={(event) => setMappingName(event.target.value)}
                />
              )}
            </Field>
            <Button onClick={() => void saveTemplate()}>{t('importMapping.saved.save')}</Button>
          </div>
        </fieldset>
      </div>

      {problemLines.length > 0 ? (
        <Banner tone="warning" className="max-w-3xl">
          <ul className="list-disc pl-5">
            {problemLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {error ? (
        <FormError
          message={`${t('importMapping.saveFailed')} ${uiErrorText(t, error)}`}
          requestId={error.requestId}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link href={routes.importJob(job.id, 'file')}>{t('importMapping.uploadOther')}</Link>
        </Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={!problems.ok || fields.isPending}
          onClick={() => void save()}
        >
          {t('importMapping.next')}
          <ArrowRight aria-hidden className="size-4" />
        </Button>
      </div>
    </section>
  );
}
