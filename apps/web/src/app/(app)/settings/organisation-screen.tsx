'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { FormError } from '@/components/auth/form-error';
import { SectionHeader } from '@/components/registry/section-header';
import { CustodyDefaults } from '@/components/settings/custody-defaults';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { uiErrorText } from '@/lib/error-text';
import { filesSettingsApi } from '@/lib/files/api';

const MB = 1024 * 1024;

/**
 * Settings > Organisation (v0.2.8): what the API exposes about the organisation. The name, plan and
 * currency come from `GET /v1/auth/me` (there is no endpoint to change them); the check-out defaults
 * (`GET/PUT /v1/settings/custody`, also on the loaner pools page) and the file settings
 * (`GET/PUT /v1/settings/files`) need `catalog:read` to see and `catalog:manage` to change.
 */
export function OrganisationScreen() {
  const { t } = useI18n();
  const { me, can } = useAuth();
  const tenant = me?.tenant;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t('organisation.title')}
        description={t('organisation.description')}
        section="organisation"
      />
      <section
        aria-labelledby="org-about"
        className="flex max-w-2xl flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="org-about" className="text-lg font-semibold text-text">
          {t('organisation.about.heading')}
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
          <dt className="text-sm text-muted">{t('organisation.about.name')}</dt>
          <dd className="text-base text-text" data-testid="org-name">
            {tenant?.name ?? ''}
          </dd>
          {tenant?.plan ? (
            <>
              <dt className="text-sm text-muted">{t('organisation.about.plan')}</dt>
              <dd className="text-base text-text">{tenant.plan}</dd>
            </>
          ) : null}
          <dt className="text-sm text-muted">{t('organisation.about.currency')}</dt>
          <dd className="text-base text-text">
            <span className="font-tag" data-testid="org-currency">
              {tenant?.base_currency ?? ''}
            </span>
            <span className="block text-sm text-muted">{t('organisation.about.currencyHint')}</span>
          </dd>
        </dl>
        <p className="text-sm text-muted">{t('organisation.about.readOnly')}</p>
      </section>
      {can('catalog:read') ? (
        <>
          <CustodyDefaults
            heading={t('organisation.custody.heading')}
            description={t('organisation.custody.description')}
          />
          <FileSettings />
        </>
      ) : null}
    </div>
  );
}

/** Upload cap override (in whole MB, never above the plan) and EXIF stripping of photos. */
function FileSettings() {
  const { t, formatNumber } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const canManage = can('catalog:manage');
  const settings = useQuery({
    queryKey: ['files-settings', 'versioned'],
    queryFn: () => filesSettingsApi.read(),
    retry: false,
  });
  const loaded = settings.data;
  const [cap, setCap] = useState('');
  const [strip, setStrip] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<UiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form starts from what the server has
    setCap(
      loaded.value.max_upload_bytes === null
        ? ''
        : String(Math.floor(loaded.value.max_upload_bytes / MB)),
    );
    setStrip(loaded.value.strip_exif_original);
  }, [loaded]);

  const tierMb = loaded ? Math.floor((loaded.value.tier_max_upload_bytes ?? 0) / MB) : 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = cap.trim();
    const n = Number(text);
    if (text !== '' && !(Number.isInteger(n) && n >= 1 && n <= tierMb)) {
      setError(t('organisation.files.capInvalid', { max: tierMb }));
      return;
    }
    setError(undefined);
    setSaving(true);
    setFormError(null);
    try {
      await filesSettingsApi.put(
        { strip_exif_original: strip, max_upload_bytes: text === '' ? null : n * MB },
        loaded?.etag,
      );
      await client.invalidateQueries({ queryKey: ['files-settings'] });
      toast({ variant: 'success', title: t('organisation.files.saved') });
    } catch (err) {
      const ui = getApi().toUiError(err);
      const capError = ui.fieldErrors.find((fe) => fe.pointer === '/max_upload_bytes');
      if (capError) setError(capError.message);
      setFormError(capError && ui.fieldErrors.length === 1 ? null : ui);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="org-files"
      className="flex max-w-2xl flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div>
        <h2 id="org-files" className="text-lg font-semibold text-text">
          {t('organisation.files.heading')}
        </h2>
        <p className="text-base text-muted">{t('organisation.files.description')}</p>
      </div>
      {settings.isError ? (
        <Banner tone="danger">{t('organisation.files.loadFailed')}</Banner>
      ) : !loaded ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
          {formError ? (
            <FormError message={uiErrorText(t, formError)} requestId={formError.requestId} />
          ) : null}
          <Field
            label={t('organisation.files.cap')}
            hint={t('organisation.files.capHint', { max: tierMb })}
            error={error}
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                min={1}
                max={tierMb}
                inputMode="numeric"
                className="max-w-40"
                value={cap}
                readOnly={!canManage}
                invalid={!!error}
                onChange={(event) => setCap(event.target.value)}
              />
            )}
          </Field>
          <p className="text-sm text-muted" data-testid="org-effective-cap">
            {t('organisation.files.effective', {
              size: `${formatNumber(Math.floor((loaded.value.effective_max_upload_bytes ?? 0) / MB))} MB`,
            })}
          </p>
          <Checkbox
            label={t('organisation.files.stripExif')}
            checked={strip}
            disabled={!canManage}
            onCheckedChange={(v) => setStrip(v === true)}
          />
          {canManage ? (
            <div>
              <Button type="submit" variant="primary" loading={saving}>
                {t('organisation.files.save')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted">{t('organisation.files.readOnly')}</p>
          )}
        </form>
      )}
    </section>
  );
}
