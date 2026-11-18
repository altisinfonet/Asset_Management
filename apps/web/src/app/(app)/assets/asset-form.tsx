'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CustomFieldInput } from '@/components/registry/custom-field-input';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { assetsApi } from '@/lib/registry/api';
import {
  discardedCustom,
  emptyAssetForm,
  formFromAsset,
  mergeEdits,
  pointerToKey,
  toCreateBody,
  toUpdateBody,
  validateAssetForm,
  type AssetFormState,
  type FormProblem,
} from '@/lib/registry/asset-form';
import { describeProblem, emptyRaw, type RawValue } from '@/lib/registry/custom-fields';
import type { Lookups } from '@/lib/registry/queries';
import type { Asset, Versioned } from '@/lib/registry/types';
import { routes } from '@/lib/routes';

const NONE = '__none__';

export type AssetFormMode = 'create' | 'edit' | 'clone';

export interface AssetFormProps {
  mode: AssetFormMode;
  lookups: Lookups;
  /** The asset being edited, or the source of a clone. */
  source?: Versioned<Asset>;
}

/**
 * Create / edit / clone form (WEB-06). Basics, purchase, then the custom fields of the chosen
 * category, rendered from their definitions. Errors show inline and in a summary, `412` offers a
 * merge, "Save and add another" keeps the fields that repeat in bulk entry, Ctrl+Enter saves.
 */
export function AssetForm({ mode, lookups, source }: AssetFormProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const router = useRouter();
  const { me } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const serialRef = useRef<HTMLInputElement>(null);
  const currency = me?.tenant.base_currency ?? 'USD';

  const defaultStatus = lookups.statuses.find((s) => s.is_default && !s.archived_at)?.id ?? '';
  const initial = () => {
    if (!source) return emptyAssetForm(defaultStatus);
    return formFromAsset(source.value, lookups.fields, { clone: mode === 'clone' });
  };
  const [state, setState] = useState<AssetFormState>(initial);
  /** What the form looked like when it was loaded (or last reloaded): the base of the 412 merge. */
  const [base, setBase] = useState<{ asset?: Versioned<Asset>; form: AssetFormState }>(() => ({
    asset: source,
    form: initial(),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'save' | 'another' | null>(null);
  const [stale, setStale] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<{ id: string; dropped: string[] } | null>(
    null,
  );
  const [duplicates, setDuplicates] = useState<Record<string, Asset | undefined>>({});

  // Reveal the status default once the lookups have loaded (create only).
  useEffect(() => {
    if (mode === 'create' && !state.status_id && defaultStatus) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt the default once known
      setState((s) => ({ ...s, status_id: defaultStatus }));
    }
  }, [mode, defaultStatus, state.status_id]);

  const fields = lookups.fieldsFor(state.category_id);
  const models = lookups.models.filter(
    (m) => !m.archived_at && (!state.category_id || m.category_id === state.category_id),
  );

  const set = <K extends keyof AssetFormState>(key: K, value: AssetFormState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  };
  const setCustom = (key: string, value: RawValue) => {
    setState((s) => ({ ...s, custom: { ...s.custom, [key]: value } }));
    setErrors((e) => (e[`cf:${key}`] ? { ...e, [`cf:${key}`]: '' } : e));
  };

  const applyCategory = (categoryId: string) => {
    setState((s) => {
      const nextFields = lookups.fieldsFor(categoryId);
      const custom: Record<string, RawValue> = {};
      for (const def of nextFields) custom[def.key] = s.custom[def.key] ?? emptyRaw(def);
      const modelStillFits = lookups.modelById.get(s.model_id)?.category_id === categoryId;
      return { ...s, category_id: categoryId, model_id: modelStillFits ? s.model_id : '', custom };
    });
    setErrors({});
    setPendingCategory(null);
  };

  const changeCategory = (categoryId: string) => {
    const dropped = discardedCustom(
      state,
      lookups.fieldsFor(categoryId),
      lookups.fieldsFor(state.category_id),
    );
    if (dropped.length > 0)
      setPendingCategory({ id: categoryId, dropped: dropped.map((d) => d.label) });
    else applyCategory(categoryId);
  };

  const chooseModel = (modelId: string) => {
    set('model_id', modelId);
  };

  /** Warn (not block) when a typed tag or serial already belongs to another asset. */
  const checkDuplicate = async (kind: 'tag' | 'serial', value: string) => {
    const v = value.trim();
    if (!v || (kind === 'tag' && state.tagMode === 'auto')) {
      setDuplicates((d) => ({ ...d, [kind]: undefined }));
      return;
    }
    try {
      const page = await assetsApi.list({ [kind]: v, archived: 'include', limit: 1 });
      const found = page.data.find((a) => a.id !== source?.value.id || mode === 'clone');
      setDuplicates((d) => ({ ...d, [kind]: found }));
    } catch {
      setDuplicates((d) => ({ ...d, [kind]: undefined }));
    }
  };

  const messageFor = (problem: FormProblem['problem']): string =>
    problem === 'required'
      ? t('form.required')
      : problem === 'cost'
        ? t('assetForm.errors.cost')
        : problem === 'date'
          ? t('customFields.validation.date')
          : describeProblem(problem, t);

  const labelOf = (key: string): string =>
    key.startsWith('cf:')
      ? (lookups.fields.find((f) => f.key === key.slice(3))?.label ?? key)
      : t(`assetForm.fieldNames.${key as 'category_id'}`);

  const focusFirstInvalid = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    );

  const reportErrors = (map: Record<string, string>) => {
    setErrors(map);
    setSummary(
      Object.entries(map)
        .filter(([, m]) => m)
        .map(([key, m]) => `${labelOf(key)}: ${m}`),
    );
    focusFirstInvalid();
  };

  const save = async (another: boolean) => {
    setFormError(null);
    setStale(false);
    const problems = validateAssetForm(state, fields);
    if (problems.length > 0) {
      reportErrors(Object.fromEntries(problems.map((p) => [p.key, messageFor(p.problem)])));
      return;
    }
    setErrors({});
    setSummary([]);
    setSaving(another ? 'another' : 'save');
    try {
      if (mode === 'edit' && base.asset) {
        const body = toUpdateBody(state, fields, base.asset.value, { currency });
        const updated = await assetsApi.update(base.asset.value.id, body, base.asset.etag);
        toast({
          variant: 'success',
          title: t('assetForm.updated', { tag: updated.value.asset_tag }),
        });
        await invalidateAssets();
        router.push(routes.assetView(updated.value.id));
        return;
      }
      const body = toCreateBody(state, fields, {
        currency,
        modelName: lookups.modelById.get(state.model_id)?.name,
      });
      const created = await assetsApi.create(body);
      await invalidateAssets();
      toast({
        variant: 'success',
        title: t('assetForm.created', { tag: created.value.asset_tag }),
        action: {
          label: t('assetForm.open'),
          onClick: () => router.push(routes.assetView(created.value.id)),
        },
      });
      if (another) {
        // Bulk entry: keep what repeats (category, model, location, purchase info), clear what is unique.
        setState((s) => ({
          ...s,
          name: '',
          tagMode: 'auto',
          asset_tag: '',
          serial: '',
          notes: '',
        }));
        setDuplicates({});
        serialRef.current?.focus();
      } else {
        router.push(routes.assetView(created.value.id));
      }
    } catch (err) {
      const ui = getApi().toUiError(err);
      if (ui.kind === 'stale') {
        setStale(true);
      } else {
        const map: Record<string, string> = {};
        for (const fe of ui.fieldErrors) map[pointerToKey(fe.pointer)] = fe.message;
        if (Object.keys(map).length > 0) reportErrors(map);
        else setFormError(ui.detail ?? t(ui.messageKey));
        if (ui.kind === 'conflict' && map.asset_tag) void checkDuplicate('tag', state.asset_tag);
      }
    } finally {
      setSaving(null);
    }
  };

  const invalidateAssets = () => queryClient.invalidateQueries({ queryKey: ['assets'] });

  const reload = async (keep: boolean) => {
    if (!base.asset) return;
    const fresh = await assetsApi.get(base.asset.value.id);
    const freshForm = formFromAsset(fresh.value, lookups.fields);
    setState(keep ? mergeEdits(base.form, state, freshForm) : freshForm);
    setBase({ asset: fresh, form: freshForm });
    setStale(false);
    setErrors({});
    setSummary([]);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void save(false);
  };

  const category = lookups.categoryById.get(state.category_id);
  const heading =
    mode === 'edit'
      ? t('assetForm.editTitle')
      : mode === 'clone'
        ? t('assetForm.cloneTitle')
        : t('assetForm.newTitle');

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void save(false);
        }
      }}
      aria-label={heading}
      className="flex max-w-3xl flex-col gap-6"
    >
      {stale ? (
        <Banner
          tone="warning"
          title={t('assetForm.stale.title')}
          action={
            <span className="flex flex-wrap gap-2">
              <Button onClick={() => void reload(true)}>{t('assetForm.stale.keep')}</Button>
              <Button onClick={() => void reload(false)}>{t('assetForm.stale.discard')}</Button>
            </span>
          }
        >
          {t('assetForm.stale.description')}
        </Banner>
      ) : null}
      {formError ? <Banner tone="danger">{formError}</Banner> : null}
      {summary.length > 0 ? (
        <Banner tone="danger" title={t('assetForm.summary', { count: summary.length })}>
          <ul className="list-disc pl-5">
            {summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Banner>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-md font-semibold">{t('assetForm.basics')}</legend>
        <Field label={t('assetForm.category')} required error={errors.category_id || undefined}>
          {(c) => (
            <Select
              {...c}
              invalid={!!errors.category_id}
              value={state.category_id}
              placeholder={t('common.choose')}
              onValueChange={changeCategory}
              options={lookups.categories
                .filter((x) => !x.archived_at)
                .map((x) => ({ value: x.id, label: x.name }))}
            />
          )}
        </Field>
        {pendingCategory ? (
          <Banner
            tone="warning"
            title={t('assetForm.categoryChange.title')}
            action={
              <span className="flex gap-2">
                <Button onClick={() => applyCategory(pendingCategory.id)}>
                  {t('assetForm.categoryChange.confirm')}
                </Button>
                <Button onClick={() => setPendingCategory(null)}>
                  {t('assetForm.categoryChange.keep')}
                </Button>
              </span>
            }
          >
            {t('assetForm.categoryChange.description', {
              fields: pendingCategory.dropped.join(', '),
            })}
          </Banner>
        ) : null}
        <Field label={t('assetForm.model')} error={errors.model_id || undefined}>
          {(c) => (
            <Select
              {...c}
              invalid={!!errors.model_id}
              value={state.model_id || NONE}
              disabled={!state.category_id}
              onValueChange={(v) => chooseModel(v === NONE ? '' : v)}
              options={[
                { value: NONE, label: t('common.none') },
                ...models.map((m) => ({
                  value: m.id,
                  label:
                    `${lookups.manufacturerById.get(m.manufacturer_id ?? '')?.name ?? ''} ${m.name}`.trim(),
                })),
              ]}
            />
          )}
        </Field>
        <Field
          label={t('assetForm.name')}
          hint={t('assetForm.nameHint')}
          error={errors.name || undefined}
        >
          {(c) => (
            <Input
              {...c}
              invalid={!!errors.name}
              value={state.name}
              placeholder={lookups.modelById.get(state.model_id)?.name}
              onChange={(e) => set('name', e.target.value)}
            />
          )}
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium">{t('assetForm.tag')}</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {(['auto', 'manual'] as const).map((value) => (
              <label
                key={value}
                className="inline-flex min-h-6 cursor-pointer items-center gap-2 text-base"
              >
                <input
                  type="radio"
                  name="tag-mode"
                  value={value}
                  checked={state.tagMode === value}
                  onChange={() => {
                    set('tagMode', value);
                    if (value === 'auto') set('asset_tag', '');
                  }}
                  className="size-4 accent-[var(--color-primary)]"
                />
                {value === 'auto' ? t('assetForm.tagAuto') : t('assetForm.tagManual')}
              </label>
            ))}
          </div>
          {state.tagMode === 'manual' ? (
            <Field
              label={t('assetForm.tagValue')}
              required
              hint={duplicateHint(
                duplicates.tag,
                t('assetForm.duplicateTag'),
                t('assetForm.openExisting'),
              )}
              error={errors.asset_tag || undefined}
            >
              {(c) => (
                <Input
                  {...c}
                  className="font-tag"
                  invalid={!!errors.asset_tag}
                  value={state.asset_tag}
                  onChange={(e) => set('asset_tag', e.target.value)}
                  onBlur={(e) => void checkDuplicate('tag', e.target.value)}
                />
              )}
            </Field>
          ) : (
            <p className="text-sm text-muted">
              {t('assetForm.tagAutoHint', { prefix: category?.tag_prefix ?? '' })}
            </p>
          )}
        </fieldset>

        <Field
          label={t('assetForm.serial')}
          hint={duplicateHint(
            duplicates.serial,
            t('assetForm.duplicateSerial'),
            t('assetForm.openExisting'),
          )}
          error={errors.serial || undefined}
        >
          {(c) => (
            <Input
              {...c}
              ref={serialRef}
              className="font-tag"
              invalid={!!errors.serial}
              value={state.serial}
              onChange={(e) => set('serial', e.target.value)}
              onBlur={(e) => void checkDuplicate('serial', e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('assetForm.status')} error={errors.status_id || undefined}>
            {(c) => (
              <Select
                {...c}
                invalid={!!errors.status_id}
                value={state.status_id}
                placeholder={t('common.choose')}
                onValueChange={(v) => set('status_id', v)}
                options={lookups.statuses
                  .filter((s) => !s.archived_at)
                  .map((s) => ({ value: s.id, label: s.name }))}
              />
            )}
          </Field>
          <Field label={t('assetForm.location')} error={errors.location_id || undefined}>
            {(c) => (
              <Select
                {...c}
                invalid={!!errors.location_id}
                value={state.location_id || NONE}
                onValueChange={(v) => set('location_id', v === NONE ? '' : v)}
                options={[
                  { value: NONE, label: t('common.none') },
                  ...lookups.locations.map((l) => ({
                    value: l.id,
                    label: lookups.locationLabel(l.id),
                  })),
                ]}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-md font-semibold">{t('assetForm.purchase')}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('assetForm.purchaseDate')} error={errors.purchase_date || undefined}>
            {(c) => (
              <Input
                {...c}
                type="date"
                invalid={!!errors.purchase_date}
                value={state.purchase_date}
                onChange={(e) => set('purchase_date', e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('assetForm.costWithCurrency', {
              currency: base.asset?.value.purchase_cost?.currency ?? currency,
            })}
            error={errors.cost || undefined}
          >
            {(c) => (
              <Input
                {...c}
                inputMode="decimal"
                invalid={!!errors.cost}
                value={state.cost}
                onChange={(e) => set('cost', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('assetForm.vendor')} error={errors.vendor_id || undefined}>
            {(c) => (
              <Select
                {...c}
                invalid={!!errors.vendor_id}
                value={state.vendor_id || NONE}
                onValueChange={(v) => set('vendor_id', v === NONE ? '' : v)}
                options={[
                  { value: NONE, label: t('common.none') },
                  ...lookups.vendors
                    .filter((v) => !v.archived_at)
                    .map((v) => ({ value: v.id, label: v.name })),
                ]}
              />
            )}
          </Field>
          <Field label={t('assetForm.orderNumber')} error={errors.order_number || undefined}>
            {(c) => (
              <Input
                {...c}
                invalid={!!errors.order_number}
                value={state.order_number}
                onChange={(e) => set('order_number', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('assetForm.warrantyEnd')} error={errors.warranty_end || undefined}>
            {(c) => (
              <Input
                {...c}
                type="date"
                invalid={!!errors.warranty_end}
                value={state.warranty_end}
                onChange={(e) => set('warranty_end', e.target.value)}
              />
            )}
          </Field>
        </div>
      </fieldset>

      {state.category_id ? (
        <fieldset className="flex flex-col gap-4" data-testid="custom-fields">
          <legend className="mb-2 text-md font-semibold">
            {t('assetForm.customFields', { category: category?.name ?? '' })}
          </legend>
          {fields.length === 0 ? (
            <p className="text-base text-muted">{t('assetForm.noCustomFields')}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((def) => (
                <CustomFieldInput
                  key={def.id}
                  def={def}
                  value={state.custom[def.key]}
                  onChange={(v) => setCustom(def.key, v)}
                  error={errors[`cf:${def.key}`] || undefined}
                />
              ))}
            </div>
          )}
        </fieldset>
      ) : null}

      <Field label={t('assetForm.notes')} error={errors.notes || undefined}>
        {(c) => (
          <Textarea
            {...c}
            invalid={!!errors.notes}
            value={state.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          loading={saving === 'save'}
          disabled={saving !== null}
        >
          {t('common.save')}
        </Button>
        {mode !== 'edit' ? (
          <Button
            loading={saving === 'another'}
            disabled={saving !== null}
            onClick={() => void save(true)}
          >
            {t('assetForm.saveAndAdd')}
          </Button>
        ) : null}
        <Button asChild>
          <Link
            href={mode === 'edit' && source ? routes.assetView(source.value.id) : routes.assets}
          >
            {t('common.cancel')}
          </Link>
        </Button>
        <span className="ml-auto text-sm text-muted">{t('assetForm.saveShortcut')}</span>
      </div>
    </form>
  );
}

function duplicateHint(existing: Asset | undefined, message: string, linkLabel: string): ReactNode {
  if (!existing) return undefined;
  return (
    <>
      {message}{' '}
      <Link
        href={routes.assetView(existing.id)}
        className="text-primary-text underline underline-offset-2"
      >
        {linkLabel}
      </Link>
    </>
  );
}
