'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, type FieldControlProps } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { useT } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';

export interface FormFieldSpec {
  name: string;
  label: string;
  kind:
    'text' | 'textarea' | 'number' | 'select' | 'date' | 'checkbox' | 'email' | 'url' | 'custom';
  required?: boolean;
  hint?: string;
  placeholder?: string;
  options?: SelectOption[];
  /** Select: offer an empty choice with this label. */
  emptyLabel?: string;
  disabled?: boolean;
  mono?: boolean;
  min?: number;
  max?: number;
  /** `custom`: render your own control (a picker), wired with the field's label, hint and error. */
  render?: (context: CustomFieldContext) => ReactNode;
  /** Shown only while this returns true (fields that depend on another field). */
  visible?: (values: FormValues) => boolean;
}

export interface CustomFieldContext {
  control: FieldControlProps;
  value: string | boolean;
  set: (value: string | boolean) => void;
  invalid: boolean;
}

export type FormValues = Record<string, string | boolean>;

const NONE = '__none__';

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: FormFieldSpec[];
  initial: FormValues;
  submitLabel: string;
  /** Throw to keep the dialog open: field errors and problem details are shown inline. */
  onSubmit: (values: FormValues) => Promise<void>;
  size?: 'md' | 'lg';
  /** Extra content between the fields and the buttons (for example a live preview). */
  footerNote?: ReactNode;
  /** Called on every change, for live previews. */
  onChange?: (values: FormValues) => void;
}

/**
 * Generic form dialog for the catalogue screens: fields from a spec, required checks, and server
 * problems mapped back to the fields (`errors[].pointer` `/name` -> field `name`) with a banner for
 * anything else, including the request id. A `412` says the record changed and asks to reload.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  initial,
  submitLabel,
  onSubmit,
  size = 'md',
  footerNote,
  onChange,
}: FormDialogProps) {
  const t = useT();
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Start from the initial values every time the dialog opens.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when (re)opened
      setValues(initial);
      setErrors({});
      setFormError(null);
      setSubmitting(false);
    }
    // `initial` is a fresh object each render; only a new open should reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (name: string, value: string | boolean) => {
    setValues((current) => {
      const next = { ...current, [name]: value };
      onChange?.(next);
      return next;
    });
    setErrors((current) => (current[name] ? { ...current, [name]: '' } : current));
  };

  const focusFirstInvalid = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const missing: Record<string, string> = {};
    for (const field of fields) {
      if (field.visible && !field.visible(values)) continue;
      const value = values[field.name];
      if (field.required && field.kind !== 'checkbox' && (!value || String(value).trim() === '')) {
        missing[field.name] = t('form.required');
      }
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      focusFirstInvalid();
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (err) {
      const ui = getApi().toUiError(err);
      const byField: Record<string, string> = {};
      for (const fe of ui.fieldErrors) {
        const name = fe.pointer.replace(/^\//, '');
        if (fields.some((f) => f.name === name)) byField[name] = fe.message;
      }
      setErrors(byField);
      // Show the banner unless every problem landed on a field.
      const handled =
        ui.fieldErrors.length > 0 && Object.keys(byField).length === ui.fieldErrors.length;
      setFormError(handled ? null : ui);
      focusFirstInvalid();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        <form
          ref={formRef}
          onSubmit={(e) => void submit(e)}
          noValidate
          className="flex flex-col gap-4"
        >
          {formError ? (
            <FormError message={uiErrorText(t, formError)} requestId={formError.requestId} />
          ) : null}
          {fields.map((field) =>
            field.visible && !field.visible(values) ? null : field.kind === 'checkbox' ? (
              <Checkbox
                key={field.name}
                label={field.label}
                checked={values[field.name] === true}
                disabled={field.disabled}
                onCheckedChange={(v) => set(field.name, v === true)}
              />
            ) : (
              <Field
                key={field.name}
                label={field.label}
                required={field.required}
                hint={field.hint}
                error={errors[field.name] || undefined}
              >
                {(control) =>
                  field.kind === 'custom' ? (
                    (field.render?.({
                      control,
                      value: values[field.name] ?? '',
                      set: (value) => set(field.name, value),
                      invalid: !!errors[field.name],
                    }) ?? null)
                  ) : field.kind === 'select' ? (
                    <Select
                      {...control}
                      invalid={!!errors[field.name]}
                      disabled={field.disabled}
                      value={String(values[field.name] || '') || (field.emptyLabel ? NONE : '')}
                      placeholder={field.placeholder}
                      onValueChange={(v) => set(field.name, v === NONE ? '' : v)}
                      options={[
                        ...(field.emptyLabel ? [{ value: NONE, label: field.emptyLabel }] : []),
                        ...(field.options ?? []),
                      ]}
                    />
                  ) : field.kind === 'textarea' ? (
                    <Textarea
                      {...control}
                      invalid={!!errors[field.name]}
                      disabled={field.disabled}
                      value={String(values[field.name] ?? '')}
                      placeholder={field.placeholder}
                      onChange={(e) => set(field.name, e.target.value)}
                    />
                  ) : (
                    <Input
                      {...control}
                      type={field.kind}
                      invalid={!!errors[field.name]}
                      disabled={field.disabled}
                      value={String(values[field.name] ?? '')}
                      placeholder={field.placeholder}
                      min={field.min}
                      max={field.max}
                      className={field.mono ? 'font-tag' : undefined}
                      onChange={(e) => set(field.name, e.target.value)}
                    />
                  )
                }
              </Field>
            ),
          )}
          {footerNote}
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
