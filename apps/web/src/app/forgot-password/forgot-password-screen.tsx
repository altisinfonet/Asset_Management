'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { AuthCard, AuthLayout } from '@/components/auth/auth-layout';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { authApi } from '@/lib/auth/auth-api';
import { isStatus, tooManyAttemptsMessage } from '@/lib/auth/messages';
import { toUiError } from '@/lib/api';
import { routes } from '@/lib/routes';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Request a password-reset link. The confirmation is identical whether or not the account
 * exists (M1-AUTH-05: never reveal existence), so the screen only knows "request accepted".
 */
export function ForgotPasswordScreen() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = email.trim();
    if (!value || !EMAIL_SHAPE.test(value)) {
      setFieldError(t(value ? 'login.errors.emailInvalid' : 'login.errors.emailRequired'));
      emailRef.current?.focus();
      return;
    }
    setFieldError(undefined);
    setFormError(null);
    setSubmitting(true);
    try {
      await authApi.forgotPassword(value);
      setSentTo(value);
    } catch (err) {
      setFormError(
        isStatus(err, 429) ? tooManyAttemptsMessage(err, t) : t(toUiError(err).messageKey),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      {sentTo ? (
        <AuthCard
          title={t('forgot.sentTitle')}
          description={t('forgot.sentDescription', { email: sentTo })}
          focusHeading
        >
          <Button variant="secondary" onClick={() => setSentTo(null)}>
            {t('forgot.useAnother')}
          </Button>
          <Button asChild variant="link" className="self-start">
            <Link href={routes.login}>{t('forgot.back')}</Link>
          </Button>
        </AuthCard>
      ) : (
        <AuthCard title={t('forgot.title')} description={t('forgot.description')}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <Field label={t('forgot.email')} required error={fieldError}>
              {(control) => (
                <Input
                  ref={emailRef}
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  {...control}
                />
              )}
            </Field>
            <FormError message={formError} />
            <Button type="submit" variant="primary" loading={submitting}>
              {t('forgot.submit')}
            </Button>
            <Button asChild variant="link" className="self-start">
              <Link href={routes.login}>{t('forgot.back')}</Link>
            </Button>
          </form>
        </AuthCard>
      )}
    </AuthLayout>
  );
}
