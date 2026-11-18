'use client';

import QRCode from 'qrcode';
import { Copy, Download } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AuthCard, AuthLayout } from '@/components/auth/auth-layout';
import { FormError } from '@/components/auth/form-error';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { toUiError } from '@/lib/api';
import { authApi } from '@/lib/auth/auth-api';
import { useAuth } from '@/lib/auth/auth-context';
import { isStatus, tooManyAttemptsMessage } from '@/lib/auth/messages';
import { safeNext } from '@/lib/auth/next-url';
import type { MfaEnrolment } from '@/lib/auth/types';
import { routes } from '@/lib/routes';

type Phase =
  | { kind: 'loading' }
  | { kind: 'scan'; enrolment: MfaEnrolment; qrDataUrl: string }
  | { kind: 'recovery'; codes: string[] }
  | { kind: 'error'; message: string };

/** Space the setup key in groups of four so it is easy to read and type. */
function groupSecret(secret: string): string {
  return secret
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * TOTP enrolment (M1-AUTH-04): QR code plus a manual setup key, verify one code to activate, then
 * show the ten recovery codes exactly once. Used right after accepting an invitation or logging in
 * when the tenant requires MFA (the session is limited until this is done), and voluntarily from
 * the security page.
 */
export function EnrolScreen() {
  const t = useT();
  const router = useRouter();
  const auth = useAuth();
  const { toast } = useToast();
  const next = safeNext(useSearchParams().get('next'));
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const started = useRef(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const status = auth.state.status;
  const mandatory = status === 'mfa_enrolment_required';
  const hasSession = status === 'authenticated' || mandatory;

  useEffect(() => {
    if (status === 'anonymous') router.replace(routes.loginWith({ next }));
  }, [status, next, router]);

  // Start the enrolment once there is a session (the ref keeps StrictMode from asking twice,
  // which would rotate the secret under the QR code the user is scanning).
  useEffect(() => {
    if (!hasSession || started.current) return;
    started.current = true;
    authApi
      .startMfaEnrolment()
      .then(async (enrolment) => {
        const qrDataUrl = await QRCode.toDataURL(enrolment.provisioning_uri, {
          margin: 1,
          width: 192,
          errorCorrectionLevel: 'M',
        });
        setPhase({ kind: 'scan', enrolment, qrDataUrl });
      })
      .catch((err: unknown) => setPhase({ kind: 'error', message: t(toUiError(err).messageKey) }));
  }, [hasSession, t]);

  const onVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleaned = code.replace(/\s+/g, '');
    if (!cleaned) {
      setFieldError(t('mfaEnrol.codeRequired'));
      codeRef.current?.focus();
      return;
    }
    setFieldError(undefined);
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await authApi.confirmMfaEnrolment(cleaned);
      setPhase({ kind: 'recovery', codes: result.recovery_codes });
    } catch (err) {
      if (isStatus(err, 401, 422)) {
        setFormError(t('mfaEnrol.invalidCode'));
        codeRef.current?.select();
      } else if (isStatus(err, 429)) setFormError(tooManyAttemptsMessage(err, t));
      else setFormError(t(toUiError(err).messageKey));
    } finally {
      setSubmitting(false);
    }
  };

  const onContinue = async () => {
    setSubmitting(true);
    await auth.refresh();
    router.replace(next);
  };

  const onSignOut = async () => {
    await auth.signOut();
    router.replace(routes.loginWith({ reason: 'signed_out' }));
  };

  const copy = async (text: string) => {
    if (await copyText(text)) toast({ variant: 'success', title: t('mfaEnrol.copied') });
  };

  const downloadCodes = (codes: string[]) => {
    const url = URL.createObjectURL(
      new Blob([`${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'asset-tracker-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AuthLayout>
      {phase.kind === 'loading' || !hasSession ? (
        <AuthCard title={t('mfaEnrol.title')} wide>
          <div role="status" className="flex flex-col gap-3">
            <Skeleton className="size-48" />
            <Skeleton className="h-9 w-full" />
            <span className="sr-only">{t('mfaEnrol.preparing')}</span>
          </div>
        </AuthCard>
      ) : null}

      {phase.kind === 'error' ? (
        <AuthCard title={t('mfaEnrol.title')} wide focusHeading>
          <FormError message={`${t('mfaEnrol.startFailed')} ${phase.message}`} />
          <Button variant="secondary" onClick={() => router.replace(routes.dashboard)}>
            {t('access.goHome')}
          </Button>
        </AuthCard>
      ) : null}

      {phase.kind === 'scan' && hasSession ? (
        <AuthCard title={t('mfaEnrol.title')} description={t('mfaEnrol.description')} wide>
          {mandatory ? <Banner tone="info">{t('mfaEnrol.requiredNotice')}</Banner> : null}
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {/* A QR code needs dark modules on a light background in every theme. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimise */}
            <img
              src={phase.qrDataUrl}
              alt={t('mfaEnrol.qrAlt')}
              width={192}
              height={192}
              className="rounded-md border border-border bg-white"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <h2 className="text-base font-semibold">{t('mfaEnrol.manualHeading')}</h2>
              <p className="text-sm text-muted">{t('mfaEnrol.manualDescription')}</p>
              <p className="flex flex-wrap items-center gap-2">
                <span className="sr-only">{t('mfaEnrol.secretLabel')}:</span>
                <code
                  data-testid="mfa-secret"
                  className="rounded-md bg-sunken px-2 py-1 font-tag text-base break-all"
                >
                  {groupSecret(phase.enrolment.secret)}
                </code>
                <Button size="sm" onClick={() => void copy(phase.enrolment.secret)}>
                  <Copy aria-hidden className="size-4" />
                  {t('mfaEnrol.copy')}
                </Button>
              </p>
            </div>
          </div>
          <form onSubmit={onVerify} noValidate className="flex flex-col gap-4">
            <Field label={t('mfaEnrol.code')} required error={fieldError}>
              {(control) => (
                <Input
                  ref={codeRef}
                  name="code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  spellCheck={false}
                  className="font-tag tracking-widest"
                  {...control}
                />
              )}
            </Field>
            <FormError message={formError} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={submitting}>
                {t('mfaEnrol.verify')}
              </Button>
              {mandatory ? (
                <Button variant="ghost" onClick={() => void onSignOut()}>
                  {t('mfaEnrol.signOut')}
                </Button>
              ) : null}
            </div>
          </form>
        </AuthCard>
      ) : null}

      {phase.kind === 'recovery' ? (
        <AuthCard
          title={t('mfaEnrol.recoveryTitle')}
          description={t('mfaEnrol.recoveryDescription')}
          wide
          focusHeading
        >
          <ul
            aria-label={t('mfaEnrol.recoveryList')}
            data-testid="recovery-codes"
            className="grid grid-cols-2 gap-2 rounded-md bg-sunken p-3 font-tag text-base"
          >
            {phase.codes.map((recoveryCode) => (
              <li key={recoveryCode}>{recoveryCode}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void copy(phase.codes.join('\n'))}>
              <Copy aria-hidden className="size-4" />
              {t('mfaEnrol.copyAll')}
            </Button>
            <Button onClick={() => downloadCodes(phase.codes)}>
              <Download aria-hidden className="size-4" />
              {t('mfaEnrol.download')}
            </Button>
          </div>
          <Checkbox
            label={t('mfaEnrol.saved')}
            checked={saved}
            onCheckedChange={(value) => setSaved(value === true)}
          />
          <Button
            variant="primary"
            disabled={!saved}
            loading={submitting}
            onClick={() => void onContinue()}
          >
            {t('mfaEnrol.continue')}
          </Button>
        </AuthCard>
      ) : null}
    </AuthLayout>
  );
}
