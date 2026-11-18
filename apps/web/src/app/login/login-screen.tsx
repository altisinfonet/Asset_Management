'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AuthCard, AuthLayout } from '@/components/auth/auth-layout';
import { FormError } from '@/components/auth/form-error';
import { PasswordField } from '@/components/auth/password-field';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { authApi } from '@/lib/auth/auth-api';
import { useAuth } from '@/lib/auth/auth-context';
import { describeLoginError, type DescribedError } from '@/lib/auth/messages';
import { safeNext } from '@/lib/auth/next-url';
import type { LoginResponse, MfaMethod, TenantChoice } from '@/lib/auth/types';
import { routes } from '@/lib/routes';
import { MfaChallenge } from './mfa-challenge';
import { TenantStep } from './tenant-step';

type Step =
  | { kind: 'credentials' }
  | { kind: 'tenant'; tenants: TenantChoice[] }
  | { kind: 'mfa'; challengeId: string; methods: MfaMethod[] };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign in (wireframe WEB-01): email + password, then optionally a tenant choice (the email
 * exists in several organisations) and the MFA challenge (TOTP or recovery code). The server
 * answers every wrong-credentials case with the same 401, and so does this screen.
 */
export function LoginScreen() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const auth = useAuth();
  const next = safeNext(params.get('next'));
  const reason = params.get('reason');

  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<DescribedError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const status = auth.state.status;
  useEffect(() => {
    if (status === 'authenticated') router.replace(next);
    else if (status === 'mfa_enrolment_required') router.replace(routes.mfaEnrol(next));
  }, [status, next, router]);

  const reasonMessage =
    reason === 'expired'
      ? t('login.reason.expired')
      : reason === 'signed_out'
        ? t('login.reason.signedOut')
        : reason === 'password_reset'
          ? t('login.reason.passwordReset')
          : null;

  const signIn = async (tenantSlug?: string) => {
    setSubmitting(true);
    setFormError(null);
    setNotice(null);
    try {
      const response = await authApi.login({
        email: email.trim(),
        password,
        ...(tenantSlug ? { tenant_slug: tenantSlug } : {}),
      });
      await handleResponse(response);
    } catch (err) {
      setFormError(describeLoginError(err, t));
      if (step.kind !== 'credentials') setStep({ kind: 'credentials' });
      setSubmitting(false);
    }
  };

  const handleResponse = async (response: LoginResponse) => {
    if (response.status === 'mfa_required' && response.mfa) {
      setStep({
        kind: 'mfa',
        challengeId: response.mfa.challenge_id,
        methods: response.mfa.methods,
      });
      setSubmitting(false);
    } else if (response.status === 'tenant_selection_required') {
      setStep({ kind: 'tenant', tenants: response.tenants ?? [] });
      setSubmitting(false);
    } else {
      // Authenticated: load the principal; the effect above then leaves this screen.
      await completeSignIn();
    }
  };

  const completeSignIn = async () => {
    const result = await auth.refresh();
    if (result.status === 'error') {
      setFormError({ message: t(result.error.messageKey), requestId: result.error.requestId });
      setSubmitting(false);
    }
    // On success the screen stays in its busy state until the redirect effect navigates away.
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: typeof errors = {};
    if (!email.trim()) found.email = t('login.errors.emailRequired');
    else if (!EMAIL_SHAPE.test(email.trim())) found.email = t('login.errors.emailInvalid');
    if (!password) found.password = t('login.errors.passwordRequired');
    setErrors(found);
    if (found.email) emailRef.current?.focus();
    else if (found.password) passwordRef.current?.focus();
    else void signIn();
  };

  const backToCredentials = (message?: string) => {
    setStep({ kind: 'credentials' });
    setPassword('');
    setNotice(message ?? null);
    setFormError(null);
    setSubmitting(false);
  };

  return (
    <AuthLayout>
      {step.kind === 'credentials' ? (
        <AuthCard
          title={t('login.title')}
          description={t('login.description')}
          focusHeading={false}
        >
          {reasonMessage && !formError && !notice ? (
            <Banner tone="info">{reasonMessage}</Banner>
          ) : null}
          {notice ? <Banner tone="warning">{notice}</Banner> : null}
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <Field label={t('login.email')} required error={errors.email}>
              {(control) => (
                <Input
                  ref={emailRef}
                  type="email"
                  name="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  {...control}
                />
              )}
            </Field>
            <PasswordField
              label={t('login.password')}
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              error={errors.password}
              inputRef={passwordRef}
            />
            <FormError message={formError?.message} requestId={formError?.requestId} />
            <Button type="submit" variant="primary" loading={submitting}>
              {t('login.submit')}
            </Button>
            <Button asChild variant="link" className="self-start">
              <Link href={routes.forgotPassword}>{t('login.forgot')}</Link>
            </Button>
          </form>
        </AuthCard>
      ) : null}

      {step.kind === 'tenant' ? (
        <TenantStep
          tenants={step.tenants}
          submitting={submitting}
          error={formError}
          onSelect={(slug) => void signIn(slug)}
          onBack={() => backToCredentials()}
        />
      ) : null}

      {step.kind === 'mfa' ? (
        <MfaChallenge
          challengeId={step.challengeId}
          methods={step.methods}
          onVerified={completeSignIn}
          onExpired={() => backToCredentials(t('login.mfa.challengeExpired'))}
          onBack={() => backToCredentials()}
        />
      ) : null}
    </AuthLayout>
  );
}
