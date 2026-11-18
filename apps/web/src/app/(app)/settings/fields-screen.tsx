'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CustomFieldInput } from '@/components/registry/custom-field-input';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { SectionHeader } from '@/components/registry/section-header';
import { useEditor, useRunner } from '@/components/registry/use-runner';
import { FormError } from '@/components/auth/form-error';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button, IconButton } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { assetsApi, fieldsApi } from '@/lib/registry/api';
import { rulesOf, suggestKey, type RawValue } from '@/lib/registry/custom-fields';
import { useCategories, useCustomFields, useInvalidateLookups } from '@/lib/registry/queries';
import {
  CUSTOM_FIELD_TYPES,
  type CustomFieldDef,
  type CustomFieldType,
} from '@/lib/registry/types';
import { uiErrorText } from '@/lib/error-text';

interface Draft {
  label: string;
  key: string;
  keyTouched: boolean;
  data_type: CustomFieldType;
  category_id: string;
  required: boolean;
  show_in_list: boolean;
  help_text: string;
  min: string;
  max: string;
  max_length: string;
  options: Array<{ label: string; value: string }>;
}

const ALL = '__all__';

function draftOf(def?: CustomFieldDef, categoryId?: string): Draft {
  const rules = def ? rulesOf(def) : {};
  return {
    label: def?.label ?? '',
    key: def?.key ?? '',
    keyTouched: !!def,
    data_type: def?.data_type ?? 'text',
    category_id: def ? (def.category_id ?? ALL) : (categoryId ?? ALL),
    required: def?.required ?? false,
    show_in_list: def?.show_in_list ?? false,
    help_text: def?.help_text ?? '',
    min: rules.min?.toString() ?? '',
    max: rules.max?.toString() ?? '',
    max_length: rules.max_length?.toString() ?? '',
    options: (def?.options ?? []).map((o) => ({ value: o.value, label: o.label ?? o.value })),
  };
}

const isChoice = (type: CustomFieldType) => type === 'select' || type === 'multiselect';

/** Custom fields (WEB-10): the field builder with every type, options editor and live preview. */
export function FieldsScreen() {
  const t = useT();
  const { can } = useAuth();
  const manage = can('catalog:manage');
  const run = useRunner();
  const initialCategory = useSearchParams().get('category') ?? ALL;
  const [categoryFilter, setCategoryFilter] = useState(initialCategory);
  const categories = useCategories();
  const fields = useCustomFields();
  const editor = useEditor(fieldsApi.get);
  const [archiving, setArchiving] = useState<CustomFieldDef | null>(null);

  const rows = useMemo(() => {
    const all = [...(fields.data ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    if (categoryFilter === ALL) return all;
    return all.filter((f) => f.category_id == null || f.category_id === categoryFilter);
  }, [fields.data, categoryFilter]);

  const categoryName = (id?: string | null) =>
    id ? (categories.data?.find((c) => c.id === id)?.name ?? '') : t('fields.allCategories');

  const move = (row: CustomFieldDef, delta: -1 | 1) => {
    const index = rows.findIndex((r) => r.id === row.id);
    const other = rows[index + delta];
    if (!other) return;
    void run(async () => {
      await fieldsApi.update(row.id, { position: other.position ?? 0 });
      await fieldsApi.update(other.id, { position: row.position ?? 0 });
    }, t('fields.reordered'));
  };

  const columns = useMemo<DataTableColumn<CustomFieldDef>[]>(
    () => [
      { id: 'label', header: t('fields.columns.label'), cell: (r) => r.label },
      { id: 'key', header: t('fields.columns.key'), mono: true, cell: (r) => r.key },
      {
        id: 'type',
        header: t('fields.columns.type'),
        cell: (r) => t(`fields.types.${r.data_type}`),
      },
      {
        id: 'category',
        header: t('fields.columns.category'),
        cell: (r) => categoryName(r.category_id),
      },
      {
        id: 'required',
        header: t('fields.columns.required'),
        cell: (r) =>
          r.required ? <Badge tone="warning">{t('common.yes')}</Badge> : t('common.no'),
      },
      {
        id: 'list',
        header: t('fields.columns.showInList'),
        cell: (r) => (r.show_in_list ? t('common.yes') : t('common.no')),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        srOnlyHeader: true,
        align: 'end',
        cell: (r) => {
          if (!manage) return null;
          const index = rows.findIndex((x) => x.id === r.id);
          return (
            <span className="inline-flex gap-1">
              <Button
                size="icon-sm"
                aria-label={t('common.moveUpNamed', { name: r.label })}
                disabled={index === 0}
                onClick={() => move(r, -1)}
              >
                <ArrowUp aria-hidden className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                aria-label={t('common.moveDownNamed', { name: r.label })}
                disabled={index === rows.length - 1}
                onClick={() => move(r, 1)}
              >
                <ArrowDown aria-hidden className="size-4" />
              </Button>
              <Button
                size="sm"
                aria-label={t('common.editNamed', { name: r.label })}
                onClick={() => void editor.openEdit(r.id)}
              >
                {t('common.edit')}
              </Button>
              <Button
                size="sm"
                aria-label={t('common.archiveNamed', { name: r.label })}
                onClick={() => setArchiving(r)}
              >
                {t('common.archive')}
              </Button>
            </span>
          );
        },
      },
    ],
    // `move` and `categoryName` close over current rows and categories.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, manage, rows, categories.data, editor],
  );

  const editing = editor.target?.kind === 'edit' ? editor.target.versioned : undefined;

  return (
    <>
      <SectionHeader
        section="fields"
        title={t('settings.sections.fields')}
        description={t('fields.description')}
        actions={
          manage ? (
            <Button variant="primary" onClick={editor.openNew}>
              <Plus aria-hidden className="size-4" />
              {t('fields.new')}
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex max-w-sm flex-col gap-1.5">
        <label htmlFor="fields-category" className="text-sm font-medium">
          {t('fields.filterCategory')}
        </label>
        <Select
          id="fields-category"
          value={categoryFilter}
          onValueChange={setCategoryFilter}
          options={[
            { value: ALL, label: t('fields.allFields') },
            ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      </div>
      {fields.error ? (
        <Banner tone="danger">{t('common.loadFailed')}</Banner>
      ) : (
        <DataTable
          label={t('fields.tableLabel')}
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          loading={fields.isLoading}
          empty={
            <EmptyState
              icon={ListChecks}
              title={t('fields.emptyTitle')}
              description={t('fields.emptyDescription')}
            />
          }
        />
      )}

      <FieldBuilderDialog
        open={editor.target !== null}
        onClose={editor.close}
        existing={editing}
        defaultCategory={categoryFilter}
        categories={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        nextPosition={(fields.data ?? []).reduce((max, f) => Math.max(max, f.position ?? 0), 0) + 1}
      />

      <ArchiveFieldDialog field={archiving} onClose={() => setArchiving(null)} />
    </>
  );
}

function ArchiveFieldDialog({
  field,
  onClose,
}: {
  field: CustomFieldDef | null;
  onClose: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const invalidate = useInvalidateLookups();
  const usage = useQuery({
    queryKey: ['field-usage', field?.id],
    queryFn: () =>
      assetsApi.list({
        ...(field?.category_id ? { category_id: [field.category_id] } : {}),
        limit: 1,
        include_total: true,
      }),
    enabled: !!field,
  });
  const count = usage.data?.page.total ?? 0;
  return (
    <ConfirmDialog
      open={field !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('fields.archiveTitle', { name: field?.label ?? '' })}
      description={t('fields.archiveDescription')}
      confirmLabel={t('common.archive')}
      destructive
      onConfirm={async () => {
        if (!field) return;
        await fieldsApi.archive(field.id);
        await invalidate();
        toast({ variant: 'success', title: t('fields.archived') });
      }}
    >
      <p role="status" className="rounded-md bg-sunken p-3 text-base">
        {usage.isLoading ? t('common.loading') : t('fields.impact', { count })}
      </p>
    </ConfirmDialog>
  );
}

interface BuilderProps {
  open: boolean;
  onClose: () => void;
  existing?: { value: CustomFieldDef; etag: string | undefined };
  defaultCategory: string;
  categories: Array<{ value: string; label: string }>;
  nextPosition: number;
}

function FieldBuilderDialog({
  open,
  onClose,
  existing,
  defaultCategory,
  categories,
  nextPosition,
}: BuilderProps) {
  const t = useT();
  const invalidate = useInvalidateLookups();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftOf());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewValue, setPreviewValue] = useState<RawValue>('');
  const isNew = !existing;

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when (re)opened
      setDraft(draftOf(existing?.value, defaultCategory));
      setErrors({});
      setFormError(null);
      setPreviewValue('');
    }
    // Re-seed only when the dialog opens for a (different) record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.value.id]);

  const patch = (change: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...change }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(change)) delete next[k];
      return next;
    });
  };

  const setLabel = (label: string) =>
    patch({ label, ...(isNew && !draft.keyTouched ? { key: suggestKey(label) } : {}) });

  const preview = useMemo(
    () => ({
      key: draft.key || 'preview',
      label: draft.label || t('fields.preview.untitled'),
      data_type: draft.data_type,
      required: draft.required,
      help_text: draft.help_text || null,
      validation: {
        ...(draft.min ? { min: Number(draft.min) } : {}),
        ...(draft.max ? { max: Number(draft.max) } : {}),
      },
      options: draft.options.map((o) => ({ value: o.value || o.label, label: o.label })),
    }),
    [draft, t],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!draft.label.trim()) found.label = t('form.required');
    if (isNew && !draft.key.trim()) found.key = t('form.required');
    if (isChoice(draft.data_type) && draft.options.filter((o) => o.label.trim()).length === 0) {
      found.options = t('fields.optionsRequired');
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    const validation: Record<string, number> = {};
    if (draft.data_type === 'number') {
      if (draft.min) validation.min = Number(draft.min);
      if (draft.max) validation.max = Number(draft.max);
    }
    if ((draft.data_type === 'text' || draft.data_type === 'long_text') && draft.max_length) {
      validation.max_length = Number(draft.max_length);
    }
    const options = isChoice(draft.data_type)
      ? draft.options
          .filter((o) => o.label.trim())
          .map((o) => ({ label: o.label.trim(), value: o.value || suggestKey(o.label) }))
      : null;
    const common = {
      label: draft.label.trim(),
      required: draft.required,
      show_in_list: draft.show_in_list,
      help_text: draft.help_text.trim() || null,
      options,
      validation: Object.keys(validation).length > 0 ? validation : null,
    };
    setBusy(true);
    setFormError(null);
    try {
      if (existing) {
        await fieldsApi.update(
          existing.value.id,
          {
            ...common,
            ...(draft.data_type !== existing.value.data_type ? { data_type: draft.data_type } : {}),
          },
          existing.etag,
        );
      } else {
        await fieldsApi.create({
          ...common,
          key: draft.key.trim(),
          data_type: draft.data_type,
          category_id: draft.category_id === ALL ? null : draft.category_id,
          position: nextPosition,
        });
      }
      await invalidate();
      toast({ variant: 'success', title: t('fields.saved') });
      onClose();
    } catch (err) {
      const ui = getApi().toUiError(err);
      const byField: Record<string, string> = {};
      for (const fe of ui.fieldErrors) byField[fe.pointer.replace(/^\//, '')] = fe.message;
      setErrors(byField);
      setFormError(
        Object.keys(byField).length > 0 && ui.fieldErrors.length === Object.keys(byField).length
          ? null
          : ui,
      );
    } finally {
      setBusy(false);
    }
  };

  const updateOption = (index: number, label: string) =>
    patch({
      options: draft.options.map((o, i) =>
        i === index
          ? {
              label,
              value: o.value && o.value !== suggestKey(o.label) ? o.value : suggestKey(label),
            }
          : o,
      ),
    });

  const moveOption = (index: number, delta: -1 | 1) => {
    const next = [...draft.options];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    patch({ options: next });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{existing ? t('fields.editTitle') : t('fields.new')}</DialogTitle>
          <DialogDescription>{t('fields.builderDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
          {formError ? (
            <FormError message={uiErrorText(t, formError)} requestId={formError.requestId} />
          ) : null}
          <Field label={t('fields.form.label')} required error={errors.label}>
            {(c) => (
              <Input
                {...c}
                invalid={!!errors.label}
                value={draft.label}
                onChange={(e) => setLabel(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('fields.form.key')}
            required
            hint={isNew ? t('fields.form.keyHint') : t('fields.form.keyLocked')}
            error={errors.key}
          >
            {(c) => (
              <Input
                {...c}
                invalid={!!errors.key}
                className="font-tag"
                value={draft.key}
                disabled={!isNew}
                onChange={(e) => patch({ key: e.target.value, keyTouched: true })}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('fields.form.type')}
              required
              hint={existing ? t('fields.form.typeHint') : undefined}
              error={errors.data_type}
            >
              {(c) => (
                <Select
                  {...c}
                  invalid={!!errors.data_type}
                  value={draft.data_type}
                  onValueChange={(v) => patch({ data_type: v as CustomFieldType })}
                  options={CUSTOM_FIELD_TYPES.map((type) => ({
                    value: type,
                    label: t(`fields.types.${type}`),
                  }))}
                />
              )}
            </Field>
            <Field label={t('fields.form.appliesTo')} error={errors.category_id}>
              {(c) => (
                <Select
                  {...c}
                  disabled={!isNew}
                  value={draft.category_id}
                  onValueChange={(v) => patch({ category_id: v })}
                  options={[{ value: ALL, label: t('fields.allCategories') }, ...categories]}
                />
              )}
            </Field>
          </div>

          {draft.data_type === 'number' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('fields.form.min')}>
                {(c) => (
                  <Input
                    {...c}
                    type="number"
                    step="any"
                    value={draft.min}
                    onChange={(e) => patch({ min: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('fields.form.max')}>
                {(c) => (
                  <Input
                    {...c}
                    type="number"
                    step="any"
                    value={draft.max}
                    onChange={(e) => patch({ max: e.target.value })}
                  />
                )}
              </Field>
            </div>
          ) : null}
          {draft.data_type === 'text' || draft.data_type === 'long_text' ? (
            <Field label={t('fields.form.maxLength')}>
              {(c) => (
                <Input
                  {...c}
                  type="number"
                  min={1}
                  value={draft.max_length}
                  onChange={(e) => patch({ max_length: e.target.value })}
                />
              )}
            </Field>
          ) : null}

          {isChoice(draft.data_type) ? (
            <fieldset
              className="flex flex-col gap-2"
              aria-describedby={errors.options ? 'options-error' : undefined}
            >
              <legend className="mb-1 text-base font-medium">{t('fields.form.options')}</legend>
              {draft.options.map((option, index) => (
                <div key={index} className="flex items-center gap-1">
                  <Input
                    aria-label={t('fields.form.optionNumber', { number: index + 1 })}
                    value={option.label}
                    onChange={(e) => updateOption(index, e.target.value)}
                  />
                  <IconButton
                    icon={ArrowUp}
                    label={t('fields.form.optionUp', { number: index + 1 })}
                    size="icon-sm"
                    disabled={index === 0}
                    onClick={() => moveOption(index, -1)}
                  />
                  <IconButton
                    icon={ArrowDown}
                    label={t('fields.form.optionDown', { number: index + 1 })}
                    size="icon-sm"
                    disabled={index === draft.options.length - 1}
                    onClick={() => moveOption(index, 1)}
                  />
                  <IconButton
                    icon={Trash2}
                    label={t('fields.form.optionRemove', { number: index + 1 })}
                    size="icon-sm"
                    onClick={() => patch({ options: draft.options.filter((_, i) => i !== index) })}
                  />
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  onClick={() => patch({ options: [...draft.options, { label: '', value: '' }] })}
                >
                  <Plus aria-hidden className="size-4" />
                  {t('fields.form.addOption')}
                </Button>
              </div>
              {errors.options ? (
                <p id="options-error" role="alert" className="text-sm text-danger-text">
                  {errors.options}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          <Field label={t('fields.form.helpText')}>
            {(c) => (
              <Textarea
                {...c}
                rows={2}
                value={draft.help_text}
                onChange={(e) => patch({ help_text: e.target.value })}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox
              label={t('fields.form.required')}
              checked={draft.required}
              onCheckedChange={(v) => patch({ required: v === true })}
            />
            <Checkbox
              label={t('fields.form.showInList')}
              checked={draft.show_in_list}
              onCheckedChange={(v) => patch({ show_in_list: v === true })}
            />
          </div>

          <section
            aria-labelledby="field-preview-heading"
            className="rounded-lg border border-border bg-sunken p-3"
          >
            <h3 id="field-preview-heading" className="mb-2 text-sm font-semibold text-muted">
              {t('fields.preview.title')}
            </h3>
            <CustomFieldInput def={preview} value={previewValue} onChange={setPreviewValue} />
          </section>

          <DialogFooter>
            <Button type="button" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              {existing ? t('common.save') : t('fields.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
