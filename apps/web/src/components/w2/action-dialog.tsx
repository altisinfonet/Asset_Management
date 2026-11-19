'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';

export type FieldErrors = Record<string, string>;

export interface ActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  submitVariant?: 'primary' | 'danger';
  size?: 'md' | 'lg';
  /** Checks the form before it is sent: the messages by field name (empty = fine). */
  validate?: () => FieldErrors;
  /** Does the work; throw to keep the dialog open (field errors and the request id are shown). */
  onSubmit: () => Promise<void>;
  /** Resets the form state whenever the dialog opens. */
  onOpen?: () => void;
  /** The fields, given the current errors by field name. */
  children: (context: { errors: FieldErrors; submitting: boolean }) => ReactNode;
  /** Content above the fields (for example a summary of what is being acted on). */
  intro?: ReactNode;
  /** Content below the fields, before the buttons. */
  footerNote?: ReactNode;
  submitDisabled?: boolean;
  /** Close the dialog after a successful submit (default). Off when the caller shows a next step. */
  closeOnSuccess?: boolean;
  className?: string;
}

/**
 * Dialog for one action with a small form (hand out units, return units, record stock ...). It
 * validates, submits, keeps the dialog open on a problem and shows the server's field errors next
 * to the fields (`errors[].pointer` `/quantity` -> field `quantity`) and anything else, with the
 * request id, in a banner. Focus returns to the trigger on close (Radix).
 */
export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  submitVariant = 'primary',
  size = 'md',
  validate,
  onSubmit,
  onOpen,
  children,
  intro,
  footerNote,
  submitDisabled,
  closeOnSuccess = true,
  className,
}: ActionDialogProps) {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when (re)opened
    setErrors({});
    setFormError(null);
    setSubmitting(false);
    onOpen?.();
    // only a new open resets the form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const focusFirstInvalid = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local = validate?.() ?? {};
    if (Object.keys(local).length > 0) {
      setErrors(local);
      setFormError(null);
      focusFirstInvalid();
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setErrors({});
    try {
      await onSubmit();
      if (closeOnSuccess) onOpenChange(false);
    } catch (err) {
      const ui = getApi().toUiError(err);
      const byField: FieldErrors = {};
      for (const fe of ui.fieldErrors) {
        const name = fe.pointer.replace(/^\//, '').split('/')[0] ?? '';
        if (name) byField[name] ??= fe.code === 'duplicate' ? t('form.duplicate') : fe.message;
      }
      setErrors(byField);
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
      <DialogContent size={size} className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        {intro}
        <form
          ref={formRef}
          onSubmit={(event) => void submit(event)}
          noValidate
          className="flex flex-col gap-4"
        >
          {formError ? (
            <FormError message={uiErrorText(t, formError)} requestId={formError.requestId} />
          ) : null}
          {children({ errors, submitting })}
          {footerNote}
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant={submitVariant}
              loading={submitting}
              disabled={submitDisabled}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
