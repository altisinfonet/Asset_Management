'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { AuthCard, AuthLayout } from '@/components/auth/auth-layout';
import { FormError } from '@/components/auth/form-error';
import { PasswordField } from '@/components/auth/password-field';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { toUiError } from '@/lib/api';
import { authApi } from '@/lib/auth/auth-api';
import {
  errorCode,
  isStatus,
  MIN_PASSWORD_LENGTH,
  passwordFieldError,
  tooManyAttemptsMessage,
} from '@/lib/auth/messages';
import { routes } from '@/lib/routes';

type Outcome = 'form' | 'done' | 'invalid' | 'expired';

/**
 * Choose a new password from an emailed link (`/reset-password?token=...`). Tokens are
 * single-use and short-lived; a successful reset signs out every session (M1-AUTH-05), so the
 * next step is the login screen.
 */
export function ResetPasswordScreen() {
  const t = useT();
  const token = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(token ? 'form' : 'invalid');
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    const found: typeof errors = {};
    if (password.length < MIN_PASSWORD_LENGTH) {
      found.password = t('password.tooShort', { min: MIN_PASSWORD_LENGTH });
    }
    if (confirm !== password) found.confirm = t('password.mismatch');
    setErrors(found);
    if (found.password) {
      passwordRef.current?.focus();
      return;
    }
    if (found.confirm) {
      confirmRef.current?.focus();
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await authApi.resetPassword(token, password);
      setOutcome('done');
    } catch (err) {
      if (isStatus(err, 410) || errorCode(err) === 'token-expired') setOutcome('expired');
      else if (isStatus(err, 404)) setOutcome('invalid');
      else if (isStatus(err, 422)) {
        const message = passwordFieldError(err);
        setErrors({ password: message ?? t('error.validation') });
        passwordRef.current?.focus();
      } else if (isStatus(err, 429)) setFormError(tooManyAttemptsMessage(err, t));
      else setFormError(t(toUiError(err).messageKey));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      {outcome === 'done' ? (
        <AuthCard
          title={t('reset.successTitle')}
          description={t('reset.successDescription')}
          focusHeading
        >
          <Button asChild variant="primary">
            <Link href={routes.loginWith({ reason: 'password_reset' })}>{t('reset.signIn')}</Link>
          </Button>
        </AuthCard>
      ) : null}

      {outcome === 'invalid' || outcome === 'expired' ? (
        <AuthCard
          title={outcome === 'expired' ? t('reset.expiredTitle') : t('reset.invalidTitle')}
          description={
            outcome === 'expired' ? t('reset.expiredDescription') : t('reset.invalidDescription')
          }
          focusHeading
        >
          <Button asChild variant="primary">
            <Link href={routes.forgotPassword}>{t('reset.requestNew')}</Link>
          </Button>
        </AuthCard>
      ) : null}

      {outcome === 'form' ? (
        <AuthCard title={t('reset.title')} description={t('reset.description')}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <PasswordField
              label={t('reset.newPassword')}
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              error={errors.password}
              hint={t('password.hint', { min: MIN_PASSWORD_LENGTH })}
              inputRef={passwordRef}
            />
            <PasswordField
              label={t('reset.confirmPassword')}
              name="confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
              error={errors.confirm}
              inputRef={confirmRef}
            />
            <FormError message={formError} />
            <Button type="submit" variant="primary" loading={submitting}>
              {t('reset.submit')}
            </Button>
          </form>
        </AuthCard>
      ) : null}
    </AuthLayout>
  );
}
