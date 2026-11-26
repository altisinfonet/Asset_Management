'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { uiErrorText } from '@/lib/error-text';
import { custodySettingsApi } from '@/lib/loaners/api';
import { useCustodySettings } from '@/lib/loaners/queries';

/**
 * The organisation's custody settings (`GET/PUT /v1/settings/custody`): how many days from today the
 * return date of a regular check-out starts at (the API only offers it, it never applies it), and
 * how many days before the due date a borrower is reminded. Changing them needs `catalog:manage`.
 */
export function CustodyDefaults({
  heading,
  description,
}: {
  heading?: string;
  description?: string;
} = {}) {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const settings = useCustodySettings();
  const loaded = settings.data;
  const canManage = can('catalog:manage');
  const [values, setValues] = useState({ expected: '', reminder: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form starts from what the server has
    setValues({
      expected: loaded.value.default_expected_return_days
        ? String(loaded.value.default_expected_return_days)
        : '',
      reminder: String(loaded.value.loan_reminder_days),
    });
  }, [loaded]);

  const whole = (text: string, min: number, max: number): number | null => {
    const n = Number(text.trim());
    return text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const expected = values.expected.trim() === '' ? null : whole(values.expected, 1, 366);
    const reminder = whole(values.reminder, 0, 30);
    const next: Record<string, string> = {};
    if (values.expected.trim() !== '' && expected === null) {
      next.expected = t('loanerPools.defaults.errors.expectedDays');
    }
    if (reminder === null) next.reminder = t('loanerPools.defaults.errors.reminder');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    setFormError(null);
    try {
      await custodySettingsApi.put(
        { default_expected_return_days: expected, loan_reminder_days: reminder! },
        loaded?.etag,
      );
      await client.invalidateQueries({ queryKey: ['custody-settings'] });
      toast({ variant: 'success', title: t('loanerPools.defaults.saved') });
    } catch (err) {
      const ui = getApi().toUiError(err);
      const byField: Record<string, string> = {};
      for (const fe of ui.fieldErrors) {
        const key = {
          default_expected_return_days: 'expected',
          loan_reminder_days: 'reminder',
        }[fe.pointer.replace(/^\//, '')];
        if (key) byField[key] = fe.message;
      }
      setErrors(byField);
      setFormError(
        ui.fieldErrors.length > 0 && Object.keys(byField).length === ui.fieldErrors.length
          ? null
          : ui,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="loan-defaults"
      className="flex max-w-2xl flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div>
        <h2 id="loan-defaults" className="text-lg font-semibold text-text">
          {heading ?? t('loanerPools.defaults.heading')}
        </h2>
        <p className="text-base text-muted">
          {description ?? t('loanerPools.defaults.description')}
        </p>
      </div>
      {settings.isError ? (
        <Banner tone="danger">{t('loanerPools.defaults.loadFailed')}</Banner>
      ) : settings.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
          {formError ? (
            <FormError message={uiErrorText(t, formError)} requestId={formError.requestId} />
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={t('loanerPools.defaults.expectedDays')}
              hint={t('loanerPools.defaults.expectedHint')}
              error={errors.expected}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={1}
                  max={366}
                  inputMode="numeric"
                  value={values.expected}
                  readOnly={!canManage}
                  invalid={!!errors.expected}
                  onChange={(event) => setValues({ ...values, expected: event.target.value })}
                />
              )}
            </Field>
            <Field
              label={t('loanerPools.defaults.reminder')}
              hint={t('loanerPools.defaults.reminderHint')}
              error={errors.reminder}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={0}
                  max={30}
                  inputMode="numeric"
                  value={values.reminder}
                  readOnly={!canManage}
                  invalid={!!errors.reminder}
                  onChange={(event) => setValues({ ...values, reminder: event.target.value })}
                />
              )}
            </Field>
          </div>
          {canManage ? (
            <div>
              <Button type="submit" variant="primary" loading={saving}>
                {t('loanerPools.defaults.save')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted">{t('loanerPools.defaults.readOnly')}</p>
          )}
        </form>
      )}
    </section>
  );
}
