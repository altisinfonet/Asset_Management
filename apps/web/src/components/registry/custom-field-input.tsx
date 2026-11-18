'use client';

import { CircleX } from 'lucide-react';
import { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useT } from '@/i18n';
import { rulesOf, type RawValue } from '@/lib/registry/custom-fields';
import type { CustomFieldDef } from '@/lib/registry/types';

export interface CustomFieldInputProps {
  def: Pick<
    CustomFieldDef,
    'key' | 'label' | 'data_type' | 'required' | 'options' | 'validation' | 'help_text'
  >;
  value: RawValue | undefined;
  onChange: (value: RawValue) => void;
  error?: string;
  disabled?: boolean;
}

const NONE = '__none__';

/**
 * One input per custom field definition, chosen by `data_type`: text, long text, number (with
 * min/max), checkbox, date, select, multi-select (checkbox group), URL and email. The same
 * component renders the form on the asset screens and the live preview in the field builder.
 */
export function CustomFieldInput({ def, value, onChange, error, disabled }: CustomFieldInputProps) {
  const t = useT();
  const groupId = useId();
  const hint = def.help_text ?? undefined;
  const rules = rulesOf(def);

  if (def.data_type === 'boolean') {
    return (
      <div className="flex flex-col gap-1.5">
        <Checkbox
          label={def.label}
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(v) => onChange(v === true)}
        />
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
        {error ? <FieldMessage text={error} /> : null}
      </div>
    );
  }

  if (def.data_type === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset
        className="flex flex-col gap-1.5"
        aria-describedby={error ? `${groupId}-error` : undefined}
      >
        <legend className="mb-1.5 text-base font-medium text-text">
          {def.label}
          {def.required ? (
            <span className="ml-1 font-normal text-muted">{t('common.required')}</span>
          ) : null}
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(def.options ?? []).map((option) => (
            <Checkbox
              key={option.value}
              label={option.label ?? option.value}
              checked={selected.includes(option.value)}
              disabled={disabled}
              onCheckedChange={(on) =>
                onChange(
                  on === true
                    ? [...selected, option.value]
                    : selected.filter((v) => v !== option.value),
                )
              }
            />
          ))}
        </div>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
        {error ? <FieldMessage id={`${groupId}-error`} text={error} /> : null}
      </fieldset>
    );
  }

  return (
    <Field label={def.label} required={def.required} hint={hint} error={error}>
      {(control) => {
        const text = typeof value === 'string' ? value : '';
        switch (def.data_type) {
          case 'select':
            return (
              <Select
                {...control}
                invalid={!!error}
                disabled={disabled}
                value={text || (def.required ? '' : NONE)}
                onValueChange={(v) => onChange(v === NONE ? '' : v)}
                placeholder={t('customFields.choose')}
                options={[
                  ...(def.required ? [] : [{ value: NONE, label: t('customFields.notSet') }]),
                  ...(def.options ?? []).map((o) => ({
                    value: o.value,
                    label: o.label ?? o.value,
                  })),
                ]}
              />
            );
          case 'long_text':
            return (
              <Textarea
                {...control}
                invalid={!!error}
                disabled={disabled}
                value={text}
                onChange={(e) => onChange(e.target.value)}
              />
            );
          case 'number':
            return (
              <Input
                {...control}
                type="number"
                step="any"
                min={rules.min}
                max={rules.max}
                inputMode="decimal"
                invalid={!!error}
                disabled={disabled}
                value={text}
                onChange={(e) => onChange(e.target.value)}
              />
            );
          case 'date':
            return (
              <Input
                {...control}
                type="date"
                invalid={!!error}
                disabled={disabled}
                value={text}
                onChange={(e) => onChange(e.target.value)}
              />
            );
          case 'url':
          case 'email':
            return (
              <Input
                {...control}
                type={def.data_type}
                invalid={!!error}
                disabled={disabled}
                value={text}
                onChange={(e) => onChange(e.target.value)}
              />
            );
          default:
            return (
              <Input
                {...control}
                invalid={!!error}
                disabled={disabled}
                value={text}
                onChange={(e) => onChange(e.target.value)}
              />
            );
        }
      }}
    </Field>
  );
}

function FieldMessage({ text, id }: { text: string; id?: string }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-sm text-danger-text">
      <CircleX aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </p>
  );
}
