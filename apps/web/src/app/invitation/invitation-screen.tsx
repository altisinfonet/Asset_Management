'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AuthCard, AuthLayout } from '@/components/auth/auth-layout';
import { FormError } from '@/components/auth/form-error';
import { PasswordField } from '@/components/auth/password-field';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { toUiError } from '@/lib/api';
import { authApi } from '@/lib/auth/auth-api';
import { useAuth } from '@/lib/auth/auth-context';
import {
  errorCode,
  isStatus,
  MIN_PASSWORD_LENGTH,
  passwordFieldError,
  tooManyAttemptsMessage,
} from '@/lib/auth/messages';
import type { InvitationInfo } from '@/lib/auth/types';
import { routes } from '@/lib/routes';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; invitation: InvitationInfo }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

/**
 * Accept an invitation (`/invitation?token=...`): shows who invited you, then sets the display
 * name and password. Accepting creates the session; when the organisation requires MFA the
 * session is limited and `AuthProvider` reports `mfa_enrolment_required`, which sends the user
 * to the enrolment screen before anything else (M1-AUTH-05).
 */
export function InvitationScreen() {
  const t = useT();
  const router = useRouter();
  const auth = useAuth();
  const token = useSearchParams().get('token');
  const [load, setLoad] = useState<Load>(token ? { kind: 'loading' } : { kind: 'invalid' });
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ name?: string; password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    authApi
      .getInvitation(token, controller.signal)
      .then((invitation) => {
        setDisplayName(invitation.display_name);
        setLoad({ kind: 'ready', invitation });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(err, 410) || errorCode(err) === 'invitation-expired') {
          setLoad({ kind: 'expired' });
        } else if (isStatus(err, 404)) setLoad({ kind: 'invalid' });
        else setLoad({ kind: 'error', message: t(toUiError(err).messageKey) });
      });
    return () => controller.abort();
  }, [token, t]);

  // After accepting, the session exists: go to the dashboard, or to the enrolment screen.
  const status = auth.state.status;
  useEffect(() => {
    if (!submitting) return;
    if (status === 'authenticated') router.replace(routes.dashboard);
    else if (status === 'mfa_enrolment_required') router.replace(routes.mfaEnrol());
  }, [status, submitting, router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    const found: typeof errors = {};
    if (!displayName.trim()) found.name = t('invitation.nameRequired');
    if (password.length < MIN_PASSWORD_LENGTH) {
      found.password = t('password.tooShort', { min: MIN_PASSWORD_LENGTH });
    }
    if (confirm !== password) found.confirm = t('password.mismatch');
    setErrors(found);
    if (found.name) return void nameRef.current?.focus();
    if (found.password) return void passwordRef.current?.focus();
    if (found.confirm) return void confirmRef.current?.focus();

    setFormError(null);
    setSubmitting(true);
    try {
      await authApi.acceptInvitation({ token, password, display_name: displayName.trim() });
      const result = await auth.refresh();
      if (result.status === 'error') {
        setFormError(t(result.error.messageKey));
        setSubmitting(false);
      }
      // Otherwise stay busy until the effect above navigates.
    } catch (err) {
      setSubmitting(false);
      if (isStatus(err, 410) || errorCode(err) === 'invitation-expired') {
        setLoad({ kind: 'expired' });
      } else if (isStatus(err, 404)) setLoad({ kind: 'invalid' });
      else if (isStatus(err, 422)) {
        setErrors({ password: passwordFieldError(err) ?? t('error.validation') });
        passwordRef.current?.focus();
      } else if (isStatus(err, 429)) setFormError(tooManyAttemptsMessage(err, t));
      else setFormError(t(toUiError(err).messageKey));
    }
  };

  return (
    <AuthLayout>
      {load.kind === 'loading' ? (
        <AuthCard title={t('invitation.title')}>
          <div role="status" aria-live="polite" className="flex flex-col gap-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <span className="sr-only">{t('invitation.loading')}</span>
          </div>
        </AuthCard>
      ) : null}

      {load.kind === 'invalid' || load.kind === 'expired' ? (
        <AuthCard
          title={
            load.kind === 'expired' ? t('invitation.expiredTitle') : t('invitation.invalidTitle')
          }
          description={
            load.kind === 'expired'
              ? t('invitation.expiredDescription')
              : t('invitation.invalidDescription')
          }
          focusHeading
        >
          <Button asChild variant="secondary">
            <Link href={routes.login}>{t('invitation.signIn')}</Link>
          </Button>
        </AuthCard>
      ) : null}

      {load.kind === 'error' ? (
        <AuthCard title={t('invitation.title')} focusHeading>
          <FormError message={load.message} />
        </AuthCard>
      ) : null}

      {load.kind === 'ready' ? (
        <AuthCard
          title={t('invitation.title')}
          description={t('invitation.description', { tenant: load.invitation.tenant_name })}
        >
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <Field
              label={t('invitation.email')}
              hint={
                load.invitation.role_name
                  ? t('invitation.role', { role: load.invitation.role_name })
                  : undefined
              }
            >
              {(control) => (
                <Input
                  type="email"
                  name="email"
                  autoComplete="username"
                  readOnly
                  value={load.invitation.email}
                  {...control}
                />
              )}
            </Field>
            <Field label={t('invitation.displayName')} required error={errors.name}>
              {(control) => (
                <Input
                  ref={nameRef}
                  name="name"
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  {...control}
                />
              )}
            </Field>
            <PasswordField
              label={t('invitation.password')}
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              error={errors.password}
              hint={t('password.hint', { min: MIN_PASSWORD_LENGTH })}
              inputRef={passwordRef}
            />
            <PasswordField
              label={t('password.confirm')}
              name="confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
              error={errors.confirm}
              inputRef={confirmRef}
            />
            <FormError message={formError} />
            <Button type="submit" variant="primary" loading={submitting}>
              {t('invitation.submit')}
            </Button>
          </form>
        </AuthCard>
      ) : null}
    </AuthLayout>
  );
}
