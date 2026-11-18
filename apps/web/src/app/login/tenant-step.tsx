'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth/auth-layout';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { DescribedError } from '@/lib/auth/messages';
import type { TenantChoice } from '@/lib/auth/types';

/**
 * The email exists in several organisations (`tenant_selection_required`): pick one and the
 * same credentials are sent again with `tenant_slug`.
 */
export function TenantStep({
  tenants,
  submitting,
  error,
  onSelect,
  onBack,
}: {
  tenants: TenantChoice[];
  submitting: boolean;
  error: DescribedError | null;
  onSelect: (slug: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [slug, setSlug] = useState(tenants[0]?.slug ?? '');
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (slug) onSelect(slug);
  };

  return (
    <AuthCard title={t('login.tenant.title')} description={t('login.tenant.description')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium">{t('login.tenant.legend')}</legend>
          {tenants.map((tenant, index) => (
            <label
              key={tenant.slug}
              className="flex min-h-(--size-control) cursor-pointer items-center gap-3 rounded-md border border-border-strong px-3 has-[:checked]:border-primary has-[:checked]:bg-primary-subtle"
            >
              <input
                ref={index === 0 ? firstRef : undefined}
                type="radio"
                name="tenant"
                value={tenant.slug}
                checked={slug === tenant.slug}
                onChange={() => setSlug(tenant.slug)}
                className="size-4 accent-(--color-primary)"
              />
              <span className="text-base">{tenant.name}</span>
            </label>
          ))}
        </fieldset>
        <FormError message={error?.message} requestId={error?.requestId} />
        <Button type="submit" variant="primary" loading={submitting}>
          {t('login.tenant.continue')}
        </Button>
        <Button variant="link" className="self-start" onClick={onBack}>
          {t('login.tenant.back')}
        </Button>
      </form>
    </AuthCard>
  );
}
