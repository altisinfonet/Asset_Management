'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Download } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { ImportStepper } from '@/components/imports/import-stepper';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { uiErrorText } from '@/lib/error-text';
import {
  downloadTemplate,
  importKeys,
  importsApi,
  type ImportPresetColumn,
  type TemplateFormat,
} from '@/lib/imports/api';
import { IMPORT_KINDS, isImportKind, isResumable, type ImportKind } from '@/lib/imports/helpers';
import { routes } from '@/lib/routes';

/**
 * Step 1 of the import wizard (WEB-14): which kind of data, with the template for it (CSV or Excel)
 * and what its columns mean (the data dictionary of the preset). Choosing creates a draft import from
 * the preset (nothing is saved to the register), which the next step uploads the file to. A draft or
 * a running import from before is offered so nothing is started twice.
 */
export function NewImportScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get('entity');
  const [kind, setKind] = useState<ImportKind>(isImportKind(requested) ? requested : 'asset');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [templateFailed, setTemplateFailed] = useState(false);

  const recent = useQuery({
    queryKey: [...importKeys.list(), 'resume'],
    queryFn: () => importsApi.list({ limit: 5 }),
    select: (page) => page.data.find((job) => isResumable(job.state)) ?? null,
  });
  const presets = useQuery({
    queryKey: importKeys.presets(),
    queryFn: () => importsApi.presets(),
    staleTime: 5 * 60_000,
  });

  const chosen = IMPORT_KINDS.find((candidate) => candidate.id === kind)!;
  const preset = presets.data?.find((candidate) => candidate.key === chosen.preset);
  const kindName = t(`imports.kinds.${kind}.title`);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const job = await importsApi.create({
        entity_type: chosen.entity,
        preset_key: chosen.preset,
      });
      router.push(routes.importJob(job.value.id));
    } catch (err) {
      setError(getApi().toUiError(err));
      setCreating(false);
    }
  };

  const download = (format: TemplateFormat) => {
    setTemplateFailed(false);
    void downloadTemplate(chosen.preset, format).catch(() => setTemplateFailed(true));
  };

  const dictionary: DataTableColumn<ImportPresetColumn>[] = [
    {
      id: 'column',
      header: t('importNew.dictionaryColumns.column'),
      sticky: true,
      cell: (row) => <span className="font-medium text-text">{row.column}</span>,
    },
    {
      id: 'target',
      header: t('importNew.dictionaryColumns.field'),
      mono: true,
      cell: (row) => row.target,
    },
    {
      id: 'description',
      header: t('importNew.dictionaryColumns.description'),
      cell: (row) => <span className="block max-w-md whitespace-normal">{row.description}</span>,
    },
    {
      id: 'required',
      header: t('importNew.dictionaryColumns.required'),
      cell: (row) =>
        row.required === 'yes'
          ? t('importNew.requiredYes')
          : row.required.startsWith('yes')
            ? row.required
            : t('importNew.requiredNo'),
    },
    {
      id: 'example',
      header: t('importNew.dictionaryColumns.example'),
      mono: true,
      cell: (row) => row.example || '-',
    },
  ];

  return (
    <>
      <PageTitle title={t('imports.title')} />
      <PageHeader title={t('importNew.heading')} description={t('importNew.description')} />
      <ImportStepper step="type" />

      {recent.data ? (
        <Banner
          tone="info"
          className="mb-4 max-w-3xl"
          action={
            <Button asChild>
              <Link href={routes.importJob(recent.data.id)}>{t('importNew.resumeLink')}</Link>
            </Button>
          }
        >
          {t('importNew.resume', {
            name: recent.data.filename ?? t('importNew.resumeUntitled'),
          })}
        </Banner>
      ) : null}

      <div className="flex max-w-3xl flex-col gap-5">
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">{t('importNew.groupLabel')}</legend>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {IMPORT_KINDS.map((option) => (
              <li key={option.id}>
                <label
                  className={cn(
                    'flex h-full min-h-20 cursor-pointer items-start gap-3 rounded-lg border border-border-strong bg-surface p-4 hover:bg-sunken',
                    'has-[:checked]:border-primary has-[:checked]:bg-primary-subtle',
                    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                  )}
                >
                  <input
                    type="radio"
                    name="import-kind"
                    value={option.id}
                    checked={kind === option.id}
                    onChange={() => setKind(option.id)}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span className="flex flex-col">
                    <span className="text-base font-semibold text-text">
                      {t(`imports.kinds.${option.id}.title`)}
                    </span>
                    <span className="text-sm text-muted">
                      {t(`imports.kinds.${option.id}.description`)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <p className="text-sm text-muted">{t('importNew.order')}</p>

        {preset?.sets_up ? (
          <Banner tone="info">
            {t('importNew.setsUp', {
              category: preset.sets_up.category,
              fields: preset.sets_up.custom_fields.join(', '),
            })}
          </Banner>
        ) : null}
        {preset && preset.notes.length > 0 ? (
          <section aria-labelledby="import-notes-heading" className="flex flex-col gap-1">
            <h2 id="import-notes-heading" className="text-base font-semibold text-text">
              {t('importNew.notesHeading')}
            </h2>
            <ul className="list-disc pl-5 text-sm text-muted">
              {preset.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {presets.isError ? (
          <p role="alert" className="text-sm text-danger-text">
            {t('importNew.presetsFailed')}
          </p>
        ) : null}

        {preset ? (
          <details className="rounded-lg border border-border bg-surface p-3">
            <summary className="cursor-pointer text-base font-semibold text-text">
              {t('importNew.dictionaryHeading')}
            </summary>
            <div className="mt-3">
              <DataTable
                label={t('importNew.dictionaryTable', { kind: kindName })}
                columns={dictionary}
                rows={preset.columns}
                getRowId={(row) => row.target}
                getRowLabel={(row) => row.column}
                density="compact"
              />
            </div>
          </details>
        ) : null}

        {templateFailed ? (
          <p role="alert" className="text-sm text-danger-text">
            {t('importNew.templateFailed')}
          </p>
        ) : null}
        {error ? (
          <FormError
            message={`${t('importNew.createFailed')} ${uiErrorText(t, error)}`}
            requestId={error.requestId}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => download('csv')}>
            <Download aria-hidden className="size-4" />
            {t('importNew.templateCsv', { kind: kindName })}
          </Button>
          <Button onClick={() => download('xlsx')}>
            <Download aria-hidden className="size-4" />
            {t('importNew.templateXlsx', { kind: kindName })}
          </Button>
          <Button variant="primary" loading={creating} onClick={() => void create()}>
            {t('importNew.continue')}
            <ArrowRight aria-hidden className="size-4" />
          </Button>
        </div>
        <p className="text-sm text-muted">{t('imports.dryRunNote')}</p>
      </div>
    </>
  );
}
